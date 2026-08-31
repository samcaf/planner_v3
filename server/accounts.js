/**
 * Who is allowed in, and which of their devices are signed in.
 *
 * The only thing everyone holds in common. Planner data is per person and
 * lives in its own file; this database holds nothing but the roster and the
 * live sessions, and it is opened by its own connection so that the per-user
 * plumbing has nothing to do with it.
 *
 * Two deliberate omissions, both for the same reason — this project has eight
 * runtime dependencies and is worth keeping that way:
 *
 *   scrypt from `node:crypto` rather than bcrypt or argon2. It is a real
 *   password KDF, it is in the standard library, and the parameters are
 *   written into every stored hash so they can be raised later without
 *   invalidating what is already there.
 *
 *   cookies parsed by hand rather than `cookie-parser`. Reading one header is
 *   five lines; `res.cookie()` for writing is already part of Express.
 *
 * A session is a random token the server never stores. What is stored is its
 * SHA-256, so a copy of this file does not let anyone sign in as anybody — the
 * same reason a password file holds hashes.
 */
import Database from 'better-sqlite3'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

export const ACCOUNTS_PATH = process.env.PLANNER_ACCOUNTS_DB
  || join(root, 'data', 'accounts.db')

mkdirSync(dirname(ACCOUNTS_PATH), { recursive: true })

export const accounts = new Database(ACCOUNTS_PATH)
accounts.pragma('journal_mode = WAL')
accounts.pragma('foreign_keys = ON')

accounts.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  -- What you type into the login box, folded to lower case. Kept apart from
  -- the slug because a login can be an email and a slug has to be a filename.
  login         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  -- The name of this person's planner file. Assigned at sign-up so that
  -- nothing has to rename a database later.
  slug          TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | active | blocked
  is_owner      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  -- The SHA-256 of the cookie, never the cookie. See the file comment.
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Enough to recognise a device in a list of them, not a fingerprint.
  device     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`)

/* ------------------------------------------------------------- passwords */

// Node's own defaults, named here because they are written into every hash and
// a future change has to be able to tell old from new.
const SCRYPT = { N: 16384, r: 8, p: 1, len: 32 }

export function hashPassword(password, params = SCRYPT) {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, params.len, { N: params.N, r: params.r, p: params.p })
  return [
    'scrypt', params.N, params.r, params.p,
    salt.toString('base64'), key.toString('base64'),
  ].join('$')
}

/**
 * Constant-time, and false rather than throwing on anything malformed.
 *
 * A stored hash that cannot be parsed is a refusal, not a crash: whatever wrote
 * it, the one thing that must not happen is letting the request through.
 */
export function checkPassword(password, stored) {
  try {
    const [kind, N, r, p, salt, key] = String(stored).split('$')
    if (kind !== 'scrypt') return false
    const want = Buffer.from(key, 'base64')
    const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length, {
      N: Number(N), r: Number(r), p: Number(p),
    })
    return got.length === want.length && timingSafeEqual(got, want)
  } catch {
    return false
  }
}

/* ---------------------------------------------------------------- people */

/** Case and stray spaces do not decide who you are. */
export const normaliseLogin = (s) => String(s || '').trim().toLowerCase()

/**
 * A login as a filename.
 *
 * It has to survive being a path segment, so everything outside a small
 * alphabet becomes a dash. Collisions are resolved with a counter rather than
 * by rejecting the login — `sam@work` and `sam.work` are different people who
 * should not be told to pick a different name.
 */
export function slugFor(login, taken = (s) => !!bySlug(s)) {
  const base = normaliseLogin(login)
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'user'
  let slug = base
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`
  return slug
}

export const byLogin = (login) =>
  accounts.prepare('SELECT * FROM users WHERE login = ?').get(normaliseLogin(login))

export const bySlug = (slug) => accounts.prepare('SELECT * FROM users WHERE slug = ?').get(slug)

export const byId = (id) => accounts.prepare('SELECT * FROM users WHERE id = ?').get(id)

export const owner = () =>
  accounts.prepare('SELECT * FROM users WHERE is_owner = 1 ORDER BY id LIMIT 1').get()

export const everyone = () =>
  accounts.prepare('SELECT * FROM users ORDER BY is_owner DESC, login').all()

/**
 * Create a person. Pending unless it is the first, which is the owner.
 *
 * The owner is whoever the setup script names, not whoever reaches the page
 * first: this app is on a tailnet before it has a login, so "first visitor
 * wins" would be a race anyone on the network could enter.
 */
