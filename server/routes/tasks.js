import { Router } from 'express'
import { db } from '../db.js'
import { badRequest, crud, h, nextSort, notFound, refused } from './_helpers.js'
// One definition of what the switches mean and how they stack. See runState.
import { stack } from '../../web/src/lib/aiSwitches.js'

const FIELDS = [
  'title', 'notes', 'project_id', 'milestone_id', 'status', 'priority',
  'scheduled_date', 'due_date', 'estimate_min', 'sort', 'from_template',
  'parent_id', 'start_time', 'end_time', 'col_index', 'section_id', 'kind',
  'moved_to_date', 'notes_hidden', 'intensity', 'optional', 'url', 'location',
  'subsection', 'archived', 'group_id', 'is_code',
  'waiting_on', 'origin', 'ai_role', 'ai_switches', 'run_id', 'answers_id',
  'ai_depth', 'seen',
  'scaffold', 'fixed_time', 'timer_started_at', 'timer_elapsed_ms',
  // Present so a deleted routine task keeps its link when restored, the same
  // reason from_template is here.
  'routine_item_id',
]

const tasks = crud('tasks', FIELDS)
const r = Router()

/**
 * A section belongs to one day, so a task that moves to a different day must
 * leave it. Without this a task can sit in a section dated elsewhere and simply
 * stop appearing — it is on neither day's list.
 */
function detachFromForeignSection(id) {
  db.prepare(`
    UPDATE tasks SET section_id = NULL
    WHERE id = ?
      AND section_id IS NOT NULL
      AND scheduled_date IS NOT (SELECT date FROM sections WHERE id = tasks.section_id)
  `).run(id)
}

// Routine membership rides along so a cross-cutting list can drop chores
// without needing a second round-trip per section.
const WITH_PROJECT = `
  SELECT t.*, p.name AS project_name, p.color AS project_color,
         (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comment_count,
         s.name AS section_name, s.routine_id AS routine_id,
         g.name AS group_name, g.meeting_url AS group_meeting_url,
         COALESCE(rt.hide_from_all_tasks, 0) AS hide_from_all_tasks
  FROM tasks t
  LEFT JOIN projects p  ON p.id = t.project_id
  LEFT JOIN sections s  ON s.id = t.section_id
  LEFT JOIN groups g    ON g.id = t.group_id
  LEFT JOIN routines rt ON rt.id = s.routine_id
`

/**
 * Attach attendees to one row or a list of them. `task_people` only ever holds
 * a row per meeting attendee, so reading it whole is cheaper than binding a
 * week's worth of task ids — and every row gets a `people` array either way, so
 * a caller never has to tell "no attendees" from "not loaded".
 */
export function withPeople(rows) {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : []
  if (!list.length) return rows

  const wanted = new Set(list.map((t) => t.id))
  const byTask = new Map()

  const links = db.prepare(`
    SELECT tp.task_id, p.id, p.name, p.color, p.meeting_url
    FROM task_people tp JOIN people p ON p.id = tp.person_id
    ORDER BY p.name
  `).all()

  for (const { task_id, ...person } of links) {
    if (!wanted.has(task_id)) continue
    if (!byTask.has(task_id)) byTask.set(task_id, [])
    byTask.get(task_id).push(person)
  }
  for (const task of list) task.people = byTask.get(task.id) || []

  return rows
}

const readTask = (id) => withPeople(db.prepare(`${WITH_PROJECT} WHERE t.id = ?`).get(id))

/**
 * Replace a task's attendees, and stamp each person's `last_touch` from the
 * meeting's own date — the directory ranks people by it, and booking a meeting
 * is the touch. The stamp only ever moves forward, so back-filling a meeting
 * from March cannot un-touch someone you saw last week.
 */
function setAttendees(taskId, people, date) {
  const id = Number(taskId)
  const ids = [...new Set((people || []).map(Number).filter(Boolean))]

  db.transaction(() => {
    db.prepare('DELETE FROM task_people WHERE task_id = ?').run(id)

    const link = db.prepare('INSERT INTO task_people (task_id, person_id) VALUES (?, ?)')
    const touch = db.prepare(`
      UPDATE people SET last_touch = ?
      WHERE id = ? AND (last_touch IS NULL OR last_touch < ?)
    `)

    for (const personId of ids) {
      link.run(id, personId)
      if (date) touch.run(date, personId, date)
    }
  })()
}

