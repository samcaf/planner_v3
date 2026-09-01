/**
 * The Teleonomy link: what crosses, what does not, and who wins.
 *
 * Driven against a STUB Teleonomy stood up in this process. That is not
 * convenience — the suites run against the real planner database, and pointing
 * them at the real Teleonomy would write real transitions into a team's audit
 * ledger to check a test. The stub is also the only way to exercise the case
 * that matters most: a planner tick must climb to `needs_review` and STOP,
 * which can only be proved by watching which verbs were called.
 *
 * The stub records every call, so the assertions are about what the sync did,
 * not merely about what the database ended up saying.
 */
import './ensure-iife.mjs'
import { createServer } from 'node:http'

const BASE = 'http://localhost:8787'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const made = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const patch = (p, b) => json(p, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })

// ── the stub ───────────────────────────────────────────────────────────────
const ROOT = '00000000-0000-4000-8000-000000000000'
const PARENT = '11111111-1111-4111-8111-111111111111'
const T1 = '22222222-2222-4222-8222-222222222222'
const T2 = '33333333-3333-4333-8333-333333333333'

const world = {
  [ROOT]: { id: ROOT, human_code: 'ZZ-W', title: 'ZZ74 workspace', mode: 'workspace', status: 'on_track', attrs: {} },
  [PARENT]: { id: PARENT, human_code: 'ZZ-P', title: 'ZZ74 probe project', mode: 'strategy', status: 'on_track', attrs: {} },
  [T1]: { id: T1, human_code: 'ZZ-1', title: 'ZZ74 first', mode: 'do', status: 'backlog', attrs: {}, due_date: null },
  [T2]: { id: T2, human_code: 'ZZ-2', title: 'ZZ74 second', mode: 'do', status: 'in_progress', attrs: { description: 'theirs' }, due_date: null },
}
const calls = []

const stub = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const b = body ? JSON.parse(body) : {}
    calls.push({ path: req.url, body: b })
    const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }

    if (req.url === '/api/whoami') return send({ actor: { id: 'agent-1', label: 'the sync' } })
    // read/root answers with ONE card — the workspace — and the pickable list
    // is built from its children. Modelled exactly, because getting this shape
    // wrong is what an integration test is for.
    if (req.url === '/api/read/root') return send(world[ROOT])
    if (req.url.startsWith('/api/d/')) {
      const key = decodeURIComponent(req.url.slice('/api/d/'.length))
      const card = world[key] || Object.values(world).find((c) => c.human_code === key)
      return card ? send({ card }) : (res.writeHead(404), res.end('{}'))
    }
    if (req.url === '/api/read/project') {
      const under = (b.filters || []).find((f) => f.under_parent)?.under_parent
      // the pickable list: the root's children
      if (under === ROOT) {
        return send({ shape: 'tree', roots: [{ card: world[PARENT], children: [], matched: true }] })
      }
      // the work under a chosen project
      return send({ shape: 'tree', roots: [
        { card: world[T1], children: [{ card: world[T2], children: [], matched: true }], matched: true },
      ] })
    }
    if (req.url === '/api/verbs/advance') {
      const card = world[b.direction]
      card.status = b.to_status
      return send({ id: 'act-1' })
    }
    if (req.url === '/api/verbs/refine') {
      const card = world[b.direction]
      const d = b.fields?.attrs?.description
      if (d === null) delete card.attrs.description
      else card.attrs.description = d
      return send({ id: 'act-2' })
    }
    res.writeHead(404); res.end('{}')
  })
})

const verbs = () => calls.filter((c) => c.path.startsWith('/api/verbs/'))
const advances = () => calls.filter((c) => c.path === '/api/verbs/advance').map((c) => c.body.to_status)

