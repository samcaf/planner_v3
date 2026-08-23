/**
 * Folds `templates` into `routines`, retiring the templates concept.
 *
 * Both tables modelled the same thing — a named, reusable group of tasks — so
 * every field had to be added twice and the Day view offered two lists doing
 * the same job. A migrated template becomes a routine with `auto = 0`: still
 * offered on its weekday, never applied without being asked.
 *
 *   node server/migrate-templates.js --dry-run
 *   node server/migrate-templates.js
 *
 * Afterwards the `templates` and `template_items` definitions have to come out
 * of schema.sql, or db.js recreates them empty on the next boot.
 */
import { db } from './db.js'

const dryRun = process.argv.includes('--dry-run')

const report = []

const tableExists = (name) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)

const count = (table) =>
  (tableExists(table) ? db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n : null)

const snapshot = () => ({
  routines: count('routines'),
  routine_items: count('routine_items'),
  templates: count('templates'),
  template_items: count('template_items'),
})

function addColumn(table, name, decl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name)
  if (has) {
    report.push(`  ${table}.${name}: already present`)
    return
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`)
  report.push(`  ${table}.${name}: added`)
}

const before = snapshot()
let after = before

const run = db.transaction(() => {
  addColumn('routine_items', 'project_id', 'INTEGER REFERENCES projects(id) ON DELETE SET NULL')
  addColumn('routine_items', 'start_time', 'TEXT')
  // auto = 0 reproduces the template behaviour: offered, never applied unasked.
  addColumn('routines', 'auto', 'INTEGER NOT NULL DEFAULT 1')

  if (!tableExists('templates')) {
    report.push('  templates: already gone, nothing to copy')
  } else {
    // A name already carried by an offered-only routine came from an earlier
    // run of this script, so a re-run against a restored backup cannot double.
    const migrated = new Set(
      db.prepare('SELECT name FROM routines WHERE auto = 0').all().map((r) => r.name)
    )

    const addRoutine = db.prepare(
      'INSERT INTO routines (name, weekday, active, sort, auto) VALUES (?, ?, ?, ?, 0)'
    )
    const addItem = db.prepare(`
      INSERT INTO routine_items (routine_id, title, project_id, start_time, estimate_min, sort)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const itemsOf = db.prepare(
      'SELECT * FROM template_items WHERE template_id = ? ORDER BY sort, id'
    )

    let copied = 0
    let copiedItems = 0

    for (const t of db.prepare('SELECT * FROM templates ORDER BY sort, id').all()) {
      if (migrated.has(t.name)) {
        report.push(`  ${t.name}: an offered routine of that name exists, skipped`)
        continue
      }

      const routineId = addRoutine.run(t.name, t.weekday, t.active, t.sort).lastInsertRowid
      const items = itemsOf.all(t.id)
      for (const i of items) {
        addItem.run(routineId, i.title, i.project_id, i.start_time, i.estimate_min, i.sort)
      }

      copied++
      copiedItems += items.length
      report.push(`  ${t.name}: copied as a routine with ${items.length} items`)
    }

    report.push(`  copied ${copied} templates and ${copiedItems} items into routines`)

    // Children first: the foreign key would fail the implicit delete that
    // DROP TABLE performs on the parent.
    db.exec('DROP TABLE template_items')
    db.exec('DROP TABLE templates')
    report.push('  templates, template_items: dropped')
  }

  after = snapshot()
  if (dryRun) throw new Error('__rollback__')
})

try {
  run()
} catch (err) {
  if (err.message !== '__rollback__') throw err
}

console.log(`\ntemplates -> routines${dryRun ? ' — DRY RUN, nothing written' : ''}\n`)
report.forEach((l) => console.log(l))

const n = (v) => (v === null ? 'gone' : String(v))
console.log('\n  table             before    after')
for (const key of ['routines', 'routine_items', 'templates', 'template_items']) {
  console.log(`  ${key.padEnd(16)}${n(before[key]).padStart(8)}${n(after[key]).padStart(9)}`)
}

console.log('\n  still to do by hand: drop the templates/template_items tables from'
  + '\n  schema.sql, the templates block from days.js, and the templates router'
  + '\n  from index.js — otherwise they come back empty on the next boot.\n')
