/**
 * The MCP server, driven over real stdio the way a client would.
 *
 * Lives with the other suites so it runs with them: a tool server that nobody
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
const D = new Date().toLocaleDateString('en-CA')

const proj = await api('/projects', {
  method: 'POST',
  body: JSON.stringify({ name: 'ZZ mcp probe', color: 'blue', repo_path: '/tmp/zz-repo' }),
})
const t1 = await api('/tasks', {
  method: 'POST',
  body: JSON.stringify({
    title: 'ZZ code task', scheduled_date: D, project_id: proj.id,
    is_code: 1, notes: 'the original note', estimate_min: 45,
  }),
})
const t2 = await api('/tasks', {
  method: 'POST',
  body: JSON.stringify({ title: 'ZZ plain task', scheduled_date: D, is_code: 0 }),
})
const kid = await api('/tasks', {
  method: 'POST',
  body: JSON.stringify({ title: 'ZZ subtask', scheduled_date: D, parent_id: t1.id, is_code: 1 }),
})

const SERVER = fileURLToPath(new URL('../mcp/server.js', import.meta.url))
const child = spawn('node', [SERVER], {
  stdio: ['pipe', 'pipe', 'pipe'],
})
let buf = ''
const waiting = new Map()
child.stdout.on('data', (c) => {
  buf += c
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    try {
      const msg = JSON.parse(line)
      if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id) }
    } catch {}
  }
})
let stderr = ''
child.stderr.on('data', (c) => { stderr += c })

let seq = 0
const send = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq
  waiting.set(id, resolve)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  setTimeout(() => reject(new Error(`timeout on ${method}`)), 10000)
})
const tool = async (name, args) => {
  const r = await send('tools/call', { name, arguments: args })
  const text = r.result?.content?.[0]?.text ?? ''
  return { raw: r, isError: !!r.result?.isError, data: (() => { try { return JSON.parse(text) } catch { return text } })() }
}

try {
  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '1' },
  })
  check('it initialises', init.result?.serverInfo?.name === 'planner',
    JSON.stringify(init.result?.serverInfo))
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

  const list = await send('tools/list', {})
  const names = (list.result?.tools || []).map((t) => t.name)
  check('it lists its tools', names.join(',') === 'code_tasks,task,start,log,finish', names.join(','))

  const day = await tool('code_tasks', {})
  check('code_tasks answers', !day.isError, JSON.stringify(day.data).slice(0, 160))
  const mine = (day.data.tasks || []).find((t) => t.id === t1.id)
  check('it finds the code task', !!mine, `${day.data.count} back`)
  check('and leaves the plain one out',
    !(day.data.tasks || []).some((t) => t.id === t2.id))
  check('it carries the notes', mine?.notes === 'the original note', mine?.notes)
  check('and the repo it lives in', mine?.repo === '/tmp/zz-repo', mine?.repo)
  check('and the project name', mine?.project === 'ZZ mcp probe', mine?.project)
  check('the subtask arrives under its parent, not beside it',
    mine?.subtasks?.length === 1 && !(day.data.tasks || []).some((t) => t.id === kid.id),
    JSON.stringify(mine?.subtasks))

  const one = await tool('task', { id: t1.id })
  check('task returns one in full', one.data.id === t1.id && one.data.repo === '/tmp/zz-repo',
    JSON.stringify(one.data).slice(0, 120))

  await tool('start', { id: t1.id })
  check('start puts it in flight', (await api(`/tasks/${t1.id}`)).status === 'doing')

  await tool('log', { id: t1.id, text: 'found the cause in server/db.js' })
  const logged = await api(`/tasks/${t1.id}`)
  check('log appends', logged.notes.includes('found the cause'), logged.notes)
  check('and keeps what was already there', logged.notes.includes('the original note'),
    logged.notes)

  await tool('finish', { id: t1.id, summary: 'fixed and covered by a test' })
  const done = await api(`/tasks/${t1.id}`)
  check('finish closes it', done.status === 'done', done.status)
  check('with the evidence attached', done.notes.includes('fixed and covered'), done.notes)
  check('on top of the log', done.notes.includes('found the cause'), done.notes)

  const bad = await tool('task', { id: 99999999 })
  check('a missing task is a tool error, not a crash', bad.isError, JSON.stringify(bad.data))

  check('nothing on stderr', stderr.trim() === '', stderr.slice(0, 200))
} catch (e) {
  check('the smoke ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  child.kill()
  for (const id of [kid.id, t1.id, t2.id]) await api(`/tasks/${id}`, { method: 'DELETE' })
  await api(`/projects/${proj.id}`, { method: 'DELETE' })
  console.log('cleanup: probes removed')
  process.exit(bad ? 1 : 0)
}