/**
 * Filters, all optional and combinable:
 *   ?date=YYYY-MM-DD          a single day
 *   ?from=…&to=…              an inclusive date range (week/month views)
 *   ?backlog=1                unscheduled only
 *   ?project_id=N             one project
 *   ?status=todo,doing        comma separated
 *   ?q=text                   title search
 */
r.get('/', h((req) => {
  const { date, from, to, backlog, project_id, status, q } = req.query
  const where = []
  const args = []

  if (date) { where.push('t.scheduled_date = ?'); args.push(date) }
  if (from && to) { where.push('t.scheduled_date BETWEEN ? AND ?'); args.push(from, to) }
  if (backlog) where.push('t.scheduled_date IS NULL')
  if (project_id) { where.push('t.project_id = ?'); args.push(project_id) }
  // A note's text lives in `notes`, not `title`, so title-only search could
  // never find one.
  if (q) { where.push('(t.title LIKE ? OR t.notes LIKE ?)'); args.push(`%${q}%`, `%${q}%`) }
  if (status) {
    const list = String(status).split(',').filter(Boolean)
    where.push(`t.status IN (${list.map(() => '?').join(',')})`)
    args.push(...list)
  }

  // The rest of the filters exist for the MCP query language, which turns a
  // written query into these. They are ordinary query parameters, so the web
  // app can use any of them too.
  const { priority, intensity, optional, is_code, section_id, parent_id } = req.query
  const { due_from, due_to, archived, has_notes, order, limit, offset } = req.query

  const oneOf = (col, value) => {
    const list = String(value).split(',').filter(Boolean)
    if (!list.length) return
    where.push(`t.${col} IN (${list.map(() => '?').join(',')})`)
    args.push(...list)
  }
  if (priority) oneOf('priority', priority)
  if (intensity) oneOf('intensity', intensity)
  if (optional !== undefined) { where.push('t.optional = ?'); args.push(Number(optional) ? 1 : 0) }
  if (is_code !== undefined) { where.push('t.is_code = ?'); args.push(Number(is_code) ? 1 : 0) }
  if (section_id) { where.push('t.section_id = ?'); args.push(section_id) }
  const { waiting_on } = req.query
  if (waiting_on === 'none') where.push('t.waiting_on IS NULL')
  else if (waiting_on) oneOf('waiting_on', waiting_on)
  if (parent_id) { where.push('t.parent_id = ?'); args.push(parent_id) }
  if (due_from) { where.push('t.due_date >= ?'); args.push(due_from) }
  if (due_to) { where.push('t.due_date <= ?'); args.push(due_to) }
  // Archived rows are hidden unless asked for, the same as everywhere else.
  if (archived === undefined) where.push('t.archived = 0')
  else if (archived !== 'any') { where.push('t.archived = ?'); args.push(Number(archived) ? 1 : 0) }
  if (has_notes !== undefined) {
    where.push(Number(has_notes) ? "TRIM(t.notes) <> ''" : "TRIM(t.notes) = ''")
  }

  // Only these, spelled out: an ORDER BY built from a query string is an
  // injection waiting to happen, and a fixed list costs nothing.
  const ORDERS = {
    date: 't.scheduled_date IS NULL, t.scheduled_date, t.sort, t.id',
    '-date': 't.scheduled_date IS NULL, t.scheduled_date DESC, t.sort, t.id',
    created: 't.created_at, t.id',
    '-created': 't.created_at DESC, t.id DESC',
    due: 't.due_date IS NULL, t.due_date, t.id',
    // Highest first, which is the only direction anyone means by "by priority".
    priority: `CASE t.priority WHEN 'highest' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
               WHEN 'low' THEN 3 ELSE 4 END, t.scheduled_date IS NULL, t.scheduled_date, t.id`,
    estimate: 't.estimate_min IS NULL, t.estimate_min DESC, t.id',
  }
  const by = ORDERS[order] || ORDERS.date

  // Bound rather than sliced afterwards, so a wide query cannot drag the whole
  // table through the process to throw most of it away.
  const take = Math.min(Math.max(Number(limit) || 200, 1), 500)
  const skip = Math.max(Number(offset) || 0, 0)

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return withPeople(db.prepare(`
    ${WITH_PROJECT} ${clause} ORDER BY ${by} LIMIT ? OFFSET ?
  `).all(...args, take, skip))
}))