let was = {}
try {
  await new Promise((r) => stub.listen(0, '127.0.0.1', r))
  const stubUrl = `http://127.0.0.1:${stub.address().port}`

  // Keep the owner's real settings to put back at the end.
  const before = await json('/api/settings')
  // The token is deliberately NOT touched. The API will not hand it back (it is
  // write-only — see routes/settings.js), so a suite that overwrote it could not
  // put the real one back, and the stub does not check authorization anyway.
  was = {
    tel_base_url: before.tel_base_url ?? '',
    tel_enabled: before.tel_enabled ?? '',
  }
  await patch('/api/settings', { tel_base_url: stubUrl, tel_enabled: '1' })

  // ── the connection ───────────────────────────────────────────────────────
  const picks = await json('/api/tel/projects')
  check('the pickable list is the workspace and what is under it',
    picks.roots?.length === 2 && picks.roots[1].human_code === 'ZZ-P',
    JSON.stringify(picks.roots?.map((p) => p.human_code)))

  const st = await json('/api/tel/status')
  check('the planner can reach the server it was pointed at', st.ok === true, JSON.stringify(st))
  check('and reports who the token says it is', st.actor?.label === 'the sync', JSON.stringify(st.actor))

  // ── picking ──────────────────────────────────────────────────────────────
  const items = await json(`/api/tel/items?parent=${PARENT}`)
  check('the picker sees the work under a project', items.items?.length === 2,
    JSON.stringify(items.items?.map((i) => i.code)))
  check('flattened with its depth, so a subtask reads as one',
    items.items?.[1]?.depth === 1, String(items.items?.[1]?.depth))
  check('and nothing is linked yet', items.items?.every((i) => i.linked_task_id === null))

  const linkedOut = await post('/api/tel/link', { items: [T1, T2], parent: PARENT })
  const ids = linkedOut.linked.map((l) => l.id)
  made.push(...ids)
  check('picking two brings two over', ids.length === 2, JSON.stringify(linkedOut.linked))
  check('under a project made from the Teleonomy container', !!linkedOut.project_id)

  const t1 = await json(`/api/tasks/${ids[0]}`)
  const t2 = await json(`/api/tasks/${ids[1]}`)
  check('they arrive unscheduled — the backlog', !t1.scheduled_date && !t2.scheduled_date,
    `${t1.scheduled_date} / ${t2.scheduled_date}`)
  check('backlog maps to todo', t1.status === 'todo', t1.status)
  check('in_progress maps to doing', t2.status === 'doing', t2.status)
  check('and the notes came with it', t2.notes === 'theirs', JSON.stringify(t2.notes))

  const again = await json(`/api/tel/items?parent=${PARENT}`)
  check('a second look shows them as already here',
    again.items.every((i) => i.linked_task_id), JSON.stringify(again.items.map((i) => i.linked_task_id)))

  // ── the gate: ticking done here must NOT finish it there ─────────────────
  calls.length = 0
  await patch(`/api/tasks/${ids[0]}`, { status: 'done' })
  const ran = await post(`/api/tel/reconcile/${ids[0]}`)
  check('a tick climbs the lifecycle one legal hop at a time',
    JSON.stringify(advances()) === JSON.stringify(['ready', 'in_progress', 'needs_review']),
    JSON.stringify(advances()))
  check('and stops at needs_review', world[T1].status === 'needs_review', world[T1].status)
  check('never calling approve', !verbs().some((c) => c.path.includes('approve')),
    'crossing a review gate from a planner tick is the one thing this must not do')
  check('the row says it is waiting on that review',
    /review/i.test((await json(`/api/tasks/${ids[0]}`)).waiting_on || ''),
    (await json(`/api/tasks/${ids[0]}`)).waiting_on)
  check('and the pass reported the gate', (ran.acted || []).some((a) => a.how === 'gated'),
    JSON.stringify(ran.acted))

  // ── their change comes back ──────────────────────────────────────────────
  world[T2].status = 'blocked'
  await post(`/api/tel/reconcile/${ids[1]}`)
  const blocked = await json(`/api/tasks/${ids[1]}`)
  check('blocked has no planner status, so it lands as waiting_on',
    blocked.status === 'doing' && /blocked/i.test(blocked.waiting_on || ''),
    `${blocked.status} / ${blocked.waiting_on}`)

  // ── notes both ways ──────────────────────────────────────────────────────
  calls.length = 0
  await patch(`/api/tasks/${ids[1]}`, { notes: 'mine now' })
  await post(`/api/tel/reconcile/${ids[1]}`)
  check('a note written here is pushed over',
    world[T2].attrs.description === 'mine now', JSON.stringify(world[T2].attrs))

  world[T2].attrs.description = 'theirs again'
  await post(`/api/tel/reconcile/${ids[1]}`)
  check('and a note written there comes back',
    (await json(`/api/tasks/${ids[1]}`)).notes === 'theirs again')

  // Both sides move between passes: Teleonomy is the record, and what was here
  // has to survive somewhere a person will find it.
  world[T2].attrs.description = 'theirs, conflicting'
  await patch(`/api/tasks/${ids[1]}`, { notes: 'mine, conflicting' })
  await post(`/api/tel/reconcile/${ids[1]}`)
  const after = await json(`/api/tasks/${ids[1]}`)
  const comments = await json(`/api/tasks/${ids[1]}/comments`)
  check('when both moved, theirs wins', after.notes === 'theirs, conflicting', after.notes)
  check('and what was overwritten is kept as a comment',
    comments.some((c) => /mine, conflicting/.test(c.body)),
    JSON.stringify(comments.map((c) => c.body.slice(0, 40))))

  // ── unlinking leaves the task alone ──────────────────────────────────────
  await post(`/api/tel/unlink/${ids[1]}`)
  const orphan = await json(`/api/tasks/${ids[1]}`)
  check('unlinking keeps the task', orphan.id === ids[1] && !!orphan.title)
  check('and only stops it listening', !orphan.tel_uuid, String(orphan.tel_uuid))
  const links = await json('/api/tel/links')
  check('so it is off the linked list', !links.links.some((l) => l.id === ids[1]))
} catch (e) {
  check('the suite ran to the end', false, e.stack?.split('\n').slice(0, 2).join(' | ') || e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  for (const id of made) await del(`/api/tasks/${id}`)
  await fetch(`${BASE}/api/projects`).then((r) => r.json()).then(async (ps) => {
    for (const p of ps) if (p.name === 'ZZ74 probe project') await del(`/api/projects/${p.id}`)
  }).catch(() => {})
  // Put the owner's own connection back exactly as it was.
  await patch('/api/settings', was).catch(() => {})
  stub.close()
  console.log('cleanup: probes removed, settings restored')
  process.exit(bad ? 1 : 0)
}
