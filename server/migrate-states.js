/**
 * Widens task states and priorities, adds project types, and reclassifies
 * saved reference links as notes.
 *
 * SQLite cannot ALTER a CHECK constraint, so `tasks` is rebuilt. Everything
 * runs in one transaction: it either all lands or none of it does.
 *
 *   node server/migrate-states.js --dry-run
 *   node server/migrate-states.js
 */
import { db } from './db.js'

const dryRun = process.argv.includes('--dry-run')

// normal was the old middle; Jira's five-point scale calls that medium.
const PRIORITY = { low: 'low', normal: 'medium', high: 'high' }

const report = []

function alreadyMigrated() {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'tasks'").get()?.sql || ''
  return sql.includes("'maybe'") && sql.includes("'highest'")
}

const run = db.transaction(() => {
  // --- project types ------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_types (
      id    INTEGER PRIMARY KEY,
      name  TEXT    NOT NULL UNIQUE,
      color TEXT    NOT NULL DEFAULT 'gray',
      sort  INTEGER NOT NULL DEFAULT 0
    )
  `)

  const typeCount = db.prepare('SELECT COUNT(*) n FROM project_types').get().n
  if (typeCount === 0) {
    const add = db.prepare('INSERT INTO project_types (name, color, sort) VALUES (?,?,?)')
    ;[['Work', 'blue'], ['Research', 'purple'], ['Personal', 'green'], ['Admin', 'gray']]
      .forEach(([name, color], i) => add.run(name, color, i))
    report.push(`  project_types: seeded 4 starter types`)
  } else {
    report.push(`  project_types: ${typeCount} already present, left alone`)
  }

  const hasTypeId = db.prepare('PRAGMA table_info(projects)').all().some((c) => c.name === 'type_id')
  if (!hasTypeId) {
    db.exec('ALTER TABLE projects ADD COLUMN type_id INTEGER REFERENCES project_types(id) ON DELETE SET NULL')
    report.push('  projects.type_id: added')
  }

  const hasHide = db.prepare('PRAGMA table_info(routines)').all().some((c) => c.name === 'hide_from_all_tasks')
  if (!hasHide) {
    db.exec('ALTER TABLE routines ADD COLUMN hide_from_all_tasks INTEGER NOT NULL DEFAULT 0')
    // Routine chores are noise in a cross-cutting task list.
    db.prepare("UPDATE routines SET hide_from_all_tasks = 1 WHERE lower(name) IN ('morning','evening')").run()
    report.push('  routines.hide_from_all_tasks: added, on for Morning and Evening')
  }

  // --- rebuild tasks ------------------------------------------------------
  if (alreadyMigrated()) {
    report.push('  tasks: CHECK constraints already widened, skipped')
  } else {
    db.exec(`
      CREATE TABLE tasks_new (
        id             INTEGER PRIMARY KEY,
        title          TEXT    NOT NULL,
        notes          TEXT    NOT NULL DEFAULT '',
        project_id     INTEGER REFERENCES projects(id)   ON DELETE SET NULL,
        milestone_id   INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
        status         TEXT    NOT NULL DEFAULT 'todo'
                         CHECK (status IN ('todo','doing','done','maybe','moved','dropped')),
        priority       TEXT    NOT NULL DEFAULT 'medium'
                         CHECK (priority IN ('lowest','low','medium','high','highest')),
        scheduled_date TEXT,
        due_date       TEXT,
        estimate_min   INTEGER,
        sort           INTEGER NOT NULL DEFAULT 0,
        from_template  INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        completed_at   TEXT,
        parent_id      INTEGER REFERENCES tasks_new(id) ON DELETE CASCADE,
        start_time     TEXT,
        end_time       TEXT,
        col_index      INTEGER,
        source         TEXT    NOT NULL DEFAULT 'app',
        section_id     INTEGER REFERENCES sections(id) ON DELETE SET NULL,
        kind           TEXT    NOT NULL DEFAULT 'task'
                         CHECK (kind IN ('task','note')),
        moved_to_date  TEXT,
        notes_hidden   INTEGER NOT NULL DEFAULT 0
      )
    `)

    db.exec(`
      INSERT INTO tasks_new (
        id, title, notes, project_id, milestone_id, status, priority, scheduled_date,
        due_date, estimate_min, sort, from_template, created_at, completed_at,
        parent_id, start_time, end_time, col_index, source, section_id, kind
      )
      SELECT
        id, title, notes, project_id, milestone_id, status,
        CASE priority WHEN 'normal' THEN 'medium' ELSE priority END,
        scheduled_date, due_date, estimate_min, sort, from_template, created_at,
        completed_at, parent_id, start_time, end_time, col_index, source, section_id, kind
      FROM tasks
    `)

    db.exec('DROP TABLE tasks')
    db.exec('ALTER TABLE tasks_new RENAME TO tasks')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_date    ON tasks(scheduled_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_due     ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent  ON tasks(parent_id);
    `)
    report.push(`  tasks: rebuilt with 6 states and 5 priorities`)
    report.push(`  priority: ${Object.entries(PRIORITY).map(([a, b]) => `${a}->${b}`).join(', ')}`)
  }

  // --- research links become notes ---------------------------------------
  // A title that is nothing but a markdown link is a saved reference, not a
  // to-do; it was only a task because the source format had one row type.
  const linkOnly = db.prepare("SELECT id, title FROM tasks WHERE kind = 'task'").all()
    .filter((t) => /^\s*\[[^\]]+\]\([^)]+\)\s*$/.test(t.title))

  const toNote = db.prepare(`
    UPDATE tasks SET kind = 'note', notes = CASE WHEN notes = '' THEN title ELSE notes END
    WHERE id = ?
  `)
  linkOnly.forEach((t) => toNote.run(t.id))
  report.push(`  reclassified ${linkOnly.length} reference links as notes`)

  if (dryRun) throw new Error('__rollback__')
})

try {
  run()
} catch (err) {
  if (err.message !== '__rollback__') throw err
}

console.log(`\nstate migration${dryRun ? ' — DRY RUN, nothing written' : ''}\n`)
report.forEach((l) => console.log(l))

const counts = (sql) => JSON.stringify(db.prepare(sql).all())
console.log(`\n  status    ${counts('SELECT status, COUNT(*) n FROM tasks GROUP BY status')}`)
console.log(`  priority  ${counts('SELECT priority, COUNT(*) n FROM tasks GROUP BY priority')}`)
console.log(`  kind      ${counts('SELECT kind, COUNT(*) n FROM tasks GROUP BY kind')}`)
console.log(`  total     ${db.prepare('SELECT COUNT(*) n FROM tasks').get().n}\n`)
