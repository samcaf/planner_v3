/**
 * The MCP server, driven over real stdio the way a client would.
 *
 * Lives with the other suites so it runs with them: a tool server nobody
 * exercises is one that silently stops matching the API it wraps.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:8787'
const api = async (p, o) => {
  const r = await fetch(BASE + '/api' + p, {
    ...o, headers: o?.body ? { 'content-type': 'application/json' } : undefined,
  })
  return r.status === 204 ? null : r.json()
}

const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const made = { tasks: [], projects: [] }
const D = new Date().toLocaleDateString('en-CA')

let child = null
const clients = []

/** A client speaking JSON-RPC down a fresh server's stdin. */
async function client(env = {}) {
  const SERVER = fileURLToPath(new URL('../mcp/server.js', import.meta.url))
  const proc = spawn('node', [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env },
  })
  clients.push(proc)
  let buf = ''
  let stderr = ''
  const waiting = new Map()
  proc.stdout.on('data', (c) => {
    buf += c
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id) }
      } catch { /* not ours */ }
    }
  })
  proc.stderr.on('data', (c) => { stderr += c })

  let seq = 0
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq
    waiting.set(id, resolve)
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    setTimeout(() => reject(new Error(`timeout on ${method}`)), 15000)
  })

  const init = await send('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'suite', version: '1' },
  })
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

  const tool = async (name, args) => {
    const r = await send('tools/call', { name, arguments: args })
    const text = r.result?.content?.[0]?.text ?? ''
    let data
    try { data = JSON.parse(text) } catch { data = text }
    return { isError: !!r.result?.isError, data, text }
  }
  const list = async () => (await send('tools/list', {})).result?.tools || []
  return { init, send, tool, list, stderr: () => stderr }
}

