import { Router } from 'express'
import { db } from '../db.js'
import { badRequest, h, nextSort, notFound } from './_helpers.js'
import { all, bySource } from '../integrations/registry.js'
import { connectionFor, linkedOne, reconcile, reconcileAll } from '../integrations/sync.js'

/**
 * The planner's end of any external task system.
 *
 * Reads are proxied rather than made from the page: credentials stay on this
 * side, and the browser asks the planner for everything. The picker is
 * therefore an ordinary planner API consumer and knows nothing about any
 * particular system's shapes.
 *
 * Nothing here mirrors. `POST /link` is the only way a task acquires an
 * `ext_source`, and every other route ignores tasks without one — so what syncs
 * is exactly what somebody chose, and un-choosing it is one call away.
 */
const r = Router()

const linkFor = (name) => {
  const link = connectionFor(name)
  if (!link) throw badRequest(`${name} is not configured`)
  return link
}

/** What can be connected, and what is. Drives the settings tab and the picker. */
r.get('/', h(() => ({
  sources: all().map((a) => {
    const link = connectionFor(a.name)
    return {
      name: a.name,
      label: a.label,
      fields: a.fields.map(({ key, label, hint, placeholder, secret }) => ({
        key, label, hint, placeholder, secret: !!secret,
      })),
      configured: !!link,
      on: !!link?.on,
    }
  }),
})))

/** Does the connection work, and who does it say we are? */
r.get('/:name/status', h(async (req) => {
  const link = connectionFor(req.params.name)
  if (!link) return { configured: false, on: false }
  try {
    return { configured: true, on: link.on, ok: true, actor: await link.adapter.whoami(link.conn) }
  } catch (e) {
    return { configured: true, on: link.on, ok: false, error: e.message }
  }
}))

r.get('/:name/containers', h(async (req) => {
  const link = linkFor(req.params.name)
  return { containers: await link.adapter.containers(link.conn) }
}))

/**
 * The work under one container, each item saying whether it is already here —
 * so the picker can show it as taken rather than offering a second copy.
 */
r.get('/:name/items', h(async (req) => {
  const parent = String(req.query.parent || '')
  if (!parent) throw badRequest('parent is required')
  const link = linkFor(req.params.name)

  const already = new Map(
    db.prepare('SELECT ext_id, id FROM tasks WHERE ext_source = ?').all(req.params.name)
      .map((t) => [t.ext_id, t.id]),
  )
  const items = (await link.adapter.items(link.conn, parent))
    .map((i) => ({ ...i, linked_task_id: already.get(i.id) ?? null }))
  return { items }
}))

/**
 * Take these into the planner.
 *
 * They land in the backlog — unscheduled — because the other system has no
 * opinion about which day you will do a thing on and the planner should not
 * invent one. Choosing the day is the next thing a person does, with the list
 * in front of them.
 *
 * The project is created on demand from the container, matched by `ext_id`
 * rather than by name, so renaming either side does not fork it in two.
 */
r.post('/:name/link', h(async (req) => {
  const name = req.params.name
  const ids = Array.isArray(req.body?.items) ? req.body.items : []
  if (!ids.length) throw badRequest('items is required')
  const link = linkFor(name)

  const parent = req.body.parent || null
  let projectId = null
  if (parent) {
    const seen = db.prepare('SELECT id FROM projects WHERE ext_source = ? AND ext_id = ?')
      .get(name, parent)
    if (seen) projectId = seen.id
    else {
      const container = (await link.adapter.containers(link.conn)).find((c) => c.id === parent)
      const title = container?.title || `${link.adapter.label} ${parent.slice(0, 8)}`
      // `projects.name` is UNIQUE, so a project already carrying this name is
      // adopted rather than fought with — the alternative is a constraint error
      // halfway through an import that has already created tasks.
      const byName = db.prepare('SELECT id FROM projects WHERE name = ?').get(title)
      projectId = byName
        ? byName.id
        : db.prepare('INSERT INTO projects (name, sort) VALUES (?, ?)')
          .run(title, nextSort('projects')).lastInsertRowid
      db.prepare('UPDATE projects SET ext_source = ?, ext_id = ? WHERE id = ?')
        .run(name, parent, projectId)
    }
  }

  const made = []
  for (const id of ids) {
    const seen = db.prepare('SELECT id FROM tasks WHERE ext_source = ? AND ext_id = ?').get(name, id)
    if (seen) { made.push({ id: seen.id, already: true }); continue }

    const item = await link.adapter.read(link.conn, id)
    const want = link.adapter.statusToPlanner(item.status)
    const info = db.prepare(
      `INSERT INTO tasks (title, notes, status, waiting_on, due_date, project_id, sort,
                          origin, ext_source, ext_id, ext_key, ext_status, ext_notes, ext_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      item.title, item.notes, want.status, want.waiting_on, item.due_date,
      projectId, nextSort('tasks'), name, name, item.id, item.key, item.status, item.notes,
    )
    made.push({ id: Number(info.lastInsertRowid), key: item.key })
  }
  return { linked: made, project_id: projectId }
}))

/** Stop syncing this task. It stays as it is; it just stops listening. */
r.post('/unlink/:id', h((req) => {
  const task = linkedOne(Number(req.params.id))
  if (!task) throw notFound('no such task')
  db.prepare(
    `UPDATE tasks SET ext_source = NULL, ext_id = NULL, ext_key = NULL,
                      ext_status = NULL, ext_notes = NULL, ext_seen_at = NULL WHERE id = ?`,
  ).run(task.id)
  return { unlinked: task.id, was: task.ext_key }
}))

/** What is currently linked, for the settings tab and for the daemon. */
r.get('/links', h(() => ({
  links: db.prepare(
    // ext_id is here for the daemon: a live feed names external ids, and this
    // is what turns one into the task it belongs to.
    `SELECT id, title, status, ext_source, ext_id, ext_key, ext_status, ext_seen_at
       FROM tasks WHERE ext_source IS NOT NULL ORDER BY ext_source, ext_key`,
  ).all(),
})))

/** One task, brought back into step now. The daemon calls the same code. */
r.post('/reconcile/:id', h(async (req) => {
  const task = linkedOne(Number(req.params.id))
  if (!task?.ext_source) throw notFound('that task is not linked')
  const link = linkFor(task.ext_source)
  const item = await link.adapter.read(link.conn, task.ext_id)
  return reconcile(task, item, link)
}))

/** Everything linked, one pass. The manual "sync now". */
r.post('/reconcile', h(async () => ({ ran: await reconcileAll() })))

export default r
