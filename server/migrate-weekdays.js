/**
 * Routines repeat on a set of weekdays, and routine items carry a default status.
 *
 * `routines.weekday` held a single day, so "Monday and Thursday" meant two
 * copies of the same routine. `weekdays` replaces it with a comma-separated list
 * of 0=Sunday..6=Saturday, in which the empty string keeps the meaning NULL used
 * to carry: every day. `routine_items.default_status` lets an item be created in
 * a state other than todo — morning pages that are usually skipped can arrive
 * already dropped instead of nagging from the top of every day.
 *
 *   node server/migrate-weekdays.js --dry-run
 *   node server/migrate-weekdays.js
 *
 * The old `weekday` column stays. Other readers still select it, and dropping a
 * column rewrites the whole table for no gain; nothing writes it after this.
 *
 * Afterwards both columns have to be added to db.js by hand, or a database
 * created from scratch will not have them and the routines routes will fail.
 */
import { db } from './db.js'

const dryRun = process.argv.includes('--dry-run')

const report = []

const hasColumn = (table, name) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name)

const count = (sql) => db.prepare(sql).get().n

/**
 * Add a column, and say whether this run is the one that added it. The backfill
 * below keys off that: on a second run the column already holds the user's own
 * choices, and re-deriving it from `weekday` would drag a routine they have
 * since set back to "every day" onto its old single weekday.
 */
function addColumn(table, name, decl) {
  if (hasColumn(table, name)) {
    report.push(`  ${table}.${name}: already present`)
    return false
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`)
  report.push(`  ${table}.${name}: added`)
  return true
}

const snapshot = () => ({
  routines: count('SELECT COUNT(*) n FROM routines'),
  everyDay: hasColumn('routines', 'weekdays')
    ? count("SELECT COUNT(*) n FROM routines WHERE weekdays = ''")
    : null,
  someDays: hasColumn('routines', 'weekdays')
    ? count("SELECT COUNT(*) n FROM routines WHERE weekdays <> ''")
    : null,
  items: count('SELECT COUNT(*) n FROM routine_items'),
  itemsTodo: hasColumn('routine_items', 'default_status')
    ? count("SELECT COUNT(*) n FROM routine_items WHERE default_status = 'todo'")
    : null,
  itemsOther: hasColumn('routine_items', 'default_status')
    ? count("SELECT COUNT(*) n FROM routine_items WHERE default_status <> 'todo'")
    : null,
})

const before = snapshot()
let after = before

const run = db.transaction(() => {
  const fresh = addColumn('routines', 'weekdays', "TEXT NOT NULL DEFAULT ''")
  addColumn(
    'routine_items',
    'default_status',
    "TEXT NOT NULL DEFAULT 'todo'"
      + " CHECK (default_status IN ('todo','doing','done','maybe','moved','dropped'))"
  )

  if (!fresh) {
    report.push('  weekdays: backfill skipped, the column already holds its own values')
  } else {
    const set = db.prepare('UPDATE routines SET weekdays = ? WHERE id = ?')
    for (const r of db.prepare('SELECT id, name, weekday FROM routines ORDER BY sort, id').all()) {
      const weekdays = r.weekday == null ? '' : String(r.weekday)
      set.run(weekdays, r.id)
      report.push(`  ${r.name}: weekday ${r.weekday ?? 'NULL'} -> `
        + `weekdays ${weekdays === '' ? "'' (every day)" : `'${weekdays}'`}`)
    }
  }

  after = snapshot()
  if (dryRun) throw new Error('__rollback__')
})

try {
  run()
} catch (err) {
  if (err.message !== '__rollback__') throw err
}

console.log(`\nrepeating weekdays + item default status${dryRun ? ' — DRY RUN, nothing written' : ''}\n`)
report.forEach((l) => console.log(l))

const ROWS = [
  ['routines', 'routines'],
  ["  every day (weekdays '')", 'everyDay'],
  ['  on chosen weekdays', 'someDays'],
  ['routine_items', 'items'],
  ['  default_status todo', 'itemsTodo'],
  ['  default_status other', 'itemsOther'],
]

const n = (v) => (v === null ? 'absent' : String(v))
console.log('\n                              before     after')
for (const [label, key] of ROWS) {
  console.log(`  ${label.padEnd(26)}${n(before[key]).padStart(8)}${n(after[key]).padStart(10)}`)
}

console.log('\n  still to do by hand:'
  + "\n    db.js      addColumn('routines', 'weekdays', \"TEXT NOT NULL DEFAULT ''\")"
  + "\n               addColumn('routine_items', 'default_status', \"TEXT NOT NULL DEFAULT 'todo'\")"
  + '\n    days.js    swap the routines filter to weekdays:'
  + "\n               WHERE active = 1 AND (weekdays = ''"
  + "\n                 OR ',' || weekdays || ',' LIKE '%,' || ? || ',%')\n")
