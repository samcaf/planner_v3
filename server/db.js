import Database from 'better-sqlite3'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

export const DB_PATH = process.env.PLANNER_DB || join(root, 'data', 'planner.db')

mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))

/**
 * Additive migrations for databases created before a column existed.
 * `CREATE TABLE IF NOT EXISTS` in schema.sql never alters an existing table, so
 * new columns have to be added here to avoid wiping anyone's data.
 */
function addColumn(table, name, decl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name)
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`)
}

addColumn('tasks', 'parent_id', 'INTEGER REFERENCES tasks(id) ON DELETE CASCADE')
addColumn('tasks', 'start_time', 'TEXT')
addColumn('tasks', 'end_time', 'TEXT')
addColumn('tasks', 'col_index', 'INTEGER')
// Provenance, so a re-import can replace exactly what it created and nothing else.
addColumn('tasks', 'source', "TEXT NOT NULL DEFAULT 'app'")
addColumn('tasks', 'section_id', 'INTEGER REFERENCES sections(id) ON DELETE SET NULL')
// A 'note' row is a loose block of prose sitting in the same ordered list as the
// tasks — it reuses their ordering, nesting and drag machinery.
addColumn('tasks', 'kind', "TEXT NOT NULL DEFAULT 'task'")

// A routine repeats on a SET of weekdays: '' means every day, otherwise a
// comma-separated list of 0(Sunday)..6.
addColumn('routines', 'weekdays', "TEXT NOT NULL DEFAULT ''")
addColumn('routine_items', 'default_status', "TEXT NOT NULL DEFAULT 'todo'")

/*
 * Cognitive intensity, orthogonal to duration. Clock time is not the scarce
 * resource — hard thinking is. A shower costs 20 minutes and none of it, so
 * chores must never draw down the thinking budget.
 *
 * Almost nothing should be tagged by hand: a task inherits from its project or
 * its routine, and routines default to light.
 */
addColumn('tasks', 'intensity', "TEXT NOT NULL DEFAULT 'light'")

// These arrived with the meetings rebuild rather than through schema.sql, so a
// database created from scratch needs them added here too.
addColumn('tasks', 'optional', 'INTEGER NOT NULL DEFAULT 0')
addColumn('tasks', 'url', "TEXT NOT NULL DEFAULT ''")
addColumn('tasks', 'location', "TEXT NOT NULL DEFAULT ''")
// Which routine item produced this task. Top-up needs a stable identity for
// "already added"; it used to compare titles, which broke the moment an item
// was renamed and quietly duplicated the chore on every day.
addColumn('tasks', 'routine_item_id', 'INTEGER')
addColumn('routines', 'auto', 'INTEGER NOT NULL DEFAULT 0')
addColumn('routine_items', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL')
addColumn('routine_items', 'start_time', 'TEXT')
addColumn('routine_items', 'shelved', 'INTEGER NOT NULL DEFAULT 0')
addColumn('routine_items', 'default_optional', 'INTEGER NOT NULL DEFAULT 0')
addColumn('projects', 'default_intensity', "TEXT NOT NULL DEFAULT 'light'")
addColumn('routines', 'default_intensity', "TEXT NOT NULL DEFAULT 'light'")
// The routine's own project: the default for every task it creates and for the
// section it becomes on a day. `routine_items.project_id` above still wins where
// it is set, so an evening routine can be filed under one project with a single
// line of it belonging to another.
addColumn('routines', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL')

db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)')

// Identifies which routine produced a section. Matching on name alone breaks the
// moment a routine is renamed, which would silently duplicate it on every day.
addColumn('sections', 'routine_id', 'INTEGER REFERENCES routines(id) ON DELETE SET NULL')
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_routine_day
    ON sections(date, routine_id) WHERE routine_id IS NOT NULL
`)

export const DEFAULTS = {
  column_labels: JSON.stringify(['Quick', 'Focused', 'Deep']),
  day_layout: 'list',
  // ~5.5h of planned work in a working day, meetings included.
  daily_capacity_min: '330',
  // The thinking budget. Deliberate-practice research puts the ceiling around
  // four hours even for experts; it is a starting point, not a law.
  deep_capacity_min: '240',
}

for (const [key, value] of Object.entries(DEFAULTS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

/** Today in the machine's local timezone, as YYYY-MM-DD. */
export function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Ensure a `days` row exists so day notes can be written without a separate create step. */
export function ensureDay(date) {
  db.prepare('INSERT OR IGNORE INTO days (date) VALUES (?)').run(date)
  return db.prepare('SELECT * FROM days WHERE date = ?').get(date)
}
