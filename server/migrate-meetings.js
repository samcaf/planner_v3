/**
 * Four structural changes, all cheap because the affected tables are empty:
 *
 *  1. `optional` becomes a flag, not a status. "Might do" is a property of a
 *     task, not a position in its lifecycle — so an optional task can be done
 *     and still be optional. (Jira's Flagged field makes the same split.)
 *  2. Meetings become tasks (`kind = 'meeting'`) rather than a parallel table,
 *     so they carry intensity, notes and time like everything else and land in
 *     the same totals.
 *  3. `orgs` becomes `groups`, and both people and groups gain a meeting link.
 *  4. Routine items can be shelved: kept on the routine, skipped when applied.
 *
 *   node server/migrate-meetings.js --dry-run
 *   node server/migrate-meetings.js
 */
import { db } from './db.js'

const dryRun = process.argv.includes('--dry-run')
const report = []

const has = (table, col) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)

const tableExists = (name) =>
  !!db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', name)

const run = db.transaction(() => {
  // --- 1 + 2: rebuild tasks for the new kind and the optional flag ---------
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'tasks'").get()?.sql || ''

  if (sql.includes("'meeting'")) {
    report.push('  tasks: already rebuilt, skipped')
  } else {
    db.exec(`
      CREATE TABLE tasks_new (
        id             INTEGER PRIMARY KEY,
        title          TEXT    NOT NULL,
        notes          TEXT    NOT NULL DEFAULT '',
        project_id     INTEGER REFERENCES projects(id)   ON DELETE SET NULL,
        milestone_id   INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
        status         TEXT    NOT NULL DEFAULT 'todo'
                         CHECK (status IN ('todo','doing','done','moved','dropped')),
        priority       TEXT    NOT NULL DEFAULT 'medium'
                         CHECK (priority IN ('lowest','low','medium','high','highest')),
        -- Orthogonal to status, so finishing an optional task keeps it optional.
        optional       INTEGER NOT NULL DEFAULT 0,
        intensity      TEXT    NOT NULL DEFAULT 'light'
                         CHECK (intensity IN ('deep','light')),
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
                         CHECK (kind IN ('task','note','meeting')),
        moved_to_date  TEXT,
        notes_hidden   INTEGER NOT NULL DEFAULT 0,
        url            TEXT    NOT NULL DEFAULT '',
        location       TEXT    NOT NULL DEFAULT ''
      )
    `)

    // 'maybe' collapses into todo + optional.
    db.exec(`
      INSERT INTO tasks_new (
        id, title, notes, project_id, milestone_id, status, priority, optional, intensity,
        scheduled_date, due_date, estimate_min, sort, from_template, created_at,
        completed_at, parent_id, start_time, end_time, col_index, source,
        section_id, kind, moved_to_date, notes_hidden
      )
      SELECT
        id, title, notes, project_id, milestone_id,
        CASE status WHEN 'maybe' THEN 'todo' ELSE status END,
        priority,
        CASE status WHEN 'maybe' THEN 1 ELSE 0 END,
        intensity,
        scheduled_date, due_date, estimate_min, sort, from_template, created_at,
        completed_at, parent_id, start_time, end_time, col_index, source,
        section_id, kind, moved_to_date, notes_hidden
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
    report.push("  tasks: rebuilt — kind gains 'meeting', optional is now a flag, url/location added")
  }

  // --- 2b: attendees hang off tasks now -----------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_people (
      task_id   INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, person_id)
    )
  `)

  const events = tableExists('events')
    ? db.prepare('SELECT COUNT(*) n FROM events').get().n
    : 0
  if (events > 0) throw new Error(`refusing to drop ${events} events — migrate them first`)
  db.exec('DROP TABLE IF EXISTS event_people')
  db.exec('DROP TABLE IF EXISTS events')
  report.push('  events: folded into tasks; task_people replaces event_people')

  // --- 3: orgs become groups ----------------------------------------------
  if (tableExists('orgs') && !tableExists('groups')) {
    const orgs = db.prepare('SELECT COUNT(*) n FROM orgs').get().n
    db.exec('ALTER TABLE orgs RENAME TO groups')
    report.push(`  orgs -> groups (${orgs} row${orgs === 1 ? '' : 's'} carried over)`)
  } else {
    report.push('  groups: already present')
  }

  // Renaming the table leaves the referencing column behind.
  if (has('people', 'org_id') && !has('people', 'group_id')) {
    db.exec('ALTER TABLE people RENAME COLUMN org_id TO group_id')
    report.push('  people.org_id -> people.group_id')
  }

  for (const [table, col] of [['groups', 'meeting_url'], ['people', 'meeting_url']]) {
    if (!has(table, col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`)
      report.push(`  ${table}.${col}: added`)
    }
  }

  // --- 4: shelved routine items -------------------------------------------
  if (!has('routine_items', 'shelved')) {
    db.exec("ALTER TABLE routine_items ADD COLUMN shelved INTEGER NOT NULL DEFAULT 0")
    report.push('  routine_items.shelved: added')
  }

  if (dryRun) throw new Error('__rollback__')
})

try {
  run()
} catch (err) {
  if (err.message !== '__rollback__') throw err
}

console.log(`\nmeetings + optional flag${dryRun ? ' — DRY RUN, nothing written' : ''}\n`)
report.forEach((l) => console.log(l))

// A dry run rolls the schema back, so the new columns are gone by the time we
// report — each count has to tolerate not existing yet.
const count = (sql) => {
  try { return db.prepare(sql).get().n } catch { return 'n/a' }
}

console.log(`\n  tasks        ${count('SELECT COUNT(*) n FROM tasks')}`)
console.log(`  optional     ${count('SELECT COUNT(*) n FROM tasks WHERE optional = 1')}`)
console.log(`  meetings     ${count("SELECT COUNT(*) n FROM tasks WHERE kind = 'meeting'")}`)
console.log(`  groups       ${count('SELECT COUNT(*) n FROM groups')}\n`)
