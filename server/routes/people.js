import { Router } from 'express'
import { db } from '../db.js'
import { badRequest, crud, h, notFound } from './_helpers.js'

const FIELDS = [
  'name', 'role', 'group_id', 'email', 'phone', 'location',
  'tags', 'notes', 'color', 'meeting_url', 'last_touch',
]
const GROUP_FIELDS = ['name', 'kind', 'website', 'meeting_url', 'notes']

const people = crud('people', FIELDS)
const groups = crud('groups', GROUP_FIELDS)

/**
 * A column that exists in the schema but is missing from the allow-lists above
 * makes PATCH answer 200 and change nothing — the write is dropped in silence,
 * which is the hardest kind of bug to see from the UI. This project has shipped
 * it three times, so the mismatch is named at boot instead. `id` and
 * `created_at` are the server's to set, so they are the only exemptions; the
 * check warns rather than throws, because a stale allow-list is not a reason to
 * refuse to serve anything at all.
 */
for (const [table, allowed] of [['people', FIELDS], ['groups', GROUP_FIELDS]]) {
  const dropped = db.prepare(`PRAGMA table_info(${table})`).all()
    .map((c) => c.name)
    .filter((col) => col !== 'id' && col !== 'created_at' && !allowed.includes(col))
  if (dropped.length) {
    console.warn(`[people] ${table}.{${dropped.join(', ')}} is not writable — PATCH will drop it`)
  }
}

const r = Router()

// --- groups (declared before /:id so "groups" isn't read as a person id) ---

const GROUP_WITH_COUNT = `
  SELECT g.*, (SELECT COUNT(*) FROM people p WHERE p.group_id = g.id) AS people_count
  FROM groups g
`

const groupRow = (id) => db.prepare(`${GROUP_WITH_COUNT} WHERE g.id = ?`).get(id)

/**
 * `groups.name` is UNIQUE, so renaming a group onto a name already in use
 * arrives as a raw constraint failure and a 500. Which name clashed is the only
 * part of that a user can act on.
 */
function named(write) {
  try {
    return write()
  } catch (err) {
    if (/UNIQUE constraint failed: groups\.name/.test(err.message)) {
      throw badRequest('a group with that name already exists')
    }
    throw err
  }
}

r.get('/groups', h(() => db.prepare(`${GROUP_WITH_COUNT} ORDER BY g.name`).all()))

r.get('/groups/:id', h((req) => {
  const group = groupRow(req.params.id)
  if (!group) throw notFound('group not found')
  return group
}))

r.post('/groups', h((req) => named(() => groupRow(groups.create(req.body).id))))

// `crud.update` returns undefined for a row that is not there, and `h` only
// answers when the handler returns something — so without this existence check
// a PATCH against a deleted group never responds at all, and the page hangs.
r.patch('/groups/:id', h((req) => {
  if (!groups.get(req.params.id)) throw notFound('group not found')
  named(() => groups.update(req.params.id, req.body))
  return groupRow(req.params.id)
}))

r.delete('/groups/:id', h((req) => {
  groups.remove(req.params.id)
  return { ok: true }
}))

// --- people ---------------------------------------------------------------

const PERSON_WITH_GROUP = `
  SELECT p.*, g.name AS group_name
  FROM people p LEFT JOIN groups g ON g.id = p.group_id
`

const personRow = (id) => db.prepare(`${PERSON_WITH_GROUP} WHERE p.id = ?`).get(id)

r.get('/', h((req) => {
  const { q, group_id, tag } = req.query
  const where = []
  const args = []

  if (q) {
    where.push('(p.name LIKE ? OR p.role LIKE ? OR p.email LIKE ? OR p.tags LIKE ?)')
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }
  if (group_id) { where.push('p.group_id = ?'); args.push(group_id) }
  if (tag) { where.push('p.tags LIKE ?'); args.push(`%${tag}%`) }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return db.prepare(`${PERSON_WITH_GROUP} ${clause} ORDER BY p.name`).all(...args)
}))

r.get('/:id', h((req) => {
  const person = personRow(req.params.id)
  if (!person) throw notFound('person not found')
  return {
    ...person,
    // The project join is what lets these rows render through the same TaskRow
    // the day view uses, rather than a second, poorer display path.
    meetings: db.prepare(`
      SELECT t.*, pr.name AS project_name, pr.color AS project_color
      FROM tasks t
      JOIN task_people tp ON tp.task_id = t.id
      LEFT JOIN projects pr ON pr.id = t.project_id
      WHERE tp.person_id = ?
      ORDER BY t.scheduled_date DESC, t.start_time
    `).all(person.id),
  }
}))

// Both write paths answer with the joined row, so a client that renders the
// group's name never has to re-fetch just to learn it.
r.post('/', h((req) => personRow(people.create(req.body).id)))

r.patch('/:id', h((req) => {
  if (!people.get(req.params.id)) throw notFound('person not found')
  people.update(req.params.id, req.body)
  return personRow(req.params.id)
}))

r.delete('/:id', h((req) => {
  people.remove(req.params.id)
  return { ok: true }
}))

export default r