export function addUser({ login, name = '', password, status = 'pending', isOwner = false }) {
  const at = normaliseLogin(login)
  if (!at) throw new Error('a login is required')
  if (!password) throw new Error('a password is required')
  if (byLogin(at)) throw new Error(`${at} already has an account`)

  const info = accounts.prepare(`
    INSERT INTO users (login, name, slug, password_hash, status, is_owner, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    at, name, slugFor(at), hashPassword(password), status, isOwner ? 1 : 0,
    status === 'active' ? new Date().toISOString() : null,
  )
  return byId(info.lastInsertRowid)
}

export function setStatus(id, status) {
  accounts.prepare('UPDATE users SET status = ?, approved_at = ? WHERE id = ?')
    .run(status, status === 'active' ? new Date().toISOString() : null, id)
  // Blocking someone has to end their sessions too, or the block only applies
  // to a login they were not about to do.
  if (status !== 'active') accounts.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
  return byId(id)
}

export function setPassword(id, password) {
  accounts.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id)
}

/** Removing a person takes their sessions with them; their planner file stays. */
export function removeUser(id) {
  accounts.prepare('DELETE FROM users WHERE id = ?').run(id)
}

/* -------------------------------------------------------------- sessions */

const digest = (token) => createHash('sha256').update(String(token)).digest('hex')

/**
 * Start a session and return the raw token — the only moment it exists.
 *
 * `device` is whatever the browser called itself, trimmed. It is there so a
 * list of live sessions reads as a list of things you own rather than a list of
 * hashes, not as anything security rests on.
 */
export function startSession(userId, device = '') {
  const token = randomBytes(32).toString('base64url')
  accounts.prepare('INSERT INTO sessions (token_hash, user_id, device) VALUES (?, ?, ?)')
    .run(digest(token), userId, String(device).slice(0, 200))
  return token
}

/**
 * The person a token belongs to, or null.
 *
 * Touches `last_seen` on the way through, which is what lets the owner tell a
 * phone still in use from one lost two years ago. Blocked and pending accounts
 * resolve to null even holding a valid token: approval can be withdrawn.
 */
export function sessionUser(token) {
  if (!token) return null
  const hash = digest(token)
  const row = accounts.prepare(`
    SELECT u.*, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(hash)
  if (!row) return null
  if (row.status !== 'active') return null
  accounts.prepare("UPDATE sessions SET last_seen = datetime('now') WHERE token_hash = ?").run(hash)
  return row
}

export const endSession = (token) =>
  accounts.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token))

export const revokeSession = (tokenHash) =>
  accounts.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)

export const sessionsOf = (userId) => accounts.prepare(
  'SELECT token_hash, device, created_at, last_seen FROM sessions WHERE user_id = ? ORDER BY last_seen DESC',
).all(userId)

/** What a user looks like to the client: never the hash, never the token. */
export const publicUser = (u) => (u ? {
  id: u.id,
  login: u.login,
  name: u.name,
  slug: u.slug,
  status: u.status,
  is_owner: !!u.is_owner,
  created_at: u.created_at,
  approved_at: u.approved_at,
} : null)

/* ------------------------------------------------------------------- cli */

/**
 * `node server/accounts.js …` — the way the first account gets made.
 *
 * In the style of the migrate scripts beside it: run by hand, says what it did,
 * and refuses rather than guessing.
 */
const COMMANDS = {
  async 'add-owner'([login]) {
    if (!login) throw new Error('usage: add-owner <login>')
    if (owner()) throw new Error(`there is already an owner: ${owner().login}`)
    const password = await promptSecret(`password for ${login}: `)
    const user = addUser({ login, password, status: 'active', isOwner: true })
    console.log(`owner ${user.login} created — planner file will be data/users/${user.slug}.db`)
  },

  async add([login]) {
    if (!login) throw new Error('usage: add <login>')
    const password = await promptSecret(`password for ${login}: `)
    const user = addUser({ login, password, status: 'active' })
    console.log(`${user.login} created and approved (slug ${user.slug})`)
  },

  async passwd([login]) {
    const user = byLogin(login)
    if (!user) throw new Error(`no account for ${login}`)
    setPassword(user.id, await promptSecret(`new password for ${user.login}: `))
    console.log(`password changed for ${user.login}`)
  },

  approve([login]) {
    const user = byLogin(login)
    if (!user) throw new Error(`no account for ${login}`)
    setStatus(user.id, 'active')
    console.log(`${user.login} approved`)
  },

  block([login]) {
    const user = byLogin(login)
    if (!user) throw new Error(`no account for ${login}`)
    setStatus(user.id, 'blocked')
    console.log(`${user.login} blocked, and their sessions ended`)
  },

  list() {
    const rows = everyone()
    if (!rows.length) { console.log('nobody yet — start with: add-owner <login>'); return }
    for (const u of rows) {
      const live = sessionsOf(u.id).length
      console.log(
        `${u.login.padEnd(24)} ${u.status.padEnd(8)} ${u.is_owner ? 'owner' : '     '}`
        + `  ${u.slug.padEnd(16)} ${live} device${live === 1 ? '' : 's'}`,
      )
    }
  },
}

/** A password should not end up in the shell history or on the screen. */
async function promptSecret(prompt) {
  const { createInterface } = await import('node:readline')
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  process.stdout.write(prompt)
  // Muting the output stream is what hides the echo; readline still reads it.
  const mute = (chunk, encoding, cb) => { cb() }
  const original = rl.output.write.bind(rl.output)
  rl.output.write = mute
  const answer = await new Promise((resolve) => rl.question('', resolve))
  rl.output.write = original
  process.stdout.write('\n')
  rl.close()
  if (!answer) throw new Error('no password given')
  return answer
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [cmd, ...args] = process.argv.slice(2)
  const run = COMMANDS[cmd]
  if (!run) {
    console.error(`usage: node server/accounts.js <${Object.keys(COMMANDS).join(' | ')}> [login]`)
    process.exit(1)
  }
  try {
    await run(args)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