try {
  const proj = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'ZZ tracker probe', color: 'blue', repo_path: '/tmp/zz-repo' }),
  })
  made.projects.push(proj.id)
  const t1 = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'ZZ code one', scheduled_date: D, project_id: proj.id,
      is_code: 1, notes: 'my own words', estimate_min: 45, priority: 'high',
    }),
  })
  const t2 = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'ZZ plain two', scheduled_date: D, priority: 'low' }),
  })
  made.tasks.push(t1.id, t2.id)

  const c = await client()
  child = c

  // ── the Jira shape: scoped groups, one search tool, metadata ─────────────
  check('it initialises', c.init.result?.serverInfo?.name === 'planner',
    JSON.stringify(c.init.result?.serverInfo))

  const names = (await c.list()).map((t) => t.name).sort()
  const want = [
    'add_comment', 'add_worklog', 'ask', 'claim', 'create_task', 'describe',
    'get_comments', 'get_projects', 'get_task', 'get_transitions', 'report',
    'run_state', 'search_tasks', 'step', 'transition_task', 'update_task',
  ]
  check('it lists the full tool set', names.join(',') === want.join(','), names.join(','))

  const desc = await c.tool('describe', {})
  check('describe says what is legal', Array.isArray(desc.data.transitions)
    && desc.data.query_grammar?.fields?.status?.includes('doing'),
    JSON.stringify(desc.data).slice(0, 140))

  // ── search ───────────────────────────────────────────────────────────────
  const found = await c.tool('search_tasks', { query: `is:code date:${D}` })
  check('search finds the code task',
    (found.data.tasks || []).some((t) => t.id === t1.id), JSON.stringify(found.data).slice(0, 200))
  check('and leaves the plain one out',
    !(found.data.tasks || []).some((t) => t.id === t2.id))
  const mine = (found.data.tasks || []).find((t) => t.id === t1.id)
  check('a result carries its repo', mine?.project?.repo === '/tmp/zz-repo', mine?.project?.repo)
  check('and a url to look at it', mine?.url?.endsWith(`/day/${D}`), mine?.url)

  const byName = await c.tool('search_tasks', { query: `project:"ZZ tracker probe" date:${D}` })
  check('project: resolves by name', (byName.data.tasks || []).some((t) => t.id === t1.id),
    JSON.stringify(byName.data).slice(0, 160))

  const bad = await c.tool('search_tasks', { query: 'colour:red' })
  check('a bad query explains itself', bad.isError && /is not a field/.test(bad.text), bad.text)

  const paged = await c.tool('search_tasks', { query: `date:${D}`, limit: 1 })
  check('paging reports there is more', paged.data.count === 1 && paged.data.has_more === true
    && paged.data.next_offset === 1, JSON.stringify(paged.data).slice(0, 160))

  // ── transitions as a state machine ───────────────────────────────────────
  const trs = await c.tool('get_transitions', { id: t1.id })
  const moveT = (trs.data.transitions || []).find((t) => t.name === 'move')
  check('transitions are named', (trs.data.transitions || []).some((t) => t.name === 'start'),
    JSON.stringify(trs.data).slice(0, 160))
  check('and move declares that it needs a date', moveT?.required?.includes('date'),
    JSON.stringify(moveT))

  const noDate = await c.tool('transition_task', { id: t1.id, transition: 'move' })
  check('moving without a date is refused, not half-done',
    noDate.isError && /needs date/.test(noDate.text), noDate.text)
  check('and the task did not budge', (await api(`/tasks/${t1.id}`)).status === 'todo',
    (await api(`/tasks/${t1.id}`)).status)

  await c.tool('transition_task', { id: t1.id, transition: 'start' })
  check('start puts it in flight', (await api(`/tasks/${t1.id}`)).status === 'doing')

  const nonsense = await c.tool('transition_task', { id: t1.id, transition: 'teleport' })
  check('an unknown transition lists the real ones',
    nonsense.isError && /From here/.test(nonsense.text), nonsense.text)

  // ── comments are not the notes ───────────────────────────────────────────
  await c.tool('add_comment', { id: t1.id, body: 'found it in server/db.js' })
  const after = await api(`/tasks/${t1.id}`)
  check('a comment leaves the notes alone', after.notes === 'my own words', after.notes)
  const comments = await c.tool('get_comments', { id: t1.id })
  check('and is readable back', comments.data.some((x) => /server\/db\.js/.test(x.body)),
    JSON.stringify(comments.data).slice(0, 160))
  check('attributed to whoever wrote it', comments.data[0]?.author === 'claude',
    comments.data[0]?.author)

  await c.tool('add_worklog', { id: t1.id, minutes: 25, comment: 'traced the listener' })
  const logged = await api(`/tasks/${t1.id}`)
  check('a worklog moves the timer', logged.timer_elapsed_ms === 25 * 60_000,
    String(logged.timer_elapsed_ms))
  const wl = (await c.tool('get_comments', { id: t1.id })).data.find((x) => x.kind === 'worklog')
  check('and records where the time went', wl?.minutes === 25 && /traced/.test(wl.body),
    JSON.stringify(wl))

  const hasC = await c.tool('search_tasks', { query: `has:comments date:${D}` })
  check('has:comments finds it', (hasC.data.tasks || []).some((t) => t.id === t1.id),
    JSON.stringify(hasC.data).slice(0, 140))
  check('and not the one without', !(hasC.data.tasks || []).some((t) => t.id === t2.id))

  // ── create and update ────────────────────────────────────────────────────
  const born = await c.tool('create_task', {
    title: 'ZZ made by tool', date: D, project: 'ZZ tracker probe', is_code: true, priority: 'highest',
  })
  made.tasks.push(born.data.id)
  check('create_task makes one', born.data?.title === 'ZZ made by tool', JSON.stringify(born.data).slice(0, 140))
  check('with the project resolved by name', born.data?.project?.name === 'ZZ tracker probe',
    JSON.stringify(born.data?.project))

  // Nesting goes through its own route, the only one that checks for cycles.
  const kid = await c.tool('create_task', {
    title: 'ZZ subtask by tool', date: D, parent_id: born.data.id,
  })
  made.tasks.push(kid.data?.id)
  check('create_task can nest', kid.data?.parent_id === born.data.id,
    JSON.stringify(kid.data).slice(0, 140))
  const parent = await c.tool('get_task', { id: born.data.id })
  check('and the parent lists it', (parent.data.subtasks || []).some((k) => k.id === kid.data.id),
    JSON.stringify(parent.data.subtasks))

  const changed = await c.tool('update_task', { id: born.data.id, priority: 'low', estimate_min: 15 })
  check('update_task changes fields', changed.data.priority === 'low' && changed.data.estimate_min === 15,
    JSON.stringify(changed.data).slice(0, 140))

  const missing = await c.tool('update_task', { id: born.data.id, project: 'no such project' })
  check('an unknown project lists the real ones',
    missing.isError && /no project called/.test(missing.text), missing.text)

  // ── get_task pulls it all together ───────────────────────────────────────
  const full = await c.tool('get_task', { id: t1.id })
  check('get_task carries the comments', (full.data.comments || []).length >= 2,
    String((full.data.comments || []).length))
  check('and the moves available from here', (full.data.transitions || []).includes('complete'),
    JSON.stringify(full.data.transitions))

  check('nothing on stderr', c.stderr().trim() === '', c.stderr().slice(0, 200))

  // ── scopes ───────────────────────────────────────────────────────────────
  const ro = await client({ PLANNER_MCP_SCOPES: 'read,search' })
  const roNames = (await ro.list()).map((t) => t.name)
  check('a read-only server offers no writes',
    !roNames.some((n) => ['create_task', 'update_task', 'add_comment', 'transition_task'].includes(n)),
    roNames.join(','))
  check('but still searches', roNames.includes('search_tasks'), roNames.join(','))
  const denied = await ro.tool('create_task', { title: 'ZZ should not exist' })
  check('and refuses a write by name rather than silently',
    denied.isError && /scope/.test(denied.text), denied.text)
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  for (const p of clients) { try { p.kill() } catch { /* gone */ } }
  for (const id of made.tasks.filter(Boolean)) await api(`/tasks/${id}`, { method: 'DELETE' })
  for (const id of made.projects) await api(`/projects/${id}`, { method: 'DELETE' })
  console.log('cleanup: probes removed')
  process.exit(bad ? 1 : 0)
}