/**
 * What one run has spent and what it is still allowed.
 *
 * Two segments, so it cannot be mistaken for a task id. Exists so the tool
 * server does not have to re-derive the terms itself — the answer an agent
 * plans against and the answer the server enforces have to be the same one.
 */
r.get('/runs/:runId', h((req) => {
  const state = runState(req.params.runId)
  if (!state) throw notFound('no such run')
  const budget = Number(state.terms.budget)
  return {
    run_id: req.params.runId,
    brief: { id: state.root.id, title: state.root.title },
    terms: state.terms,
    spent: state.spent,
    budget,
    remaining: Math.max(0, budget - state.spent),
    always_allowed: ALWAYS_ALLOWED,
  }
}))

r.get('/:id', h((req) => readTask(req.params.id)))

/**
 * The terms in force for one run, and what it has spent.
 *
 * A run is every task carrying the same `run_id`. Its terms come from the
 * brief it started with, falling back to the conversation, then to the user's
 * defaults, then to the built-ins — the same four layers the row shows, and
 * literally the same code: the resolver is imported from the web module rather
 * than restated here, because two copies of a precedence rule is two rules
 * that will eventually disagree, and the one the server enforces would be the
 * one nobody was looking at.
 */
function runState(runId) {
  const rows = db.prepare(`
    SELECT t.*, s.ai_switches AS section_switches
    FROM tasks t LEFT JOIN sections s ON s.id = t.section_id
    WHERE t.run_id = ? ORDER BY t.id
  `).all(runId)
  if (!rows.length) return null

  const root = rows.find((r) => r.ai_role === 'brief') || rows[0]
  const defaults = db.prepare("SELECT value FROM settings WHERE key = 'ai_switch_defaults'").get()
  const terms = stack(defaults?.value, root.section_switches, root.ai_switches)
  return { rows, root, terms, spent: rows.length }
}

/**
 * What a run is allowed to create next.
 *
 * Enforced HERE rather than in the tool server, because "the planner refuses"
 * is the promise the switch panel makes, and a limit applied by whatever is
 * calling is a limit the caller can decline to apply.
 *
 * Two roles are exempt from the budget — counted, but never refused: a
 * question, and the answer that reports what was done. They are the two moves
 * that COMMUNICATE, and both hand the turn back to you. Refusing them would
 * turn a spent budget into a silent stop: an agent that cannot ask has no way
 * to say it is stuck, and one that cannot report has done the work and left no
 * record of it. Everything else — its own steps, the follow-ups it would like
 * you to do — is what the ceiling is actually for.
 */
const ALWAYS_ALLOWED = ['question', 'answer']

function checkRunAllows(body) {
  if (!body.run_id || body.origin !== 'ai') return
  const state = runState(body.run_id)
  if (!state) return

  const depth = Number(state.terms.depth)
  const wanted = Number(body.ai_depth || 0)
  if (body.ai_role === 'step' && wanted > depth) {
    throw refused(
      'depth',
      `depth ${wanted} is past the ${depth} this run allows`,
      { depth, allowed: depth },
    )
  }

  if (ALWAYS_ALLOWED.includes(body.ai_role)) return

  const budget = Number(state.terms.budget)
  if (state.spent >= budget) {
    throw refused(
      'budget',
      `budget spent — ${state.spent} of ${budget} tasks in this run. `
        + 'Report what you have, or ask a question: neither is ever refused.',
      { spent: state.spent, budget },
    )
  }
}

/**
 * Comments on a task.
 *
 * Separate from `notes`, which is yours. See the table's own note in db.js for
 * why that separation is the point rather than an implementation detail.
 */
r.get('/:id/comments', h((req) => db
  .prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY id')
  .all(req.params.id)))

