/**
 * Converts named projects into daily routines.
 *
 * A morning or evening routine is not a project — it has no goal and never
 * completes — but the importer had nowhere else to put it. This moves each one
 * to a `routine` (the reusable definition) plus one `section` per day it
 * actually appeared on, then drops the project.
 *
 *   node server/migrate-routines.js --dry-run
 *   node server/migrate-routines.js Morning Evening
 */
import { db } from './db.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const names = args.filter((a) => !a.startsWith('-'))
const targets = names.length ? names : ['Morning', 'Evening']

const findProject = db.prepare('SELECT * FROM projects WHERE lower(name) = lower(?)')

let report = []

const run = db.transaction(() => {
  for (const name of targets) {
    const project = findProject.get(name)
    if (!project) {
      report.push(`  ${name}: no such project, skipped`)
      continue
    }

    const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY scheduled_date, sort')
      .all(project.id)
    const dates = [...new Set(tasks.map((t) => t.scheduled_date).filter(Boolean))]

    // The routine definition: each distinct title once, keeping the duration and
    // column position it most often had.
    const seen = new Map()
    for (const t of tasks) {
      if (!seen.has(t.title)) seen.set(t.title, t)
    }

    // Three columns were how these were actually used, so keep that layout.
    const usesColumns = tasks.some((t) => t.col_index != null)
    const layout = usesColumns ? 'columns' : 'list'

    const routineId = db.prepare(`
      INSERT INTO routines (name, color, layout, weekday, sort)
      VALUES (?, ?, ?, NULL, (SELECT COALESCE(MAX(sort), -1) + 1 FROM routines))
    `).run(project.name, project.color, layout).lastInsertRowid

    const addItem = db.prepare(`
      INSERT INTO routine_items (routine_id, title, estimate_min, col_index, sort)
      VALUES (?, ?, ?, ?, ?)
    `)
    let i = 0
    for (const t of seen.values()) addItem.run(routineId, t.title, t.estimate_min, t.col_index, i++)

    // One section per day the routine actually ran, so history keeps its shape.
    const addSection = db.prepare(`
      INSERT INTO sections (date, name, color, layout, sort)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM sections WHERE date = ?))
    `)
    const moveTasks = db.prepare(
      'UPDATE tasks SET section_id = ?, project_id = NULL WHERE project_id = ? AND scheduled_date = ?'
    )

    for (const date of dates) {
      const sectionId = addSection.run(date, project.name, project.color, layout, date).lastInsertRowid
      moveTasks.run(sectionId, project.id, date)
    }

    // Anything left had no date; detach it rather than delete it with the project.
    db.prepare('UPDATE tasks SET project_id = NULL WHERE project_id = ?').run(project.id)
    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id)

    report.push(
      `  ${project.name}: ${tasks.length} tasks -> ${dates.length} daily sections, ` +
      `${seen.size} routine items (${layout}), project removed`
    )
  }

  if (dryRun) throw new Error('__rollback__')
})

try {
  run()
} catch (err) {
  if (err.message !== '__rollback__') throw err
}

console.log(`\nroutine migration${dryRun ? ' — DRY RUN, nothing written' : ''}\n`)
report.forEach((line) => console.log(line))
console.log(`\n  projects remaining  ${db.prepare('SELECT COUNT(*) n FROM projects').get().n}`)
console.log(`  sections            ${db.prepare('SELECT COUNT(*) n FROM sections').get().n}`)
console.log(`  routines            ${db.prepare('SELECT COUNT(*) n FROM routines').get().n}\n`)
