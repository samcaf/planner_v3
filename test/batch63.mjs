/**
 * Instructions for the agent: three layers that stack, and arrive as one block.
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
const made = { tasks: [], projects: [], sections: [] }
const D = '2031-08-07'

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
  const was = await api('/settings')
  const hadPrompt = was.ai_prompt ?? null
  await api('/settings', {
    method: 'PATCH',
    body: JSON.stringify({ ai_prompt: 'ZZ always prefer the smallest diff.' }),
  })

  const sec = await api('/sections', {
    method: 'POST',
    body: JSON.stringify({
      date: D, name: 'ZZ prompted', kind: 'ai',
      ai_prompt: 'ZZ do not touch the server in this conversation.',
    }),
  })
  made.sections = [sec.id]
  const brief = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'ZZ the brief', scheduled_date: D, section_id: sec.id,
      notes: 'what the task is about',
      ai_prompt: 'ZZ start from the failing case in batch30.',
    }),
  })
  made.tasks.push(brief.id)
  const bare = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'ZZ nothing written for it', scheduled_date: D, section_id: sec.id }),
  })
  made.tasks.push(bare.id)

  const c = await client()

  // ── all three layers arrive, in order, labelled ──────────────────────────
  const got = await c.tool('get_task', { id: brief.id })
  const prompt = got.data.prompt || ''
  check('a prompt comes back at all', !!prompt, JSON.stringify(got.data).slice(0, 200))
  check('the standing instruction is in it', /smallest diff/.test(prompt), prompt)
  check('so is the conversation\'s', /do not touch the server/.test(prompt), prompt)
  check('and the task\'s own', /failing case in batch30/.test(prompt), prompt)
  check('general before specific',
    prompt.indexOf('smallest diff') < prompt.indexOf('do not touch')
      && prompt.indexOf('do not touch') < prompt.indexOf('failing case'),
    prompt)
  check('each part says where it came from',
    /Standing instructions/.test(prompt) && /ZZ prompted/.test(prompt) && /For this task/.test(prompt),
    prompt)

  const parts = got.data.prompt_parts || []
  check('and they come apart again', parts.length === 3, JSON.stringify(parts.map((p) => p.from)))
  check('naming their layer',
    parts.map((p) => p.from).join(',') === 'settings,section,task',
    parts.map((p) => p.from).join(','))

  check('the notes stay the notes', got.data.notes === 'what the task is about', got.data.notes)

  // ── a task with nothing of its own still gets what is above it ───────────
  const plain = await c.tool('get_task', { id: bare.id })
  check('a task with no prompt still carries the layers above',
    /smallest diff/.test(plain.data.prompt || '') && /do not touch/.test(plain.data.prompt || ''),
    plain.data.prompt)
  check('but nothing of its own', !/For this task/.test(plain.data.prompt || ''),
    plain.data.prompt)

  // ── claim hands it over too ──────────────────────────────────────────────
  const claimed = await c.tool('claim', { id: brief.id })
  check('claim carries the instructions', /failing case in batch30/.test(claimed.data.prompt || ''),
    JSON.stringify(claimed.data).slice(0, 200))
  check('and tells the agent they are for it',
    /written for you/.test(claimed.data.note || ''), claimed.data.note)

  // ── search says only whether, not what ───────────────────────────────────
  const found = await c.tool('search_tasks', { query: `date:${D}` })
  const rows = found.data.tasks || []
  check('a search result flags a task that has one',
    rows.find((t) => t.id === brief.id)?.has_prompt === true,
    JSON.stringify(rows.map((t) => [t.id, t.has_prompt])))
  check('and one that has not', rows.find((t) => t.id === bare.id)?.has_prompt === false)
  check('without carrying the text', !JSON.stringify(rows).includes('smallest diff'))

  // ── nothing written anywhere means no prompt, not an empty one ───────────
  await api('/settings', { method: 'PATCH', body: JSON.stringify({ ai_prompt: '' }) })
  await api(`/sections/${sec.id}`, { method: 'PATCH', body: JSON.stringify({ ai_prompt: '' }) })
  await api(`/tasks/${brief.id}`, { method: 'PATCH', body: JSON.stringify({ ai_prompt: '' }) })
  const empty = await c.tool('get_task', { id: brief.id })
  check('with nothing written there is no prompt at all', empty.data.prompt === null,
    JSON.stringify(empty.data.prompt))
  check('and no empty parts', empty.data.prompt_parts === undefined,
    JSON.stringify(empty.data.prompt_parts))

  check('nothing on stderr', c.stderr().trim() === '', c.stderr().slice(0, 200))

  if (hadPrompt !== null) {
    await api('/settings', { method: 'PATCH', body: JSON.stringify({ ai_prompt: hadPrompt }) })
  } else {
    await api('/settings/ai_prompt', { method: 'DELETE' })
  }
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
  const day = await fetch(`${BASE}/api/days/${D}`).then((r) => r.json()).catch(() => ({}))
  for (const t of day.tasks || []) await api(`/tasks/${t.id}`, { method: 'DELETE' })
  for (const s of day.sections || []) await api(`/sections/${s.id}`, { method: 'DELETE' })
  console.log('cleanup: probes removed')
  process.exit(bad ? 1 : 0)
}