r.post('/:id/comments', h((req) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) throw notFound('no such task')
  const body = String(req.body?.body || '').trim()
  if (!body) throw badRequest('a comment needs a body')
  const info = db.prepare(`
    INSERT INTO task_comments (task_id, author, body, kind, minutes)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    task.id,
    String(req.body.author || 'me').slice(0, 80),
    body,
    req.body.kind === 'worklog' ? 'worklog' : 'comment',
    req.body.minutes == null ? null : Math.max(0, Math.round(Number(req.body.minutes) || 0)),
  )
  return db.prepare('SELECT * FROM task_comments WHERE id = ?').get(info.lastInsertRowid)
}))

r.delete('/:id/comments/:commentId', h((req) => {
  db.prepare('DELETE FROM task_comments WHERE id = ? AND task_id = ?')
    .run(req.params.commentId, req.params.id)
  return null
}))

/**
 * Time spent, recorded against the task's own timer and as a worklog comment.
 *
 * Both, deliberately: the timer is what the day's totals read, and the comment
 * is what says where the time went. One without the other is either a number
 * with no story or a story that does not count.
 */
r.post('/:id/worklog', h((req) => {
  const task = db.prepare('SELECT id, timer_elapsed_ms FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) throw notFound('no such task')
  const minutes = Math.round(Number(req.body?.minutes))
  if (!Number.isFinite(minutes) || minutes <= 0) throw badRequest('minutes must be a positive number')

  db.prepare('UPDATE tasks SET timer_elapsed_ms = ? WHERE id = ?')
    .run((task.timer_elapsed_ms || 0) + minutes * 60_000, task.id)
  db.prepare(`
    INSERT INTO task_comments (task_id, author, body, kind, minutes) VALUES (?, ?, ?, 'worklog', ?)
  `).run(
    task.id,
    String(req.body.author || 'me').slice(0, 80),
    String(req.body.comment || '').trim() || `Logged ${minutes}m`,
    minutes,
  )
  return readTask(task.id)
}))

r.post('/', h((req) => {
  const body = { ...(req.body || {}) }

  // Inherit intensity from the project unless the caller was explicit — the
  // whole point is that you almost never set this by hand.
  if (body.intensity === undefined && body.project_id) {
    const project = db.prepare('SELECT default_intensity FROM projects WHERE id = ?').get(body.project_id)
    if (project) body.intensity = project.default_intensity
  }
  checkRunAllows(body)

  // A task written into an AI section starts as the AI's move, because that is
  // what writing one means. Set at creation rather than inferred later: a task
  // with no turn is invisible on a board whose columns ARE the turn, and
  // deciding it on read would guess differently in different places.
  if (body.waiting_on === undefined && body.section_id) {
    const section = db.prepare('SELECT kind FROM sections WHERE id = ?').get(body.section_id)
    if (section?.kind === 'ai') body.waiting_on = 'ai'
  }

  const sort = nextSort(
    'tasks',
    body.scheduled_date ? 'WHERE scheduled_date = ?' : 'WHERE scheduled_date IS NULL',
    body.scheduled_date ? [body.scheduled_date] : []
  )
  const created = tasks.create({ sort, ...body })

  // Attendees live in their own table, so they ride in the same body but are
  // written separately — `crud` only knows about the task's own columns.
  if (body.people !== undefined) setAttendees(created.id, body.people, created.scheduled_date)

  return readTask(created.id)
}))

r.patch('/:id', h((req) => {
  const body = { ...req.body }

  // Re-parenting has to go through /nest, which is the only path that checks
  // for cycles. Allowing it here would let a task become its own ancestor.
  if (body.parent_id !== undefined) {
    throw badRequest('use POST /api/tasks/:id/nest to change a task\'s parent')
  }
  // completed_at tracks the status field so the UI never has to set both.
  if (body.status !== undefined) {
    db.prepare(`UPDATE tasks SET completed_at = ? WHERE id = ?`).run(
      body.status === 'done' ? new Date().toISOString() : null,
      req.params.id
    )
  }
  tasks.update(req.params.id, body)

  // Subtasks live on their parent's day, so rescheduling has to cascade.
  if (body.scheduled_date !== undefined) {
    db.prepare('UPDATE tasks SET scheduled_date = ? WHERE parent_id = ?')
      .run(body.scheduled_date, req.params.id)
    detachFromForeignSection(req.params.id)
  }

  // Read the date back rather than trusting the body: a patch that only adds
  // people still has to stamp last_touch from the day the meeting sits on.
  if (body.people !== undefined) {
    const row = db.prepare('SELECT scheduled_date FROM tasks WHERE id = ?').get(req.params.id)
    setAttendees(req.params.id, body.people, row?.scheduled_date)
  }

  return readTask(req.params.id)
}))

r.delete('/:id', h((req) => {
  tasks.remove(req.params.id)
  return { ok: true }
}))

/**
 * Nest one task under another (or un-nest with parent_id null).
 * A child follows its parent's day, and a task cannot become its own ancestor.
 */
r.post('/:id/nest', h((req) => {
  const id = Number(req.params.id)
  const parentId = req.body?.parent_id ?? null

  if (parentId !== null) {
    if (Number(parentId) === id) throw badRequest('a task cannot be its own parent')
    // Walk up from the proposed parent; meeting `id` would close a cycle.
    let cursor = Number(parentId)
    const seen = new Set()
    while (cursor) {
      if (cursor === id) throw badRequest('that would nest a task inside its own subtree')
      if (seen.has(cursor)) break
      seen.add(cursor)
      cursor = db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(cursor)?.parent_id
    }
    const parent = db.prepare('SELECT scheduled_date FROM tasks WHERE id = ?').get(parentId)
    if (!parent) throw badRequest('parent task not found')
    db.prepare('UPDATE tasks SET parent_id = ?, scheduled_date = ? WHERE id = ?')
      .run(parentId, parent.scheduled_date, id)
  } else {
    db.prepare('UPDATE tasks SET parent_id = NULL WHERE id = ?').run(id)
  }

  return readTask(id)
}))

/**
 * Write a new order for one sibling group.
 * `scheduled_date`, `section_id` and `parent_id` are only applied when the
 * caller actually supplies them — passing ids alone reorders and nothing else,
 * so a reorder inside a project grouping can't silently rewrite dates.
 */
r.post('/reorder', h((req) => {
  const body = req.body || {}
  const ids = body.ids || []
  if (!ids.length) return { ok: true, moved: 0 }

  // These three are properties of the GROUP being reordered: every id in the
  // list shares the day, the section and the parent, so writing one value to
  // all of them is the point.
  const extra = []
  const extraArgs = []
  for (const field of ['scheduled_date', 'section_id', 'parent_id']) {
    if (body[field] !== undefined) {
      extra.push(`${field} = ?`)
      extraArgs.push(body[field])
    }
  }

  const stmt = db.prepare(
    `UPDATE tasks SET sort = ?${extra.length ? `, ${extra.join(', ')}` : ''} WHERE id = ?`
  )
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, ...extraArgs, id)))()

  // col_index is emphatically NOT a group property — it is which of the three
  // columns one task sits in. It was in the loop above, which meant dragging a
  // single task rewrote the column of every one of its siblings and collapsed
  // the whole section into one column. It applies to the moved row alone.
  if (body.col_index !== undefined && body.moved_id) {
    db.prepare('UPDATE tasks SET col_index = ? WHERE id = ?').run(body.col_index, body.moved_id)
  }

  // Children follow a moved parent's day, matching PATCH's cascade.
  if (body.scheduled_date !== undefined) {
    const cascade = db.prepare('UPDATE tasks SET scheduled_date = ? WHERE parent_id = ?')
    db.transaction(() => ids.forEach((id) => cascade.run(body.scheduled_date, id)))()
  }

  return { ok: true, moved: ids.length }
}))

/**
 * Reinstate a deleted task, id included. Undo depends on the id surviving:
 * anything that was nested under this row still carries it as `parent_id`.
 */
r.post('/restore', h((req) => {
  const row = req.body || {}
  if (!row.id) throw badRequest('a full task row is required')

  const cols = ['id', ...FIELDS.filter((f) => row[f] !== undefined)]
  const values = cols.map((c) => (c === 'id' ? row.id : row[c]))

  db.prepare(
    `INSERT OR REPLACE INTO tasks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).run(...values)

  // The snapshot came from a read, so its attendees are person objects. Undoing
  // a deleted meeting has to put them back or the row returns without anyone in
  // it, and nobody's directory entry links to it any more.
  if (row.people) setAttendees(row.id, row.people.map((p) => p.id), row.scheduled_date)

  return readTask(row.id)
}))

