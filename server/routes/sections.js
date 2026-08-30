import { Router } from 'express'
import { db } from '../db.js'
import { badRequest, crud, h, nextSort, notFound } from './_helpers.js'

const FIELDS = ['date', 'name', 'project_id', 'layout', 'color', 'collapsed', 'sort', 'kind', 'ai_switches']
const sections = crud('sections', FIELDS)

const r = Router()

r.get('/', h((req) => {
  const { date } = req.query
  if (!date) throw badRequest('date required')
  return db.prepare(`
    SELECT s.*, p.name AS project_name, p.color AS project_color
    FROM sections s LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.date = ? ORDER BY s.sort, s.id
  `).all(date)
}))

r.post('/', h((req) => {
  const body = req.body || {}
  if (!body.date || !body.name) throw badRequest('date and name required')
  return sections.create({
    sort: nextSort('sections', 'WHERE date = ?', [body.date]),
    // An AI section is a board of who owes whom a move, so it is three-box by
    // nature — a list would have nowhere to show the turn.
    ...(body.kind === 'ai' ? { layout: 'columns' } : {}),
    ...body,
  })
}))

/**
 * One section. Needed by anything that has a task and wants the terms it is
 * worked under — the section is the middle layer, and reaching it through the
 * whole day just to read one field is a lot of rows for one answer.
 */
r.get('/:id', h((req) => sections.get(req.params.id)))

r.patch('/:id', h((req) => sections.update(req.params.id, req.body)))

/**
 * Deleting a section deletes what is in it.
 *
 * It used to orphan them: every task fell back into the day's loose list, so
 * removing the Morning band tipped its chores into the day and the routine
 * looked as though it had been re-added rather than removed. A section is the
 * container for that work — throwing the box away and leaving the contents on
 * the floor is not what anybody meant by "delete".
 *
 * The sweep walks DOWN from every task in the section rather than trusting
 * `section_id` alone. Children normally carry their parent's section, but a row
 * that lost it — an older one, or one mid-move — would otherwise survive its
 * own parent and reappear as a loose task with no context.
 *
 * The reply carries the full rows, not just a count: the client hands them
 * straight back to /tasks/restore and /sections/restore to undo this, and both
 * of those restore by original id, so nothing has to be remapped.
 */
r.delete('/:id', h((req) => {
  const id = Number(req.params.id)
  const section = sections.get(id)
  if (!section) throw notFound('section not found')

  const doomed = db.prepare(`
    WITH RECURSIVE below(id) AS (
      SELECT id FROM tasks WHERE section_id = ?
      UNION
      SELECT t.id FROM tasks t JOIN below b ON t.parent_id = b.id
    )
    SELECT * FROM tasks WHERE id IN (SELECT id FROM below)
  `).all(id)

  db.transaction(() => {
    // Deepest first. parent_id is a real foreign key, and deleting a parent
    // first would cascade rows out from under the loop.
    for (const t of [...doomed].reverse()) {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id)
    }
    sections.remove(id)
  })()

  return { ok: true, section, tasks: doomed }
}))

