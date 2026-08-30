/**
 * The dialogue: claim, ask, step, report — and what happens at the ceiling.
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
const D = '2031-08-03'

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
  // A conversation with a deliberately small budget, so the ceiling is reachable.
  const sec = await api('/sections', {
    method: 'POST',
    body: JSON.stringify({
      date: D, name: 'ZZ dialogue', kind: 'ai',
      ai_switches: JSON.stringify({ budget: '5', depth: '1', sign_off: 'required' }),
    }),
  })
  made.sections = [sec.id]
  const brief = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'ZZ work this out', scheduled_date: D, section_id: sec.id,
      notes: 'the spec lives here',
    }),
  })
  made.tasks.push(brief.id)

  const c = await client()
  check('it initialises', c.init.result?.serverInfo?.name === 'planner')

  const names = (await c.list()).map((t) => t.name)
  for (const move of ['claim', 'ask', 'step', 'report', 'run_state']) {
    check(`${move} is offered`, names.includes(move), names.join(','))
  }

  // ── claim ────────────────────────────────────────────────────────────────
  const claimed = await c.tool('claim', { id: brief.id })
  check('claim opens a run', !!claimed.data.run_id, JSON.stringify(claimed.data).slice(0, 160))
  check('and reports the terms it is worked under',
    claimed.data.terms?.budget === '5' && claimed.data.terms?.sign_off === 'required',
    JSON.stringify(claimed.data.terms))
  check('and what is left of the budget', claimed.data.budget?.of === 5,
    JSON.stringify(claimed.data.budget))
  const run = claimed.data.run_id

  const inFlight = await api(`/tasks/${brief.id}`)
  check('the brief is in flight and theirs',
    inFlight.status === 'doing' && inFlight.waiting_on === 'ai',
    `${inFlight.status}/${inFlight.waiting_on}`)

  const again = await c.tool('claim', { id: brief.id })
  check('claiming twice resumes rather than resetting the budget',
    again.data.run_id === run, `${run} -> ${again.data.run_id}`)

  // ── steps, up to the depth ───────────────────────────────────────────────
  const s1 = await c.tool('step', { id: brief.id, title: 'ZZ step one' })
  made.tasks.push(s1.data?.id)
  check('a step is raised under the brief', s1.data?.depth === 1, JSON.stringify(s1.data))

  const s2 = await c.tool('step', { id: s1.data.id, title: 'ZZ too deep' })
  check('a step past the depth is refused', s2.isError && /depth/.test(s2.text), s2.text)
  check('and says what the limit was', /past the 1/.test(s2.text), s2.text)

  // ── the ceiling ──────────────────────────────────────────────────────────
  // Brief + step = 2 of 5. Three more steps fills it.
  for (let i = 2; i <= 4; i++) {
    const r = await c.tool('step', { id: brief.id, title: `ZZ step ${i}` })
    made.tasks.push(r.data?.id)
  }
  const state = await c.tool('run_state', { run_id: run })
  check('the run knows what it has spent', state.data.spent === 5 && state.data.remaining === 0,
    JSON.stringify(state.data).slice(0, 140))

  const over = await c.tool('step', { id: brief.id, title: 'ZZ one too many' })
  check('a step past the budget is refused', over.isError && /budget spent/.test(over.text),
    over.text)
  check('and points at what IS still allowed', /ask|report/.test(over.text), over.text)

  // The property the whole design turns on: at the ceiling, asking still works.
  const asked = await c.tool('ask', {
    id: brief.id, question: 'ZZ which of the two shapes did you mean?',
  })
  made.tasks.push(asked.data?.asked)
  check('a question is never refused, even with the budget spent', !asked.isError, asked.text)
  check('and it says to stop', asked.data?.stop === true, JSON.stringify(asked.data))

  const handed = await api(`/tasks/${brief.id}`)
  check('asking hands the brief back too', handed.waiting_on === 'human', handed.waiting_on)
  const q = await api(`/tasks/${asked.data.asked}`)
  check('the question waits on the human', q.waiting_on === 'human', q.waiting_on)
  check('is marked as the AI asking', q.origin === 'ai' && q.ai_role === 'question',
    `${q.origin}/${q.ai_role}`)
  check('unread until looked at', q.seen === 0, String(q.seen))
  check('and hangs off the brief', q.parent_id === brief.id, String(q.parent_id))

  // ── reporting, also never refused ────────────────────────────────────────
  const reported = await c.tool('report', {
    id: brief.id,
    heading: 'ZZ what I did',
    notes: 'traced it to the listener and fixed it',
    followups: [
      { title: 'ZZ check the drop targets', kind: 'check' },
      { title: 'ZZ then delete the old path', kind: 'followup' },
    ],
  })
  check('reporting works with the budget spent', !reported.isError, reported.text)
  made.tasks.push(reported.data?.reported)
  check('but the follow-ups it could not fit are dropped',
    reported.data?.followups_written === 0 && reported.data?.followups_dropped === 2,
    JSON.stringify(reported.data))

  const band = await api(`/tasks/${reported.data.reported}`)
  check('the answer is a band', band.subsection === 1, String(band.subsection))
  check('pointing back at the brief', band.answers_id === brief.id, String(band.answers_id))
  check('and it SAYS what it had to drop', /could not be written/.test(band.notes), band.notes)

  const closed = await api(`/tasks/${brief.id}`)
  check('sign-off required hands it back rather than closing it',
    closed.status !== 'done' && closed.waiting_on === 'human',
    `${closed.status}/${closed.waiting_on}`)

  // ── searching by turn ────────────────────────────────────────────────────
  const theirs = await c.tool('search_tasks', { query: `is:theirs date:${D}` })
  check('is:theirs finds what is waiting on the human',
    (theirs.data.tasks || []).some((t) => t.id === brief.id),
    JSON.stringify(theirs.data).slice(0, 140))

  check('nothing on stderr', c.stderr().trim() === '', c.stderr().slice(0, 200))
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