/**
 * Roll unfinished tasks from one date onto another.
 * Tasks owned by a section stay put — a section belongs to its own day, and a
 * routine you skipped is not a debt to carry forward.
 */
/**
 * A task's place in the tree, as the titles above it, root first.
 *
 * The title path IS the identity. No id is carried between the day and the
 * backlog, which is what lets a task come back into a tree that has been
 * rebuilt since it left — and equally means two tasks with the same title
 * under the same parent are deliberately one slot.
 */
function titlePath(id) {
  const path = []
  let row = db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(id)
  while (row?.parent_id) {
    const parent = db.prepare('SELECT id, parent_id, title FROM tasks WHERE id = ?').get(row.parent_id)
    if (!parent) break
    path.unshift(parent.title)
    row = parent
  }
  return path
}

/**
 * Every task below one, to any depth. Written once because both directions of
 * the backlog need it and a one-level `parent_id` match silently strands
 * grandchildren.
 */
const DESCENDANTS = `
  WITH RECURSIVE below(id) AS (
    SELECT id FROM tasks WHERE parent_id = ?
    UNION
    SELECT t.id FROM tasks t JOIN below b ON t.parent_id = b.id
  )
  SELECT id FROM below
`

/**
 * Apply one field to a task's whole subtree, and say what it changed.
 *
 * Ticking a parent should tick what is under it — a parent is done when its
 * work is — but the two are separate decisions to take back, so this deals only
 * with the descendants and leaves the task itself to the caller's own patch.
 *
 * The reply carries each row's previous value so undo can restore exactly what
 * was there. Rows already in the target state are skipped rather than recorded:
 * a child you had ticked yourself must not come back un-ticked because a parent
 * was ticked over the top of it later.
 *
 * Only `status` and `optional` are cascadable. Anything else is a field where
 * "and everything under it" is not implied by the gesture.
 */
