import { Router } from 'express'
import {
  addUser, byId, byLogin, checkPassword, endSession, everyone, owner, publicUser,
  removeUser, revokeSession, sessionUser, sessionsOf, setStatus, startSession,
} from '../accounts.js'
import { closeFor } from '../db.js'
import { TRUSTED_PORT } from '../ports.js'
import { badRequest, h, notFound, refused } from './_helpers.js'

/**
 * Signing in, and who is allowed to.
 *
 * The app is reachable from a whole tailnet now, so something has to decide
 * whether a request belongs to anyone. That is a session cookie: a random token
 * the browser keeps and the server stores only the hash of.
 *
 * Sessions do not expire. "Stay signed in on my phone" is the requirement, and
 * an expiry is a worse answer to it than revocation is — a session ends when it
 * is signed out, when the owner revokes that device, or when the account stops
 * being active. All three are visible in a list; a clock is not.
 *
 * New people ask, and the owner approves. The account exists from the moment it
 * is asked for, holding a password, so approving is one click rather than an
 * exchange of credentials.
 */

export const COOKIE = 'planner_session'

/**
 * The same session, for something that is not a browser.
 *
 * Once the app runs on a server rather than on your laptop, the trusted port is
 * loopback on THAT machine — so `bin/plan.js` and the MCP server can no longer
 * walk in without a session the way they do when everything is one host. They
 * are not browsers and have nowhere to keep a cookie, so they carry the token
 * in a header instead.
 *
 * It is an ordinary session row, deliberately: it shows up in the roster beside
 * the phones, it says when it was last used, and the owner revokes it with the
 * same button. A separate kind of credential would have been a second thing to
 * remember to look at.
 */
export const TOKEN_HEADER = 'x-planner-token'

/** The session this request carries, however it is carrying it. */
const tokenOf = (req) => req.headers?.[TOKEN_HEADER] || readCookie(req, COOKIE)

/**
 * One header, five lines. `cookie-parser` would be a dependency for this.
 *
 * Values are URL-encoded by `res.cookie`, so they have to be decoded here; a
 * malformed one is treated as absent rather than throwing, because a bad cookie
 * is a request without a session, not a server error.
 */
export function readCookie(req, name) {
  const header = req.headers?.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    if (part.slice(0, at).trim() !== name) continue
    try { return decodeURIComponent(part.slice(at + 1).trim()) } catch { return null }
  }
  return null
}

/**
 * Ten years, which is the closest a cookie gets to "indefinitely".
 *
 * `Secure` comes from the environment rather than from the request. Behind
 * `tailscale serve` the browser always speaks HTTPS and the flag should be set;
 * under `npm run dev` it is plain http on localhost and a Secure cookie would
 * never be sent back, so the login would appear to succeed and then not.
 * Inferring it from X-Forwarded-Proto was the alternative — Tailscale documents
 * the identity headers it adds and says nothing about that one, and a login
 * that rests on undocumented proxy behaviour breaks on somebody else's upgrade.
 */
const TEN_YEARS = 10 * 365 * 24 * 60 * 60 * 1000

/** localhost by any of its names, whatever port it came in on. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const askedLocally = (req) =>
  LOCAL_HOSTS.has(String(req.headers?.host || '').replace(/:\d+$/, '').toLowerCase())

/**
 * Secure when it can be, off when it would break the login.
 *
 * The env var says "this deployment is served over HTTPS", which is true of the
 * systemd unit behind `tailscale serve`. But the SAME process also answers
 * `http://localhost:5173` while you are working on it, and a Secure cookie is
 * simply never sent back over plain http — so the sign-in appears to succeed
 * and then every request is anonymous, which is a maddening thing to debug.
 *
 * The Host header separates the two, and it is a safe thing to key on here: a
 * client that lied about it to avoid the Secure flag would only be weakening
 * its own cookie, which it could do by not using one at all.
 *
 * X-Forwarded-Proto was the other candidate. Tailscale documents the identity
 * headers it adds and says nothing about that one, and a login that rests on
 * undocumented proxy behaviour breaks on somebody else's upgrade.
 */
const secure = (req) => process.env.PLANNER_SECURE_COOKIES === '1' && !askedLocally(req)

const cookieOptions = (req) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: secure(req),
  path: '/',
  maxAge: TEN_YEARS,
})

export const setSessionCookie = (req, res, token) =>
  res.cookie(COOKIE, token, cookieOptions(req))
export const clearSessionCookie = (req, res) =>
  res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined })

/**
 * A request on the trusted port with no cookie is the owner.
 *
 * The MCP server and the test suites both talk to the API and neither holds a
 * cookie. What this grants, honestly: anything that can reach the trusted port
 * is trusted — which is anything already running on this machine, and that was
 * already true, because anything running here can open the SQLite file
 * directly.
 *
 * It keys on the port the connection ARRIVED on, not on the peer address.
 * `tailscale serve` proxies from tailscaled on this same machine, so a visitor
 * from the far side of the tailnet also arrives from 127.0.0.1 — the peer
 * address cannot tell a local tool from the whole world. See ports.js.
 *
 * PLANNER_TRUST_LOCAL=0 turns it off, at the cost of locking out the CLI tools.
 */
export const trustsLocal = (req) => process.env.PLANNER_TRUST_LOCAL !== '0'
  && req.socket?.localPort === TRUSTED_PORT

/** Nobody has an account yet, so the app cannot be locked behind one. */
export const noAccountsYet = () => everyone().length === 0

