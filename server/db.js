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
addColumn('tasks', 'subsection', 'INTEGER NOT NULL DEFAULT 0')
// A stand-in for a real parent, created only so a backlogged child keeps the
// path that identifies it. It is scaffolding, not work: it is never counted,
// and it is torn down again the moment nothing hangs off it.
addColumn('tasks', 'scaffold', 'INTEGER NOT NULL DEFAULT 0')

// Some work takes exactly as long as it takes — a timed exercise, a brew, a
// meditation — so its minutes are a fact rather than a guess. Marking that is
// what turns the estimate into something a timer can run against.
addColumn('tasks', 'fixed_time', 'INTEGER NOT NULL DEFAULT 0')
// The timer lives in the database, not in the page: a count-down that forgets
// itself on refresh is not a count-down. `started_at` is null while paused, and
// `elapsed_ms` carries everything banked before the current run.
addColumn('tasks', 'timer_started_at', 'TEXT')
addColumn('tasks', 'timer_elapsed_ms', 'INTEGER NOT NULL DEFAULT 0')
// Filed away rather than deleted. A project's note section stops being current
// long before it stops being worth keeping, and deleting it — which takes its
// prose with it — was the only other way to get it out of the way.
addColumn('tasks', 'archived', 'INTEGER NOT NULL DEFAULT 0')
// Which group a meeting was booked with. Its members are attendees like anyone
// else, but "this is the lab meeting" is a fact about the meeting that survives
// people joining and leaving, and it is what you want to click through to.
//
// This column first shipped referencing `people_groups`, a table that does not
// exist — the table is `groups`. SQLite accepts an unknown target at ALTER
// time and only complains when a row is written, so the column looked fine and
// every attempt to save a meeting failed with `no such table:
// main.people_groups`. Dropping and re-adding it loses nothing: no write to it
// could ever have succeeded, so on any database that has the broken version the
// column is necessarily empty.
//
// No foreign key on the replacement, matching routine_item_id above. A deleted
// group leaves a dangling id, and every read is a LEFT JOIN, so the meeting
// simply stops naming a group rather than the delete being refused.
const tasksSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'tasks'").get()?.sql || ''
if (/group_id[^,)]*people_groups/.test(tasksSql)) {
  db.exec('ALTER TABLE tasks DROP COLUMN group_id')
}
addColumn('tasks', 'group_id', 'INTEGER')
addColumn('tasks', 'url', "TEXT NOT NULL DEFAULT ''")
addColumn('tasks', 'location', "TEXT NOT NULL DEFAULT ''")
// Which routine item produced this task. Top-up needs a stable identity for
// "already added"; it used to compare titles, which broke the moment an item
// was renamed and quietly duplicated the chore on every day.
addColumn('tasks', 'routine_item_id', 'INTEGER')
addColumn('routines', 'auto', 'INTEGER NOT NULL DEFAULT 0')

// A task that is work in a repository, and the repository a project's work
// happens in. Together they are what lets a coding agent be told "these are
// today's code tasks, and here is where each one lives" — a title on its own
// is not enough to act on.
addColumn('tasks', 'is_code', 'INTEGER NOT NULL DEFAULT 0')
addColumn('projects', 'repo_path', "TEXT NOT NULL DEFAULT ''")
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

/*
 * A routine item is edited with the same row component a day's section uses, so
 * it has to be able to hold everything that row can set. These are the columns
 * that gap was made of: without them the controls would be on screen and inert.
 *
 * They are all *defaults* — what the task gets when the routine is applied —
 * which is why the ones whose task-side name is already taken by a different
 * meaning wear the `default_` prefix, as `default_status` and `default_optional`
 * already do.
 *
 * `default_intensity` is the exception that is nullable: NULL means "whatever
 * the routine says", the same way an item's empty project_id defers to the
 * routine's. The routine's own column is NOT NULL, so there is always an answer.
 *
 * These are declared in schema.sql too. Both, always: schema.sql builds a fresh
 * install and never touches an existing table, so a column added in only one
 * place makes a new database and the live one disagree from the first row.
 */
addColumn('routine_items', 'parent_id', 'INTEGER REFERENCES routine_items(id) ON DELETE CASCADE')
addColumn('routine_items', 'notes', "TEXT NOT NULL DEFAULT ''")
addColumn('routine_items', 'notes_hidden', 'INTEGER NOT NULL DEFAULT 0')
addColumn('routine_items', 'default_priority', "TEXT NOT NULL DEFAULT 'medium'")
addColumn('routine_items', 'default_intensity', 'TEXT')
addColumn('routine_items', 'end_time', 'TEXT')

db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)')
db.exec('CREATE INDEX IF NOT EXISTS idx_routine_items_parent ON routine_items(parent_id)')

// Identifies which routine produced a section. Matching on name alone breaks the
// moment a routine is renamed, which would silently duplicate it on every day.
addColumn('sections', 'routine_id', 'INTEGER REFERENCES routines(id) ON DELETE SET NULL')
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_routine_day
    ON sections(date, routine_id) WHERE routine_id IS NOT NULL
`)

// Notes that are not about a day or a project — references, standing lists, the
// things a planner has nowhere else to put. Its own table rather than a task
// with no date, which would surface in the backlog and be counted as work.
db.exec(`
  CREATE TABLE IF NOT EXISTS notebook (
    id         INTEGER PRIMARY KEY,
    title      TEXT    NOT NULL DEFAULT '',
    body       TEXT    NOT NULL DEFAULT '',
    sort       INTEGER NOT NULL DEFAULT 0,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`)

// Archiving rather than deleting. A reference note stops being current long
// before it stops being worth keeping, and deletion is the only other way to
// get it out of the list.
addColumn('notebook', 'archived', 'INTEGER NOT NULL DEFAULT 0')

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
