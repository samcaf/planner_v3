/**
 * A planner each, and no way for one to see another's.
 *
 * The isolation here is structural rather than a predicate somebody remembered
 * to write: two people's rows are in two files, and a request only ever has one
 * of them open. So the thing worth pinning is not that a filter works, but that
 * the id namespaces are genuinely separate — two people can both own task 1,
 * which a `user_id` column could never allow and which no missing WHERE clause
 * can undo.
 *
 * Pure fetch, no jsdom: this is about which file a request reaches.
 */
import { accounts, addUser, byLogin, startSession } from '../server/accounts.js'
import Database from 'better-sqlite3'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const TRUSTED = process.env.PLANNER_API || 'http://localhost:8787'
const PUBLIC = process.env.PLANNER_PUBLIC_API || 'http://localhost:8789'
const D = '2032-03-03'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const made = []

const jsonHeaders = { 'content-type': 'application/json' }
/** Act as somebody, by the token they carry rather than a cookie. */
const as = (tok, path, opts = {}) => fetch(PUBLIC + path, {
  ...opts, headers: { ...(opts.body ? jsonHeaders : {}), 'x-planner-token': tok },
})
const body = (r) => r.json()

/** Row counts straight from the owner's file, to prove nothing touched it. */
const ownerCounts = () => {
  const d = new Database('data/planner.db', { readonly: true })
  const out = {}
  for (const t of ['tasks', 'days', 'sections', 'projects', 'routines', 'notebook', 'settings']) {
    out[t] = d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n
  }
  d.close()
  return out
}

const person = (login) => {
  const old = byLogin(login)
  if (old) accounts.prepare('DELETE FROM users WHERE id = ?').run(old.id)
  const u = addUser({ login, password: 'probe-password-70', status: 'active' })
  made.push(u)
  return { user: u, token: startSession(u.id, 'batch70') }
}

const before = ownerCounts()
try {
  const a = person('zzp70-a')
  const b = person('zzp70-b')

  // ── a fresh planner is empty, and is its own file ────────────────────────
  check('a new person starts with nothing',
    (await body(await as(a.token, '/api/tasks?limit=500'))).length === 0)
  check('including no projects of the owner’s',
    (await body(await as(a.token, '/api/projects'))).length === 0)
  check('and gets a file of their own',
    existsSync(join('data/users', `${a.user.slug}.db`)), `data/users/${a.user.slug}.db`)

  // ── each writes; neither sees the other ──────────────────────────────────
  const made1 = await body(await as(a.token, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: 'ZZ a-task', scheduled_date: D }),
  }))
  const made2 = await body(await as(b.token, '/api/tasks', {
    method: 'POST', body: JSON.stringify({ title: 'ZZ b-task', scheduled_date: D }),
  }))

  // The heart of it. Both are the first row in their own file, so both are id 1.
  check('two people can hold the same task id', made1.id === made2.id,
    `${made1.id} vs ${made2.id}`)
  check('and it is a different task to each',
    (await body(await as(a.token, `/api/tasks/${made1.id}`))).title === 'ZZ a-task'
    && (await body(await as(b.token, `/api/tasks/${made2.id}`))).title === 'ZZ b-task')

  const aSees = await body(await as(a.token, `/api/tasks?date=${D}`))
  const bSees = await body(await as(b.token, `/api/tasks?date=${D}`))
  check('on the same day, each sees only their own',
    aSees.length === 1 && aSees[0].title === 'ZZ a-task'
    && bSees.length === 1 && bSees[0].title === 'ZZ b-task',
    `${aSees.map((t) => t.title)} / ${bSees.map((t) => t.title)}`)

  // ── the two endpoints that read widest ───────────────────────────────────
  const aFound = await body(await as(a.token, '/api/search?q=b-task'))
  const hits = Object.values(aFound).filter(Array.isArray).flat().length
  check('search cannot reach across', hits === 0, `${hits} hits`)

  const aDash = await body(await as(a.token, '/api/dashboard'))
  check('nor can the dashboard', !JSON.stringify(aDash).includes('b-task'))

  // ── everything else that is per person ──────────────────────────────────
  await as(a.token, '/api/settings', { method: 'PATCH', body: JSON.stringify({ zz70: 'a' }) })
  const bSettings = await body(await as(b.token, '/api/settings'))
  check('settings are their own', bSettings.zz70 === undefined, JSON.stringify(bSettings.zz70))

  await as(a.token, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'ZZ a-project' }) })
  check('projects are their own',
    (await body(await as(b.token, '/api/projects'))).length === 0)

  await as(a.token, '/api/people', { method: 'POST', body: JSON.stringify({ name: 'ZZ a-person' }) })
  check('the people directory is their own',
    (await body(await as(b.token, '/api/people'))).length === 0)

  await as(a.token, `/api/days/${D}`, { method: 'PATCH', body: JSON.stringify({ notes: 'ZZ a-note' }) })
  const bDay = await body(await as(b.token, `/api/days/${D}`))
  check('day notes are their own', !(bDay.day?.notes || bDay.notes || '').includes('ZZ a-note'),
    JSON.stringify(bDay.day?.notes ?? bDay.notes ?? ''))

  // ── attachments are on disk, not in the database, so they need their own
  //    directory or content addressing would silently share one file ───────
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  await as(a.token, '/api/uploads', {
    method: 'POST', body: JSON.stringify({ name: 'zz70.png', data: png }),
  })
  const aFiles = await body(await as(a.token, '/api/uploads'))
  const bFiles = await body(await as(b.token, '/api/uploads'))
  check('an upload lands for the person who made it', aFiles.length === 1, String(aFiles.length))
  check('and is invisible to everyone else', bFiles.length === 0, String(bFiles.length))

  // ── the owner, who is on the original file, is untouched ─────────────────
  const after = ownerCounts()
  check('the owner’s planner did not move or change',
    JSON.stringify(before) === JSON.stringify(after),
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  const ownerDay = await body(await fetch(`${TRUSTED}/api/tasks?date=${D}`))
  check('and the owner sees nothing either of them wrote', ownerDay.length === 0,
    JSON.stringify(ownerDay.map((t) => t.title)))
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  // Through the API, not the module. Removing an account server-side is what
  // makes the server let go of the open handle — delete the file behind its
  // back and the connection lives on, so the next run with the same slug is
  // handed a database that answers and exists nowhere. That is exactly how this
  // suite failed the second time it ran.
  for (const u of made) {
    await fetch(`${TRUSTED}/api/auth/users/${u.id}`, { method: 'DELETE' }).catch(() => {})
    if (byLogin(u.login)) accounts.prepare('DELETE FROM users WHERE id = ?').run(u.id)
    for (const p of [`data/users/${u.slug}.db`, `data/users/${u.slug}.db-wal`,
      `data/users/${u.slug}.db-shm`, `data/users/${u.slug}`]) {
      rmSync(p, { recursive: true, force: true })
    }
  }
  console.log('cleanup: probe people and their planners removed')
  process.exit(bad ? 1 : 0)
}
