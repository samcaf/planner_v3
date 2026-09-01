/**
 * Keeping the linked tasks in step, without anyone asking.
 *
 * Runs beside the planner on the same machine and talks to both over loopback:
 * the planner on its TRUSTED port, where a request with no cookie is the owner,
 * and Teleonomy with the bearer token the owner has already configured. It
 * therefore holds no credential of its own and can reach nothing a person in
 * front of the planner could not.
 *
 * Two directions, two mechanisms, and only one of them is required.
 *
 *   Teleonomy → planner   a live socket. Its `LivePing` names the nodes an
 *                         action touched, so a status change is applied within
 *                         a second of being made rather than at the next sweep.
 *   planner → Teleonomy   a sweep. The planner has no change feed of its own
 *                         and no per-task timestamp, so the linked set — small,
 *                         because it is only what somebody picked — is compared
 *                         against what Teleonomy last said.
 *
 * The sweep is the floor and the socket is the accelerator. If the socket
 * cannot be had — an older Node with no WebSocket, a refused upgrade, a
 * restart on the far side — nothing stops working; changes simply arrive on
 * the sweep instead. That is why the socket is allowed to fail quietly and the
 * sweep is not.
 */
import { withUser } from '../server/db.js'
import { connectionFor } from '../server/integrations/sync.js'

const PLANNER = process.env.PLANNER_API || 'http://127.0.0.1:8787'
const SWEEP_MS = Number(process.env.TEL_SYNC_SWEEP_MS || 30_000)

const log = (...a) => console.log(new Date().toISOString(), ...a)

const planner = async (path, init) => {
  const res = await fetch(PLANNER + path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new Error(`planner ${res.status} on ${path}: ${(await res.text()).slice(0, 160)}`)
  return res.json()
}

const sources = () => planner('/api/integrations').then((d) => d.sources || [])
const links = () => planner('/api/integrations/links').then((d) => d.links || [])
const status = (name) => planner(`/api/integrations/${name}/status`)
const reconcileOne = (id) => planner(`/api/integrations/reconcile/${id}`, { method: 'POST' })
const reconcileAll = () => planner('/api/integrations/reconcile', { method: 'POST' })

/**
 * Which Teleonomy direction is which planner task.
 *
 * Held rather than asked for, because EVERY client gets EVERY ping — the
 * broadcast is not per-user — and most of them are about work nobody here
 * linked. Asking the planner who owns a node on each one would turn somebody
 * else's busy afternoon into a request per action against this planner. The
 * sweep already reads the linked set, so it refreshes this on its way past.
 */
let mine = new Map()

async function refresh() {
  try {
    mine = new Map((await links()).map((l) => [l.ext_id, l]))
  } catch (e) {
    // Keep the last known map: a planner that is briefly unreachable should
    // slow the sync down, not make it forget what it was watching.
    log('could not refresh the linked set:', e.message)
  }
}

/** Anything the pass actually did, one line each. A quiet pass says nothing. */
function report(ran) {
  for (const row of ran || []) {
    if (row.error) { log(`  ${row.key}: ${row.error}`); continue }
    for (const a of row.acted || []) {
      if (a.how === 'gated') log(`  ${row.key}: stopped at ${a.at} — that step is yours to take`)
      else if (a.how === 'blocked' || a.how === 'skip') log(`  ${row.key}: ${a.why}`)
      else log(`  ${row.key}: ${a.field} ${a.how}${a.to ? ` → ${a.to}` : ''}${a.conflict ? ' (theirs won)' : ''}`)
    }
  }
}

async function sweep(why) {
  try {
    await refresh()
    const { ran } = await reconcileAll()
    const busy = (ran || []).filter((r) => r.error || (r.acted || []).length)
    if (busy.length) { log(`sweep (${why}):`); report(busy) }
  } catch (e) {
    log('sweep failed:', e.message)
  }
}

/**
 * The live feed, where a system has one.
 *
 * Teleonomy broadcasts over a WebSocket; another system might offer webhooks,
 * or nothing at all. Nothing here is required — the sweep is the floor, and
 * this only makes a change arrive in seconds rather than at the next pass. So
 * it is allowed to fail quietly, and the sweep is not.
 *
 * Every client of that socket gets every ping, so the filter is ours: a ping
 * matters only when it names something we linked, and only when somebody other
 * than us caused it. That second half is the echo guard — our own writes come
 * back as pings like anyone else's, and acting on them would have the two apps
 * taking turns telling each other about a change neither is still making.
 */
async function listen(base, token, meId) {
  if (typeof WebSocket === 'undefined') {
    log('no WebSocket in this runtime — the sweep is doing all of it')
    return
  }
  const url = base.replace(/^http/, 'ws') + '/api/ws'
  let wait = 1000

  const connect = () => {
    let socket
    try {
      socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } })
    } catch (e) {
      log('socket refused:', e.message)
      return retry()
    }

    socket.onopen = () => {
      wait = 1000
      log('listening for changes')
      // Anything that happened while we were away is repaired now rather than
      // waited for: a missed ping is not a ping that arrives late.
      void sweep('reconnected')
    }

    socket.onmessage = async (ev) => {
      let ping
      try { ping = JSON.parse(String(ev.data)) } catch { return }
      if (meId && ping.user_id === meId) return // our own echo
      const hits = (ping.node_ids || []).map((id) => mine.get(id)).filter(Boolean)
      if (!hits.length) return // somebody else's work — the common case
      try {
        for (const l of hits) {
          const done = await reconcileOne(l.id)
          if ((done.acted || []).length) { log(`something moved on ${l.ext_key}:`); report([done]) }
        }
      } catch (e) {
        log('ping handling failed:', e.message)
      }
    }

    socket.onclose = () => retry()
    socket.onerror = () => { /* onclose follows and does the retrying */ }
  }

  const retry = () => {
    setTimeout(connect, wait)
    wait = Math.min(wait * 2, 60_000)
  }

  connect()
}

async function main() {
  const on = (await sources().catch(() => [])).filter((x) => x.configured && x.on)
  if (!on.length) {
    log('no integration is switched on in settings — nothing to do')
    return
  }

  await sweep('start')
  setInterval(() => void sweep('timer'), SWEEP_MS)

  for (const src of on) {
    const st = await status(src.name).catch(() => ({ ok: false }))
    if (!st.ok) { log(`cannot reach ${src.label}:`, st.error || 'no reason given'); continue }
    log(`${src.label}: connected as`, st.actor?.label || st.actor?.id || 'an actor it did not name')
    // The socket is Teleonomy's; another adapter would want its own arrangement
    // here, or none. Everything above this line already works without it.
    if (src.name === 'teleonomy') {
      // The credential is read from the planner's own database rather than
      // asked for over HTTP. The API deliberately will not hand a token back —
      // see routes/settings.js — and adding an endpoint that did, for the
      // convenience of a process already sitting on the same disk, would undo
      // that for nothing. Being local is the difference between this and a
      // browser, and this is the one place it is used.
      const link = withUser(null, () => connectionFor('teleonomy'))
      if (link) void listen(link.conn.base, link.conn.token, st.actor?.id)
    }
  }
}

main().catch((e) => { log('fatal:', e.message); process.exitCode = 1 })