/**
 * Who is asking, or a 401.
 *
 * Mounted on /api, after the routes that have to work without a session. It
 * sets `req.user` rather than answering, so everything downstream can assume
 * there is one.
 */
export function gate(req, res, next) {
  const token = tokenOf(req)
  const user = token ? sessionUser(token) : null
  if (user) { req.user = user; req.sessionToken = token; return next() }

  // Before the first account exists there is nothing to sign in to, and
  // refusing every request would leave no way to reach the page that says so.
  if (noAccountsYet()) { req.user = null; return next() }

  if (trustsLocal(req)) {
    const first = owner()
    if (first) { req.user = first; return next() }
  }

  res.status(401).json({ error: 'not signed in', code: 'unauthenticated' })
}

const ownerOnly = (req) => {
  if (!req.user?.is_owner) throw refused('not_owner', 'only the owner can do that')
  return req.user
}

/** What the browser calls itself, kept short enough to read in a list. */
const deviceOf = (req) => String(req.headers['user-agent'] || '').slice(0, 200)

const r = Router()

/**
 * Who is asking, if anyone — without refusing when nobody is.
 *
 * This router is mounted BEFORE the gate, because signing in cannot require
 * being signed in. That means nothing has set req.user by the time these
 * handlers run, so they set it themselves. Without this `/me` always answered
 * "nobody" and the owner-only routes refused the owner.
 */
r.use((req, _res, next) => {
  const token = tokenOf(req)
  const user = token ? sessionUser(token) : null
  if (user) { req.user = user; req.sessionToken = token }
  else if (trustsLocal(req)) req.user = owner() || null
  next()
})

/**
 * Ask for an account.
 *
 * The password is set now and checked at approval time, so the owner never
 * handles one. A pending account cannot sign in — see /login.
 */
r.post('/request', h((req) => {
  const { login, name = '', password } = req.body || {}
  if (!login || !password) throw badRequest('a login and a password are required')
  if (String(password).length < 8) throw badRequest('the password needs at least 8 characters')
  if (byLogin(login)) throw refused('taken', 'there is already an account with that login')

  // The very first account cannot wait for an owner to approve it, because
  // there is no owner. It becomes one.
  const first = noAccountsYet()
  const user = addUser({
    login, name, password, status: first ? 'active' : 'pending', isOwner: first,
  })
  return { user: publicUser(user), pending: !first }
}))

r.post('/login', h((req, res) => {
  const { login, password } = req.body || {}
  if (!login || !password) throw badRequest('a login and a password are required')

  const user = byLogin(login)
  // One message for a bad login and a bad password. Which of the two was wrong
  // is not something a stranger should be able to learn by asking.
  if (!user || !checkPassword(password, user.password_hash)) {
    throw refused('bad_credentials', 'that login and password do not match')
  }
  // Being right about the password and still not being let in deserves a
  // different answer, or the account waits forever looking like a typo.
  if (user.status === 'pending') {
    throw refused('pending', 'that account is waiting to be approved')
  }
  if (user.status !== 'active') {
    throw refused('blocked', 'that account has been blocked')
  }

  setSessionCookie(req, res, startSession(user.id, deviceOf(req)))
  return { user: publicUser(user) }
}))

r.post('/logout', h((req, res) => {
  const token = readCookie(req, COOKIE)
  if (token) endSession(token)
  clearSessionCookie(req, res)
  res.status(204).end()
}))

/**
 * Who this browser is.
 *
 * Answers 200 with `user: null` rather than 401 when nobody is signed in: this
 * is the question the app asks to find out whether to draw the login page, and
 * an error is not an answer to it. `setup` says the app has no accounts at all,
 * which needs different words on screen from "sign in".
 */
r.get('/me', h((req) => ({
  user: publicUser(req.user),
  setup: noAccountsYet(),
})))

/* ------------------------------------------------------------ the roster */

r.get('/users', h((req) => {
  ownerOnly(req)
  return everyone().map((u) => ({ ...publicUser(u), sessions: sessionsOf(u.id) }))
}))

r.post('/users/:id/approve', h((req) => {
  ownerOnly(req)
  const user = byId(Number(req.params.id))
  if (!user) throw notFound('no such account')
  return publicUser(setStatus(user.id, 'active'))
}))

r.post('/users/:id/block', h((req) => {
  ownerOnly(req)
  const user = byId(Number(req.params.id))
  if (!user) throw notFound('no such account')
  if (user.is_owner) throw refused('is_owner', 'the owner cannot be blocked')
  return publicUser(setStatus(user.id, 'blocked'))
}))

r.delete('/users/:id', h((req, res) => {
  ownerOnly(req)
  const user = byId(Number(req.params.id))
  if (!user) throw notFound('no such account')
  if (user.is_owner) throw refused('is_owner', 'the owner cannot be removed')
  // Their planner file is left alone. Removing an account is about access, and
  // deleting somebody's work as a side effect of it would be a surprise — so an
  // account made again under the same login finds their work still there.
  //
  // The open handle is NOT left alone. A pooled connection outlives the file, so
  // without this a planner deleted from disk would go on answering for whoever
  // next took the slug. See closeFor.
  removeUser(user.id)
  closeFor(user.slug)
  res.status(204).end()
}))

/** Sign one device out — the phone you no longer have. */
r.delete('/sessions/:hash', h((req, res) => {
  ownerOnly(req)
  revokeSession(req.params.hash)
  res.status(204).end()
}))

export default r
