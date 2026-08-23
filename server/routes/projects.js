import { Router } from 'express'
import { db } from '../db.js'
import { badRequest, crud, h, nextSort, notFound } from './_helpers.js'

const FIELDS = ['name', 'type_id', 'color', 'description', 'status', 'start_date', 'due_date', 'sort', 'default_intensity']
const M_FIELDS = ['project_id', 'title', 'notes', 'due_date', 'done', 'sort']
const T_FIELDS = ['name', 'color', 'sort']

const projects = crud('projects', FIELDS)
const milestones = crud('milestones', M_FIELDS)
const types = crud('project_types', T_FIELDS)

const r = Router()

// Projects carry their open/done counts so the list view needs only one request.
r.get('/', h((req) => {
  const where = req.query.include_archived ? '' : "WHERE p.status != 'archived'"
  return db.prepare(`
    SELECT p.*, ty.name AS type_name, ty.color AS type_color,
      (SELECT COUNT(*) FROM tasks t
        WHERE t.project_id = p.id AND t.kind = 'task'
          AND t.status IN ('todo','doing') AND t.optional = 0)       AS open_tasks,
      (SELECT COUNT(*) FROM tasks t
        WHERE t.project_id = p.id AND t.kind = 'task'
          AND t.status = 'done')                                    AS done_tasks,
      -- Time, not just counts. Dropped and moved work is excluded from both:
      -- it is no longer on the plate, so it should not inflate the denominator.
      (SELECT COALESCE(SUM(t.estimate_min), 0) FROM tasks t
        WHERE t.project_id = p.id AND t.kind = 'task'
          AND t.status NOT IN ('dropped','moved'))                  AS total_min,
      (SELECT COALESCE(SUM(t.estimate_min), 0) FROM tasks t
        WHERE t.project_id = p.id AND t.kind = 'task'
          AND t.status = 'done')                                    AS done_min,
      (SELECT COUNT(*) FROM milestones m
        WHERE m.project_id = p.id AND m.done = 0)                   AS open_milestones,
      (SELECT MIN(m.due_date) FROM milestones m
        WHERE m.project_id = p.id AND m.done = 0 AND m.due_date IS NOT NULL) AS next_due
    FROM projects p LEFT JOIN project_types ty ON ty.id = p.type_id ${where}
    ORDER BY p.sort, p.name
  `).all()
}))

// --- types ----------------------------------------------------------------
// Ahead of `/:id`, which would otherwise swallow "types" as a project id.

/**
 * Rewrite the whole order from the list the client is showing. Sending the full
 * sequence rather than one moved id means the result cannot drift from what was
 * on screen, and repeated drags never accumulate ties for `sort` to break.
 */
