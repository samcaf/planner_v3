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

const settings = () => planner('/api/settings')
const links = () => planner('/api/tel/links').then((d) => d.links || [])
const status = () => planner('/api/tel/status')
const reconcileOne = (id) => planner(`/api/tel/reconcile/${id}`, { method: 'POST' })
const reconcileAll = () => planner('/api/tel/reconcile', { method: 'POST' })

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
    mine = new Map((await links()).map((l) => [l.tel_uuid, l]))
  } catch (e) {
    // Keep the last known map: a planner that is briefly unreachable should
    // slow the sync down, not make it forget what it was watching.
    log('could not refresh the linked set:', e.message)
  }
}

/** Anything the pass actually did, one line each. A quiet pass says nothing. */
function report(ran) {
  for (const row of ran || []) {
    if (row.error) { log(`  ${row.code}: ${row.error}`); continue }
    for (const a of row.acted || []) {
      if (a.how === 'gated') log(`  ${row.code}: stopped at needs_review — the gate is yours to cross`)
      else if (a.how === 'blocked') log(`  ${row.code}: ${a.why}`)
      else if (a.how === 'skip') log(`  ${row.code}: ${a.why}`)
      else log(`  ${row.code}: ${a.field} ${a.how}${a.to ? ` → ${a.to}` : ''}${a.conflict ? ' (theirs won)' : ''}`)
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
 * The live socket, if it can be had.
 *
 * Every client gets every ping — the broadcast is not per-user — so the filter
 * is ours to apply: a ping matters only when it names a direction we have
 * linked, and only when somebody other than us caused it. The second half is
 * the echo guard. Our own writes come back as pings like anyone else's, and
 * acting on them would have the two apps taking turns telling each other about
 * a change neither of them is still making.
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
      log('listening to Teleonomy')
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
          if ((done.acted || []).length) { log(`${ping.verb} on ${l.tel_code}:`); report([done]) }
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
  const s = await settings().catch(() => ({}))
  if (s.tel_enabled !== '1') {
    log('the Teleonomy link is switched off in settings — nothing to do')
    return
  }
  const st = await status()
  if (!st.ok) {
    log('cannot reach Teleonomy:', st.error || 'no reason given')
  } else {
    log('connected as', st.actor?.label || st.actor?.id || 'an actor Teleonomy did not name')
  }

  await sweep('start')
  setInterval(() => void sweep('timer'), SWEEP_MS)
  void listen(String(s.tel_base_url || '').replace(/\/+$/, ''), String(s.tel_token || ''), st.actor?.id)
}

main().catch((e) => { log('fatal:', e.message); process.exitCode = 1 })