/** Put a deleted section back exactly as it was, id and all. */
r.post('/restore', h((req) => {
  const row = req.body || {}
  if (!row.id) throw badRequest('a full section row is required')

  const cols = ['id', ...FIELDS.filter((f) => row[f] !== undefined)]
  const values = cols.map((c) => (c === 'id' ? row.id : row[c]))
  db.prepare(
    `INSERT OR REPLACE INTO sections (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).run(...values)

  return sections.get(row.id)
}))

/** Reorder sections within a day. */
r.post('/reorder', h((req) => {
  const { ids = [] } = req.body || {}
  const stmt = db.prepare('UPDATE sections SET sort = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, id)))()
  return { ok: true }
}))

export default r

// --------------------------------------------------------------- routines --

// `weekday` (one day, NULL for every day) is superseded by `weekdays` and is no
// longer writable — see server/migrate-weekdays.js.
//
// `weekdays` has no UI writer any more: the Routines page dropped its day picker,
// so every routine keeps the '' the column defaults to and is offered every day.
// It stays in this list because the column and the filter below are both still
// live, which makes bringing the picker back a change to the page alone.
const R_FIELDS = [
  'name', 'color', 'layout', 'weekdays', 'active', 'auto',
  'hide_from_all_tasks', 'default_intensity', 'project_id', 'sort',
]
// `parent_id` is deliberately absent: re-parenting goes through
// POST /routines/items/:iid/nest, which is the only path that checks for cycles,
// exactly as tasks.js keeps parent_id out of a plain PATCH.
const RI_FIELDS = [
  'routine_id', 'title', 'project_id', 'start_time', 'end_time', 'estimate_min',
  'col_index', 'default_status', 'default_optional', 'default_priority',
  'default_intensity', 'notes', 'notes_hidden', 'shelved', 'sort',
]

const routines = crud('routines', R_FIELDS)
const items = crud('routine_items', RI_FIELDS)

export const routinesRouter = Router()

// Shelved items come back with the rest: they are still part of the routine and
// still editable, they are only skipped when it is applied to a day.
function withItems(routine) {
  return routine && {
    ...routine,
    items: db.prepare(`
      SELECT i.*, p.name AS project_name, p.color AS project_color
      FROM routine_items i LEFT JOIN projects p ON p.id = i.project_id
      WHERE i.routine_id = ? ORDER BY i.sort, i.id
    `).all(routine.id),
  }
}

/**
 * `weekdays` is a comma-separated set of 0=Sunday..6=Saturday, empty for every
 * day. Padding both the column and the needle with commas is what makes the
 * containment test exact: a bare LIKE '%1%' would also match 11, 21 and so on.
 */
export const WEEKDAY_MATCH = "(weekdays = '' OR ',' || weekdays || ',' LIKE '%,' || ? || ',%')"

routinesRouter.get('/', h((req) => {
  const { weekday } = req.query
  if (weekday === undefined) {
    return db.prepare('SELECT * FROM routines ORDER BY sort, id').all().map(withItems)
  }

  const day = Number(weekday)
  if (!Number.isInteger(day) || day < 0 || day > 6) throw badRequest('weekday must be 0-6')

  return db.prepare(`
    SELECT * FROM routines WHERE active = 1 AND ${WEEKDAY_MATCH} ORDER BY sort, id
  `).all(String(day)).map(withItems)
}))

routinesRouter.get('/:id', h((req) => withItems(routines.get(req.params.id))))
routinesRouter.post('/', h((req) => withItems(routines.create({ sort: nextSort('routines'), ...req.body }))))
/**
 * Recolouring a routine repaints the days it has already produced. The link is
 * `sections.routine_id` — the same ownership `apply` uses to decide what to top
 * up — so this reaches every day the routine has ever been added to and nothing
 * else. Without it the Routines page and the Day view disagree indefinitely,
 * since a section's colour is copied at apply time, not read through.
 */
routinesRouter.patch('/:id', h((req) => {
  const before = routines.get(req.params.id)
  if (!before) throw notFound('routine not found')

  const updated = withItems(routines.update(req.params.id, req.body))

  // Only repaint the days that still carry the routine's *previous* value. A
  // section recoloured or renamed by hand on one particular day is a deliberate
  // override — both are editable per-day in the Day view — and blanket-updating
  // every section the routine owns would silently discard it.
  if (req.body?.color !== undefined && req.body.color !== before.color) {
    db.prepare('UPDATE sections SET color = ? WHERE routine_id = ? AND color = ?')
      .run(req.body.color, req.params.id, before.color)
  }
  if (req.body?.name !== undefined && req.body.name !== before.name) {
    db.prepare('UPDATE sections SET name = ? WHERE routine_id = ? AND name = ?')
      .run(req.body.name, req.params.id, before.name)
  }
  /*
   * Reprojecting a routine follows colour and name onto its existing sections
   * but deliberately stops there — it does not touch the tasks those sections
   * already hold, on any day, past or future.
   *
   * A section is presentation: a band on a day whose heading, colour and project
   * describe the routine as it stands now, so leaving it on last month's project
   * would just be a stale label. A task is a record: `apply` copies the item's
   * defaults once and the row is an independent instance from then on — that is
   * why editing an item's title does not rewrite yesterday's task either. Its
   * project is part of what was actually worked on, and rewriting history to
   * match a default changed today would silently restate where past hours went,
   * which is the one thing the project totals must not do.
   *
   * `IS` rather than `=`, because the previous value is very often NULL and
   * `project_id = NULL` matches no row at all — the routine's first project
   * would then reach none of the sections it had already made.
   */
  if (req.body?.project_id !== undefined && req.body.project_id !== before.project_id) {
    db.prepare('UPDATE sections SET project_id = ? WHERE routine_id = ? AND project_id IS ?')
      .run(req.body.project_id, req.params.id, before.project_id)
  }

  return updated
}))
routinesRouter.delete('/:id', h((req) => {
  routines.remove(req.params.id)
  return { ok: true }
}))

routinesRouter.post('/:id/items', h((req) => items.create({
  routine_id: Number(req.params.id),
  sort: nextSort('routine_items', 'WHERE routine_id = ?', [req.params.id]),
  ...req.body,
})))

routinesRouter.patch('/items/:iid', h((req) => {
  if (req.body?.parent_id !== undefined) {
    throw badRequest('use POST /api/routines/items/:iid/nest to change an item\'s parent')
  }
  return items.update(req.params.iid, req.body)
}))

/**
 * Write a new order for one sibling group of items, and optionally re-file them
 * under a parent or into a column — the routine-side twin of POST /tasks/reorder,
 * so a drag on the Routines page and the same drag on a day mean the same thing.
 *
 * `parent_id` and `col_index` are applied only when the caller actually supplies
 * them, so a plain reorder inside a group cannot silently un-nest the rows it
 * touched. Re-parenting through here is safe for the same reason it is in
 * tasks.js: the ids come from one sibling group the client is already showing,
 * and the /nest route below is what handles the arbitrary case.
 */
routinesRouter.post('/items/reorder', h((req) => {
  const body = req.body || {}
  const ids = body.ids || []
  if (!ids.length) return { ok: true, moved: 0 }

  const extra = []
  const extraArgs = []
  for (const field of ['parent_id', 'col_index']) {
    if (body[field] !== undefined) {
      extra.push(`${field} = ?`)
      extraArgs.push(body[field])
    }
  }

  const stmt = db.prepare(
    `UPDATE routine_items SET sort = ?${extra.length ? `, ${extra.join(', ')}` : ''} WHERE id = ?`
  )
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, ...extraArgs, id)))()

  return { ok: true, moved: ids.length }
}))

/**
 * Nest one item under another (or un-nest with parent_id null). An item cannot
 * become its own ancestor, and cannot be nested under an item from a different
 * routine — a cross-routine parent would be applied to a different section on a
 * different day, so the child would point at a task that is not there.
 */
routinesRouter.post('/items/:iid/nest', h((req) => {
  const id = Number(req.params.iid)
  const parentId = req.body?.parent_id ?? null

  const self = items.get(id)
  if (!self) throw notFound('routine item not found')

  if (parentId === null) {
    db.prepare('UPDATE routine_items SET parent_id = NULL WHERE id = ?').run(id)
    return items.get(id)
  }

  if (Number(parentId) === id) throw badRequest('an item cannot be its own parent')
  const parent = items.get(parentId)
  if (!parent) throw badRequest('parent item not found')
  if (parent.routine_id !== self.routine_id) throw badRequest('parent belongs to another routine')

  // Walk up from the proposed parent; meeting `id` would close a cycle.
  let cursor = Number(parentId)
  const seen = new Set()
  while (cursor) {
    if (cursor === id) throw badRequest('that would nest an item inside its own subtree')
    if (seen.has(cursor)) break
    seen.add(cursor)
    cursor = db.prepare('SELECT parent_id FROM routine_items WHERE id = ?').get(cursor)?.parent_id
  }

  db.prepare('UPDATE routine_items SET parent_id = ? WHERE id = ?').run(parentId, id)
  return items.get(id)
}))

/**
 * Deleting an item takes its sub-steps with it. The column is declared
 * ON DELETE CASCADE, but that only fires while `PRAGMA foreign_keys` is on for
 * this connection, and a half-deleted branch would leave orphans that `withItems`
 * would then show at the top level as if they had been promoted. Doing it
 * explicitly makes the outcome the same either way.
 */
routinesRouter.delete('/items/:iid', h((req) => {
  const doomed = db.prepare(`
    WITH RECURSIVE branch(id) AS (
      SELECT id FROM routine_items WHERE id = ?
      UNION ALL
      SELECT i.id FROM routine_items i JOIN branch b ON i.parent_id = b.id
    )
    SELECT id FROM branch
  `).all(req.params.iid).map((row) => row.id)

  const remove = db.prepare('DELETE FROM routine_items WHERE id = ?')
  // Deepest first, so no row is ever deleted while another still references it.
  db.transaction(() => [...doomed].reverse().forEach((id) => remove.run(id)))()

  return { ok: true, deleted: doomed.length }
}))

/**
 * Materialise a routine as a section on a date, with its items as tasks.
 * Re-applying tops up missing items instead of duplicating the section.
 */
routinesRouter.post('/:id/apply', h((req) => {
  const date = req.body?.date
  if (!date) throw badRequest('date required')

  const routine = withItems(routines.get(req.params.id))
  if (!routine) throw notFound('routine not found')

  let added = 0

  db.transaction(() => {
    // Keyed on routine_id, not name, so renaming a routine tops up the section
    // it already created rather than making a second one.
    let section = db.prepare('SELECT * FROM sections WHERE date = ? AND routine_id = ?')
      .get(date, routine.id)
      ?? db.prepare('SELECT * FROM sections WHERE date = ? AND name = ? AND routine_id IS NULL')
        .get(date, routine.name)

    if (!section) {
      const info = db.prepare(`
        INSERT INTO sections (date, name, color, layout, sort, routine_id, project_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(date, routine.name, routine.color, routine.layout,
        nextSort('sections', 'WHERE date = ?', [date]), routine.id, routine.project_id)
      section = { id: info.lastInsertRowid }
    } else if (section.routine_id == null) {
      // Adopt a section created before this link existed.
      db.prepare('UPDATE sections SET routine_id = ? WHERE id = ?').run(routine.id, section.id)
    }

    // What is already here, keyed on the item that produced it. Keying on the
    // *title* — as this used to — has exactly the failure the section lookup
    // above already guards against one level up: titles are editable, so
    // renaming "Walk" to "Morning walk" made top-up stop recognising the row it
    // had written and add a second one, listing one habit twice and counting
    // its minutes twice. Titles are still consulted for rows written before the
    // link existed, which carry no routine_item_id.
    const existing = db
      .prepare('SELECT id, title, routine_item_id FROM tasks WHERE section_id = ?')
      .all(section.id)
    const presentItems = new Set(
      existing.map((t) => t.routine_item_id).filter((v) => v != null)
    )
    const presentTitles = new Set(
      existing.filter((t) => t.routine_item_id == null).map((t) => t.title)
    )

    /*
     * Which task on the day stands for which item, so a sub-step can be hung off
     * its parent's row. Rows an *earlier* apply left behind are in here as well
     * as the ones written below, because topping a routine up has to nest a
     * newly added child under the parent that is already on the day — otherwise
     * a step added to an existing routine arrives orphaned at the top level.
     *
     * The title map is the same bridge presentTitles is: rows written before
     * routine_item_id existed carry no link, so a child of one can still find it.
     */
    const taskForItem = new Map()
    const taskForTitle = new Map()
    for (const row of existing) {
      if (row.routine_item_id != null) taskForItem.set(row.routine_item_id, row.id)
      else taskForTitle.set(row.title, row.id)
    }

    const byId = new Map(routine.items.map((i) => [i.id, i]))

    // Shelving a parent shelves the branch. A sub-step whose parent is never
    // applied has nothing to hang off, and half of a nested chore is not the
    // chore — it would arrive as a loose orphan reading "Chop onions".
    const shelved = (item) => {
      const seen = new Set()
      for (let cursor = item; cursor; cursor = byId.get(cursor.parent_id)) {
        if (cursor.shelved) return true
        if (seen.has(cursor.id)) return true    // a cycle can never be applied
        seen.add(cursor.id)
      }
      return false
    }

    // Parents before children, depth first, so a child always finds its parent's
    // task id already in the map — and so the day reads in the same order the
    // routine does.
    const ordered = []
    const placed = new Set()
    const emit = (parentId) => {
      for (const item of routine.items) {
        if ((item.parent_id ?? null) !== parentId) continue
        ordered.push(item)
        placed.add(item.id)
        emit(item.id)
      }
    }
    emit(null)
    // An item whose parent is not in this routine at all is unreachable from the
    // walk above. It is applied at the top level rather than silently dropped.
    for (const item of routine.items) if (!placed.has(item.id)) ordered.push(item)

    const insert = db.prepare(`
      INSERT INTO tasks (title, notes, notes_hidden, project_id, scheduled_date,
                         section_id, start_time, end_time, estimate_min, col_index,
                         sort, status, priority, optional, intensity, parent_id,
                         from_template, routine_item_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `)
    let base = nextSort('tasks', 'WHERE scheduled_date = ?', [date])

    for (const item of ordered) {
      if (shelved(item)) continue

      // Resolved before the skip below, so an item already on the day still
      // acts as a parent for a child that is not.
      const parentItem = item.parent_id != null ? byId.get(item.parent_id) : null
      const parentTask = item.parent_id == null ? null : (
        taskForItem.get(item.parent_id)
        ?? (parentItem ? taskForTitle.get(parentItem.title) : undefined)
        ?? null
      )

      if (presentItems.has(item.id) || presentTitles.has(item.title)) continue

      // 'maybe' is a retired status that tasks.status would now reject, and it
      // meant "might do" — the flag that replaced it. Kept as a bridge for any
      // row written before default_optional existed.
      const maybe = item.default_status === 'maybe'

      // The item's own default, not the table's: a chore that is usually skipped
      // is applied already dropped rather than asking to be dismissed daily.
      //
      // Project and intensity are inherited from the routine, so the common case
      // — every line of a routine belongs to the same project and costs the same
      // kind of attention — is set once on the routine instead of once per item.
      // An item that names its own is a deliberate choice and keeps it: the
      // routine supplies a default, it does not overwrite one. `??` and not `||`
      // for intensity, because NULL is what "ask the routine" looks like and an
      // item pinned to 'light' under a deep routine has to stay light.
      const info = insert.run(item.title, item.notes || '', item.notes_hidden ? 1 : 0,
        item.project_id ?? routine.project_id,
        date, section.id, item.start_time, item.end_time,
        item.estimate_min, item.col_index, base++,
        maybe ? 'todo' : (item.default_status || 'todo'),
        item.default_priority || 'medium',
        (maybe || item.default_optional) ? 1 : 0,
        item.default_intensity ?? routine.default_intensity ?? 'light',
        parentTask,
        item.id)
      taskForItem.set(item.id, info.lastInsertRowid)
      added++
    }
  })()

  return { added }
}))