r.post('/reorder', h((req) => {
  const ids = req.body?.ids
  if (!Array.isArray(ids)) throw badRequest('ids array required')

  const set = db.prepare('UPDATE projects SET sort = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => set.run(i, id)))()

  return { ok: true, ordered: ids.length }
}))

r.get('/types', h(() => types.list('', [], 'sort, name')))

r.post('/types', h((req) => types.create({ sort: nextSort('project_types'), ...req.body })))

r.patch('/types/:tid', h((req) => {
  const before = types.get(req.params.tid)
  const updated = types.update(req.params.tid, req.body)
  // `!== undefined`, not truthiness: clearing a type's colour is still a
  // colour change, and the truthy test skipped the repaint for it.
  if (req.body?.color !== undefined) repaintProjectsOfType(Number(req.params.tid), before?.color)
  return updated
}))

/** projects.type_id is ON DELETE SET NULL, so the projects outlive their type. */
r.delete('/types/:tid', h((req) => {
  types.remove(req.params.tid)
  return { ok: true }
}))

r.get('/:id', h((req) => {
  // Joined here as well as on the list, so the detail page doesn't need a
  // second request just to name the project's type.
  const project = db.prepare(`
    SELECT p.*, ty.name AS type_name, ty.color AS type_color
    FROM projects p LEFT JOIN project_types ty ON ty.id = p.type_id
    WHERE p.id = ?
  `).get(req.params.id)
  if (!project) throw notFound('project not found')
  return {
    ...project,
    milestones: milestones.list('WHERE project_id = ?', [project.id], 'done, sort, due_date'),
    // Notes are prose, not work: they have no status to close and no time to
    // estimate, so they are split out here rather than left for the client to
    // filter — anything reading `tasks` gets only things that can be done.
    tasks: db.prepare(`
      SELECT * FROM tasks WHERE project_id = ? AND kind IN ('task','meeting')
      ORDER BY status = 'done', scheduled_date IS NULL, scheduled_date, sort
    `).all(project.id),
    // A note with no day is one of the project's own sections and keeps the
    // order it was given; a dated one was written on that day and merely tagged
    // with this project, so those read newest first.
    notes: db.prepare(`
      SELECT * FROM tasks WHERE project_id = ? AND kind = 'note'
      ORDER BY scheduled_date IS NULL DESC, scheduled_date DESC, sort, id
    `).all(project.id),
    people: db.prepare(`
      SELECT DISTINCT pe.* FROM people pe
      JOIN task_people tp ON tp.person_id = pe.id
      JOIN tasks t        ON t.id = tp.task_id
      WHERE t.project_id = ?
      ORDER BY pe.name
    `).all(project.id),
  }
}))

r.post('/', h((req) => {
  const body = { ...req.body }
  if (body.type_id != null && !body.color) {
    const type = db.prepare('SELECT color FROM project_types WHERE id = ?').get(body.type_id)
    if (type) body.color = type.color
  }
  return projects.create({ sort: nextSort('projects'), ...body })
}))

/**
 * Recolour the projects of a type when the type itself is recoloured — but only
 * those still wearing the type's previous colour. A project whose colour was set
 * deliberately away from the default is an override the PATCH handler below
 * explicitly honours, and repainting unconditionally wiped it the next time the
 * type changed. Without a previous colour to compare against there is nothing to
 * distinguish an override from an inherited value, so fall back to repainting
 * all of them.
 */
function repaintProjectsOfType(typeId, previousColor) {
  if (previousColor == null) {
    db.prepare(`
      UPDATE projects SET color = (SELECT color FROM project_types WHERE id = ?)
      WHERE type_id = ?
    `).run(typeId, typeId)
    return
  }
  db.prepare(`
    UPDATE projects SET color = (SELECT color FROM project_types WHERE id = ?)
    WHERE type_id = ? AND color = ?
  `).run(typeId, typeId, previousColor)
}
r.patch('/:id', h((req) => {
  const body = { ...req.body }

  // Scoping a project to a type adopts that type's colour, unless the caller is
  // setting a colour in the same breath — an explicit choice still wins.
  if (body.type_id != null && body.color === undefined) {
    const type = db.prepare('SELECT color FROM project_types WHERE id = ?').get(body.type_id)
    if (type) body.color = type.color
  }

  db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(req.params.id)
  return projects.update(req.params.id, body)
}))
/**
 * Deleting a project takes its tasks and notes with it. The foreign key is
 * ON DELETE SET NULL, which would otherwise tip the whole project into the
 * day's loose list — a silent mess rather than a deletion.
 *
 * `?keep_tasks=1` opts back into detaching them.
 */
r.delete('/:id', h((req) => {
  const id = Number(req.params.id)
  const counts = db.prepare(`
    SELECT
      COALESCE(SUM(kind = 'task'), 0) AS tasks,
      COALESCE(SUM(kind = 'note'), 0) AS notes
    FROM tasks WHERE project_id = ?
  `).get(id)

  db.transaction(() => {
    if (req.query.keep_tasks) {
      db.prepare('UPDATE tasks SET project_id = NULL WHERE project_id = ?').run(id)
    } else {
      // Children first: a subtask of a deleted task has nothing left to hang off.
      db.prepare('DELETE FROM tasks WHERE parent_id IN (SELECT id FROM tasks WHERE project_id = ?)').run(id)
      db.prepare('DELETE FROM tasks WHERE project_id = ?').run(id)
    }
    projects.remove(id)
  })()

  return { ok: true, deleted: req.query.keep_tasks ? { tasks: 0, notes: 0 } : counts }
}))

/** What a delete would take with it, so the confirmation can be specific. */
r.get('/:id/impact', h((req) => db.prepare(`
  SELECT
    COALESCE(SUM(kind = 'task'), 0) AS tasks,
    COALESCE(SUM(kind = 'note'), 0) AS notes,
    (SELECT COUNT(*) FROM milestones WHERE project_id = ?) AS milestones
  FROM tasks WHERE project_id = ?
`).get(req.params.id, req.params.id)))

// --- milestones ---------------------------------------------------------

r.post('/:id/milestones', h((req) => milestones.create({
  project_id: Number(req.params.id),
  sort: nextSort('milestones', 'WHERE project_id = ?', [req.params.id]),
  ...req.body,
})))

r.patch('/milestones/:mid', h((req) => milestones.update(req.params.mid, req.body)))
r.delete('/milestones/:mid', h((req) => {
  milestones.remove(req.params.mid)
  return { ok: true }
}))

export default r
