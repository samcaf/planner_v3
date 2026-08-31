/**
 * Signing in, and the two ports that are not the same door.
 *
 * The thing worth pinning is not the happy path — it is that the PUBLIC port,
 * which is what `tailscale serve` fronts, refuses a request with no session,
 * while the TRUSTED port still lets the local tools through. Those two are one
 * app and one process; only the port a connection arrived on tells them apart,
 * because Tailscale proxies from this same machine and the peer address says
 * 127.0.0.1 either way.
 *
 * No jsdom: this is about headers and status codes, so it needs no bundle and
 * is not subject to the rebuild hazard the runner warns about.
 */
import { accounts, addUser, byLogin, everyone, setStatus, startSession } from '../server/accounts.js'
import { rmSync } from 'node:fs'

const TRUSTED = process.env.PLANNER_API || 'http://localhost:8787'
const PUBLIC = process.env.PLANNER_PUBLIC_API || 'http://localhost:8789'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const made = []

const json = (b) => ({ 'content-type': 'application/json' })
const post = (base, path, body, headers = {}) => fetch(base + path, {
  method: 'POST', headers: { ...json(), ...headers }, body: JSON.stringify(body),
})

/**
 * Drop a probe account however it was made — the API will not remove an owner.
 *
 * Through the API first, so the server lets go of that person's planner file. A
 * pooled connection outlives the file it was opened on, so deleting one behind
 * the server's back leaves a handle that still answers and would be handed to
 * whoever next took the slug. Then the file, which the API deliberately leaves.
 */
const forget = async (login) => {
  const u = byLogin(login)
  if (!u) return
  await fetch(`${TRUSTED}/api/auth/users/${u.id}`, { method: 'DELETE' }).catch(() => {})
  if (byLogin(login)) accounts.prepare('DELETE FROM users WHERE id = ?').run(u.id)
  for (const p of [`data/users/${u.slug}.db`, `data/users/${u.slug}.db-wal`,
    `data/users/${u.slug}.db-shm`, `data/users/${u.slug}`]) {
    rmSync(p, { recursive: true, force: true })
  }
}