const CASCADE_FIELDS = new Set(['status', 'optional'])

r.post('/:id/cascade', h((req) => {
  const id = Number(req.params.id)
  const field = String(req.body?.field || '')
  const value = req.body?.value

  if (!CASCADE_FIELDS.has(field)) throw badRequest(`${field} cannot be cascaded`)

  const ids = db.prepare(DESCENDANTS).all(id).map((r2) => r2.id)
  if (!ids.length) return { changed: [] }

  const rows = db.prepare(
    `SELECT id, ${field} AS was FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids)

  // A note has prose, not a state; sweeping one to 'done' would be meaningless
  // and would show up as a stray tick in the day.
  const kinds = new Map(db.prepare(
    `SELECT id, kind FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids).map((k) => [k.id, k.kind]))

  const changed = rows.filter((row) => row.was !== value && kinds.get(row.id) !== 'note')

  db.transaction(() => {
    for (const row of changed) {
      db.prepare(`UPDATE tasks SET ${field} = ? WHERE id = ?`).run(value, row.id)
      if (field === 'status') {
        db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?')
          .run(value === 'done' ? new Date().toISOString() : null, row.id)
      }
    }
  })()

  return { changed: changed.map((row) => ({ id: row.id, was: row.was })) }
}))

/** The first child of `parentId` (top level when null) carrying this title. */
function childByTitle(title, parentId, { date = null, backlog = false } = {}) {
  const where = backlog ? 'scheduled_date IS NULL' : 'scheduled_date IS ?'
  const args = backlog ? [title, parentId] : [title, parentId, date]
  return db.prepare(`
    SELECT * FROM tasks
    WHERE title = ? AND parent_id IS ? AND ${where}
    ORDER BY id LIMIT 1
  `).get(...args)
}

/**
 * Send a task to the backlog, copying the path that identifies it.
 *
 * Without the copies a subtask arrives as a bare title with no sign of what it
 * belonged to, and nothing to match on when it returns. The copies are marked
 * `scaffold` so they are never counted as work, and an existing scaffold chain
 * with the same titles is reused rather than doubled.
 */
r.post('/:id/backlog', h((req) => {
  const id = Number(req.params.id)
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  if (!task) return undefined

  const path = titlePath(id)

  db.transaction(() => {
    let parentId = null
    for (const title of path) {
      const existing = childByTitle(title, parentId, { backlog: true })
      if (existing) { parentId = existing.id; continue }
      const info = db.prepare(`
        INSERT INTO tasks (title, parent_id, scheduled_date, scaffold, sort, project_id)
        VALUES (?, ?, NULL, 1, ?, ?)
      `).run(title, parentId, nextSort('tasks', 'WHERE scheduled_date IS NULL'), task.project_id)
      parentId = info.lastInsertRowid
    }

    db.prepare(`
      UPDATE tasks SET scheduled_date = NULL, section_id = NULL, col_index = NULL, parent_id = ?
      WHERE id = ?
    `).run(parentId, id)
    // The WHOLE branch follows, not just the first generation. A plain
    // `WHERE parent_id = ?` left grandchildren sitting on a day whose parent
    // had gone — visible nowhere, and orphaned from the tree that explained
    // them.
    db.prepare(`
      UPDATE tasks SET scheduled_date = NULL, section_id = NULL, col_index = NULL
      WHERE id IN (${DESCENDANTS})
    `).run(id)
  })()

  return readTask(id)
}))

