import { Router } from 'express'
import { db } from '../db.js'
import { badRequest, crud, h, nextSort, notFound } from './_helpers.js'

const FIELDS = ['date', 'name', 'project_id', 'layout', 'color', 'collapsed', 'sort']
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
    ...body,
  })
}))

r.patch('/:id', h((req) => sections.update(req.params.id, req.body)))

/**
 * Deleting a section keeps its tasks — they fall back to the day's loose list
 * rather than vanishing with the container.
 */
r.delete('/:id', h((req) => {
  db.prepare('UPDATE tasks SET section_id = NULL WHERE section_id = ?').run(req.params.id)
  sections.remove(req.params.id)
  return { ok: true }
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
const RI_FIELDS = [
  'routine_id', 'title', 'project_id', 'start_time', 'estimate_min',
  'col_index', 'default_status', 'default_optional', 'shelved', 'sort',
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

routinesRouter.patch('/items/:iid', h((req) => items.update(req.params.iid, req.body)))
routinesRouter.delete('/items/:iid', h((req) => {
  items.remove(req.params.iid)
  return { ok: true }
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
      .prepare('SELECT title, routine_item_id FROM tasks WHERE section_id = ?')
      .all(section.id)
    const presentItems = new Set(
      existing.map((t) => t.routine_item_id).filter((v) => v != null)
    )
    const presentTitles = new Set(
      existing.filter((t) => t.routine_item_id == null).map((t) => t.title)
    )

    const insert = db.prepare(`
      INSERT INTO tasks (title, project_id, scheduled_date, section_id, start_time,
                         estimate_min, col_index, sort, status, optional, intensity,
                         from_template, routine_item_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `)
    let base = nextSort('tasks', 'WHERE scheduled_date = ?', [date])

    for (const item of routine.items) {
      if (item.shelved) continue
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
      // An item that names its own project still keeps it: the routine supplies
      // a default, it does not overwrite a deliberate choice. There is no
      // per-item intensity column, so the routine's is the only source for it.
      insert.run(item.title, item.project_id ?? routine.project_id,
        date, section.id, item.start_time,
        item.estimate_min, item.col_index, base++,
        maybe ? 'todo' : (item.default_status || 'todo'),
        (maybe || item.default_optional) ? 1 : 0,
        routine.default_intensity || 'light',
        item.id)
      added++
    }
  })()

  return { added }
}))