let borrowedOwner = null
try {
  // The suite needs an owner to exist, because the first account ever created
  // becomes one and that would make the probe permanent.
  if (!everyone().some((u) => u.is_owner)) {
    borrowedOwner = addUser({
      login: 'zzsuite-owner', password: 'probe-password-1', status: 'active', isOwner: true,
    })
    made.push(borrowedOwner.login)
  }

  // ── asking for an account ------------------------------------------------
  await forget('zzsuite-guest')
  const asked = await post(PUBLIC, '/api/auth/request', {
    login: 'zzsuite-guest', name: 'Probe', password: 'probe-password-2',
  })
  made.push('zzsuite-guest')
  const askedBody = await asked.json()
  check('anyone can ask for an account from the public port', asked.status === 200,
    `${asked.status} ${JSON.stringify(askedBody).slice(0, 80)}`)
  check('and it is pending, not admitted', askedBody.pending === true
    && askedBody.user?.status === 'pending', JSON.stringify(askedBody.user))

  const short = await post(PUBLIC, '/api/auth/request', { login: 'zzsuite-x', password: 'abc' })
  check('a password that is too short is refused', short.status === 400, String(short.status))

  const again = await post(PUBLIC, '/api/auth/request', {
    login: 'zzsuite-guest', password: 'probe-password-2',
  })
  check('and a login already taken is refused', (await again.json()).code === 'taken')

  // ── a pending account is told why, not told it typed the password wrong ---
  const early = await post(PUBLIC, '/api/auth/login', {
    login: 'zzsuite-guest', password: 'probe-password-2',
  })
  const earlyBody = await early.json()
  check('a pending account cannot sign in', early.status >= 400, String(early.status))
  check('and hears that it is waiting, not that it is wrong',
    earlyBody.code === 'pending', JSON.stringify(earlyBody))

  const wrong = await post(PUBLIC, '/api/auth/login', {
    login: 'zzsuite-guest', password: 'not-the-password',
  })
  check('a wrong password says only that', (await wrong.json()).code === 'bad_credentials')

  // ── approved, then in ----------------------------------------------------
  setStatus(byLogin('zzsuite-guest').id, 'active')
  const inNow = await post(PUBLIC, '/api/auth/login', {
    login: 'zzsuite-guest', password: 'probe-password-2',
  })
  check('once approved, the same password works', inNow.status === 200, String(inNow.status))

  const [setCookie] = inNow.headers.getSetCookie?.() || []
  check('and a session cookie comes back', /planner_session=/.test(setCookie || ''),
    (setCookie || 'none').slice(0, 60))
  check('the cookie is HttpOnly', /HttpOnly/i.test(setCookie || ''))
  check('and lasts years rather than hours', /Max-Age=\d{8,}/.test(setCookie || ''),
    (setCookie || '').match(/Max-Age=\d+/)?.[0] || 'none')

  const cookie = (setCookie || '').split(';')[0]

  // ── the two ports differ -------------------------------------------------
  const publicNoCookie = await fetch(`${PUBLIC}/api/settings`)
  check('the public port refuses a request with no session',
    publicNoCookie.status === 401, String(publicNoCookie.status))
  check('and says so in a code the client can act on',
    (await publicNoCookie.json()).code === 'unauthenticated')

  const trustedNoCookie = await fetch(`${TRUSTED}/api/settings`)
  check('the trusted port still lets the local tools through',
    trustedNoCookie.status === 200, String(trustedNoCookie.status))

  const withCookie = await fetch(`${PUBLIC}/api/settings`, { headers: { cookie } })
  check('the public port with the cookie is in', withCookie.status === 200,
    String(withCookie.status))

  const me = await (await fetch(`${PUBLIC}/api/auth/me`, { headers: { cookie } })).json()
  check('and knows who it is', me.user?.login === 'zzsuite-guest', JSON.stringify(me.user))
  check('without ever handing back the password hash',
    !JSON.stringify(me).includes('scrypt'), JSON.stringify(me).slice(0, 80))

  // ── only the owner holds the roster --------------------------------------
  const asGuest = await fetch(`${PUBLIC}/api/auth/users`, { headers: { cookie } })
  check('a guest cannot read the roster', (await asGuest.json()).code === 'not_owner')

  const roster = await (await fetch(`${TRUSTED}/api/auth/users`)).json()
  check('the owner can', Array.isArray(roster) && roster.length >= 2,
    Array.isArray(roster) ? String(roster.length) : JSON.stringify(roster).slice(0, 80))
  const guestRow = roster.find((u) => u.login === 'zzsuite-guest')
  check('and sees the guest’s live device', guestRow?.sessions?.length === 1,
    JSON.stringify(guestRow?.sessions || []).slice(0, 80))

  // ── revoking one device --------------------------------------------------
  await fetch(`${TRUSTED}/api/auth/sessions/${guestRow.sessions[0].token_hash}`, { method: 'DELETE' })
  const afterRevoke = await fetch(`${PUBLIC}/api/settings`, { headers: { cookie } })
  check('a revoked device is out on its next request', afterRevoke.status === 401,
    String(afterRevoke.status))

  // ── blocking ------------------------------------------------------------
  setStatus(byLogin('zzsuite-guest').id, 'blocked')
  const blocked = await post(PUBLIC, '/api/auth/login', {
    login: 'zzsuite-guest', password: 'probe-password-2',
  })
  check('a blocked account is told it is blocked', (await blocked.json()).code === 'blocked')

  // ── a token, for a tool on another machine -------------------------------
  // Once the planner runs on a server, the trusted port is loopback on THAT
  // machine and the CLI tools can no longer walk in. A token is the same
  // session a browser gets, carried in a header instead of a cookie.
  const guest = byLogin('zzsuite-guest')
  setStatus(guest.id, 'active')
  const token = startSession(guest.id, 'token · suite')
  const withToken = await fetch(`${PUBLIC}/api/settings`, {
    headers: { 'x-planner-token': token },
  })
  check('a token gets in where a cookie would', withToken.status === 200, String(withToken.status))

  const whoToken = await (await fetch(`${PUBLIC}/api/auth/me`, {
    headers: { 'x-planner-token': token },
  })).json()
  check('as the person it was minted for', whoToken.user?.login === 'zzsuite-guest',
    JSON.stringify(whoToken.user))

  const listed = await (await fetch(`${TRUSTED}/api/auth/users`)).json()
  const tokenRow = listed.find((u) => u.login === 'zzsuite-guest')
    ?.sessions?.find((sn) => sn.device === 'token · suite')
  check('and it is listed as a device, not hidden away', !!tokenRow,
    JSON.stringify(listed.find((u) => u.login === 'zzsuite-guest')?.sessions || []))

  await fetch(`${TRUSTED}/api/auth/sessions/${tokenRow.token_hash}`, { method: 'DELETE' })
  const afterToken = await fetch(`${PUBLIC}/api/settings`, {
    headers: { 'x-planner-token': token },
  })
  check('so the same button revokes it', afterToken.status === 401, String(afterToken.status))

  // ── the owner is not removable, by anyone --------------------------------
  const ownerRow = roster.find((u) => u.is_owner)
  const killOwner = await fetch(`${TRUSTED}/api/auth/users/${ownerRow.id}`, { method: 'DELETE' })
  check('the owner cannot be removed', killOwner.status >= 400, String(killOwner.status))
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  for (const login of [...made, 'zzsuite-x']) await forget(login)
  console.log('cleanup: probe accounts removed')
  process.exit(bad ? 1 : 0)
}