/**
 * Bring a task back onto a day, rebuilding its path there.
 *
 * Every title is matched against what the day already holds before anything is
 * created, so a task returning beside a sibling that never left joins it rather
 * than raising a second tree with the same names. The scaffolding it travelled
 * with is torn down behind it once nothing hangs off it.
 */
r.post('/:id/schedule', h((req) => {
  const id = Number(req.params.id)
  const { date, section_id = null } = req.body || {}
  if (!date) throw badRequest('date is required')
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  if (!task) return undefined

  const path = titlePath(id)
  const cameFrom = task.parent_id

  db.transaction(() => {
    let parentId = null
    for (const title of path) {
      const existing = childByTitle(title, parentId, { date })
      if (existing) { parentId = existing.id; continue }
      const info = db.prepare(`
        INSERT INTO tasks (title, parent_id, scheduled_date, section_id, sort, project_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(title, parentId, date, parentId ? null : section_id,
        nextSort('tasks', 'WHERE scheduled_date = ?', [date]), task.project_id)
      parentId = info.lastInsertRowid
    }

    db.prepare('UPDATE tasks SET scheduled_date = ?, section_id = ?, parent_id = ? WHERE id = ?')
      .run(date, parentId ? null : section_id, parentId, id)
    // The whole branch comes back too, for the same reason it all left.
    db.prepare(`UPDATE tasks SET scheduled_date = ? WHERE id IN (${DESCENDANTS})`).run(date, id)

    // Walk back up what it hung from, clearing away any scaffold now holding
    // nothing. Scaffolds only: a real backlog task that happens to be childless
    // is still someone's work.
    let up = cameFrom
    while (up) {
      const row = db.prepare('SELECT id, parent_id, scaffold FROM tasks WHERE id = ?').get(up)
      if (!row?.scaffold) break
      if (db.prepare('SELECT COUNT(*) n FROM tasks WHERE parent_id = ?').get(row.id).n > 0) break
      db.prepare('DELETE FROM tasks WHERE id = ?').run(row.id)
      up = row.parent_id
    }
  })()

  return readTask(id)
}))

/**
 * The section a task belongs to, following its parents up. A subtask usually
 * carries none of its own — the band was set on whatever heads the branch — so
 * asking only the task itself finds nothing and the whole tree lands loose.
 */
function sectionOf(id) {
  let row = db.prepare('SELECT section_id, parent_id FROM tasks WHERE id = ?').get(id)
  while (row) {
    if (row.section_id) return row.section_id
    if (!row.parent_id) return null
    row = db.prepare('SELECT section_id, parent_id FROM tasks WHERE id = ?').get(row.parent_id)
  }
  return null
}

/** That band on another day: the one already there by name, or a copy of it. */
function landingSection(fromId, date) {
  if (!fromId) return null
  const from = db.prepare('SELECT * FROM sections WHERE id = ?').get(fromId)
  if (!from) return null

  const there = db.prepare('SELECT id FROM sections WHERE date = ? AND name = ?').get(date, from.name)
  if (there) return there.id

  return db.prepare(`
    INSERT INTO sections (date, name, color, layout, sort, project_id, routine_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(date, from.name, from.color, from.layout,
    nextSort('sections', 'WHERE date = ?', [date]), from.project_id, from.routine_id
  ).lastInsertRowid
}

/**
 * Rebuild a task's ancestry on `date` and return the id it should hang from.
 * Each title is matched against what the day already holds before anything is
 * made, so a task arriving beside relatives that are already there joins them
 * rather than raising a second tree with the same names.
 */
function rebuildPath(path, date, sectionId, project_id) {
  let parentId = null
  for (const title of path) {
    const existing = childByTitle(title, parentId, { date })
    if (existing) { parentId = existing.id; continue }
    const info = db.prepare(`
      INSERT INTO tasks (title, parent_id, scheduled_date, section_id, sort, project_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(title, parentId, date, parentId ? null : sectionId,
      nextSort('tasks', 'WHERE scheduled_date = ?', [date]), project_id)
    parentId = info.lastInsertRowid
  }
  return parentId
}

/**
 * Move a task to another day — or leave it where it is and put a copy there.
 *
 * Both the band it sits in and the parents above it have to exist on the far
 * side, or the task lands somewhere that cannot show it: loose when it belonged
 * to a section, or still pointing at a parent that is on the day it left, which
 * means it appears on neither. The section is found by name or copied; the
 * ancestry is rebuilt by title, the same rule the backlog uses.
 *
 * A copy takes the whole subtree, because half a branch is not a copy of it.
 */
r.post('/:id/move', h((req) => {
  const id = Number(req.params.id)
  const { date, copy = false } = req.body || {}
  if (!date) throw badRequest('date is required')

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  if (!task) return undefined

  const path = titlePath(id)

  const result = db.transaction(() => {
    const landing = landingSection(sectionOf(id), date)
    const parentId = rebuildPath(path, date, landing, task.project_id)

    // Only a root sits in the band directly; anything nested hangs off its
    // parent and would be in two places at once if it also held a section.
    const ownSection = parentId ? null : landing

    if (!copy) {
      // The row itself relocates, so it must NOT be marked as having moved
      // away. `status = 'moved'` with a `moved_to_date` is the stub left behind
      // when work is pushed on from a day — and setting it here meant the task
      // ARRIVED on the target day already closed: it dropped out of that day's
      // open count and out of its total minutes, while nothing at all was left
      // on the day it came from. A task that had been rolled over before comes
      // back to 'todo', because arriving somewhere is not being pushed on.
      db.prepare(`
        UPDATE tasks
        SET scheduled_date = ?, section_id = ?, parent_id = ?,
            moved_to_date = NULL,
            status = CASE WHEN status = 'moved' THEN 'todo' ELSE status END
        WHERE id = ?
      `).run(date, ownSection, parentId, id)

      const kids = db.prepare(DESCENDANTS).all(id).map((row) => row.id)
      for (const kid of kids) {
        // Children follow the date, and then have to let go of any section that
        // belongs to the day they came from. Without this a subtask kept
        // pointing at a band on the old date — a row on one day claiming a
        // section on another, which no view can draw correctly.
        db.prepare('UPDATE tasks SET scheduled_date = ? WHERE id = ?').run(date, kid)
        detachFromForeignSection(kid)
      }
      return id
    }

    // `moved_to_date` is deliberately not carried: a copy was not pushed on
    // from anywhere, it was made here.
    const copyOne = (row, under, sectionId) => {
      const made = db.prepare(`
        INSERT INTO tasks (title, notes, project_id, milestone_id, status, priority,
                           scheduled_date, due_date, estimate_min, sort, parent_id,
                           start_time, end_time, col_index, section_id, kind,
                           notes_hidden, intensity, optional, url, location, subsection)
        VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(row.title, row.notes, row.project_id, row.milestone_id, row.priority,
        date, row.due_date, row.estimate_min,
        nextSort('tasks', 'WHERE scheduled_date = ?', [date]), under,
        row.start_time, row.end_time, row.col_index, sectionId, row.kind,
        row.notes_hidden, row.intensity, row.optional, row.url, row.location, row.subsection)

      const kids = db.prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY sort, id').all(row.id)
      for (const kid of kids) copyOne(kid, made.lastInsertRowid, null)
      return made.lastInsertRowid
    }

    return copyOne(task, parentId, ownSection)
  })()

  return readTask(result)
}))

r.post('/rollover', h((req) => {
  const { from, to } = req.body || {}
  if (!from || !to) throw badRequest('from and to are required')

  const info = db.prepare(`
    UPDATE tasks SET scheduled_date = ?
    WHERE scheduled_date = ?
      AND status IN ('todo','doing')
      AND section_id IS NULL
      AND parent_id IS NULL
      -- A meeting happened at a time, or it didn't. Dragging a missed one onto
      -- today would invent an appointment that was never in the diary.
      AND kind = 'task'
      -- Routine items belong to the day that generated them. Rolling a missed
      -- "Walk" forward sets it against the identical one today's routine already
      -- supplies, so one habit is listed twice and its minutes counted twice.
      AND from_template = 0
  `).run(to, from)

  // Children follow their parents rather than being rolled independently.
  db.prepare(`
    UPDATE tasks SET scheduled_date = ?
    WHERE parent_id IN (SELECT id FROM tasks WHERE scheduled_date = ?)
  `).run(to, to)

  return { moved: info.changes }
}))

export default r
