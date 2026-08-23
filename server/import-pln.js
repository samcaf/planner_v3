/**
 * One-way import of the retired plain-text planner into planner_v3.
 *   node server/import-pln.js            import
 *   node server/import-pln.js --dry-run  parse and report, write nothing
 *   node server/import-pln.js --verbose  also list every line that was skipped
 *
 * The old tree is opened read-only and is never written, moved or removed.
 * Its vocabulary does not survive the crossing: each line's mark becomes a
 * status and a priority, each line's trailing tag becomes an estimate and a
 * column position, and nothing else is carried over.
 */
import { db } from './db.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Old planner tree. Sits beside this project unless PLN_SOURCE says otherwise. */
const SOURCE = process.env.PLN_SOURCE || join(here, '..', '..', 'planner', 'data')

const DRY_RUN = process.argv.includes('--dry-run')
const VERBOSE = process.argv.includes('--verbose')

/**
 * Re-running must replace the previous result, not double it, and the schema has
 * no column recording where a row came from. Rather than add one, each run
 * records the days it touched under this key and the next run clears exactly
 * those days before re-inserting. The trade-off: a task typed by hand into one
 * of those days is cleared too, which is fine while these days belong to the
 * import alone.
 */
const IMPORTED_DATES_KEY = 'pln_import_dates'

// Days live at <source>/YYYY/MM/YYYY-MM-DD.pln. Templates and scratch files sit
// elsewhere in the tree and are excluded by these shapes alone.
const YEAR_DIR = /^\d{4}$/
const MONTH_DIR = /^\d{2}$/
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.pln$/

const HEADER = /^@project\b\s*(.*)$/
const COLOR_SUFFIX = /\s*color\s*=\s*(\S+)\s*$/
const TASK = /^-\s*\[(.)\]\s*(.*)$/
const TAG_SUFFIX = /\s*@(short|med|long)\s*$/

/**
 * Each line began with a single character that planner_v3 has no field for, so
 * every one of them resolves into a status and a priority. The character itself
 * is dropped: the pair below is the whole of what is kept.
 */
const MARKER = {
  ' ': { status: 'todo', priority: 'normal' },
  x: { status: 'done', priority: 'normal' },
  '~': { status: 'dropped', priority: 'normal' },
  M: { status: 'dropped', priority: 'normal' },
  '?': { status: 'todo', priority: 'low' },
  '!': { status: 'todo', priority: 'high' },
}

/**
 * A trailing tag chose which of three printed columns a line was drawn in. It
 * becomes a duration and a column position, both of which planner_v3 already
 * has; an untagged line gets neither and simply sits in the day's flow.
 */
const TAG = {
  short: { estimate_min: 15, col_index: 0 },
  med: { estimate_min: 45, col_index: 1 },
  long: { estimate_min: 120, col_index: 2 },
}

const UNTAGGED = { estimate_min: null, col_index: null }

/** Old colour names onto the planner_v3 palette; anything unrecognised is neutral. */
const PALETTE = { blue: 'blue', purple: 'purple', green: 'green', yellow: 'amber', silver: 'gray' }
const NEUTRAL = 'gray'

/**
 * A header longer than this with nothing still open beneath it was a one-off
 * remark typed where a project name goes, so it is filed away instead of
 * crowding the active list. A header with no lines at all counts as nothing open.
 */
const HEADER_NAME_LIMIT = 40

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const projects = new Map() // lowercased name -> { name, color, total, open, id }
const days = [] // { date, path, tasks[] }
const prose = [] // free text: notes and journalling, not tasks
const unreadable = [] // lines that look like tasks but could not be read

/** Every day file in the tree, oldest first. */
function dayFiles() {
  const out = []
  for (const year of readdirSync(SOURCE).filter((d) => YEAR_DIR.test(d)).sort()) {
    for (const month of readdirSync(join(SOURCE, year)).filter((d) => MONTH_DIR.test(d)).sort()) {
      for (const name of readdirSync(join(SOURCE, year, month)).sort()) {
        const m = name.match(DAY_FILE)
        if (m) out.push({ date: m[1], path: join(SOURCE, year, month, name) })
      }
    }
  }
  return out
}

/**
 * Register the block a header opens and return its key, reusing an entry whose
 * name differs only by case. The colour is a suffix; a header that omits it is
 * still a perfectly good name, so the block is kept rather than its contents
 * orphaned. Where one name appeared under two colours the first one wins.
 */
function openProject(rest, at) {
  const suffix = rest.match(COLOR_SUFFIX)
  const name = (suffix ? rest.slice(0, suffix.index) : rest).trim()
  if (!name) {
    unreadable.push(`${at}  header with no name`)
    return null
  }

  const key = name.toLowerCase()
  if (!projects.has(key)) {
    projects.set(key, {
      name,
      color: PALETTE[suffix?.[1].toLowerCase()] || NEUTRAL,
      total: 0,
      open: 0, // lines left in a state the user could still act on
      id: null,
    })
  }
  return key
}

function parse() {
  for (const { date, path } of dayFiles()) {
    const tasks = []
    let project = null // key of the block we are inside; null before the first header

    const lines = readFileSync(path, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      const at = `${path}:${i + 1}`

      // Blank lines, rules and every directive but the header existed only to
      // shape the printed page, so none of them cross over. They also do not
      // close the surrounding block: a header runs until the next header.
      if (!line || line.startsWith('#')) continue

      const header = line.match(HEADER)
      if (header) {
        project = openProject(header[1], at)
        continue
      }
      if (line.startsWith('@')) continue

      const match = line.match(TASK)
      if (!match) {
        prose.push(`${at}  ${line}`)
        continue
      }

      const marker = MARKER[match[1]]
      if (!marker) {
        unreadable.push(`${at}  unrecognised mark: ${line}`)
        continue
      }

      // Strip the trailing tag; anything else in the line — markdown links
      // included — is the title exactly as it was written.
      const tag = match[2].match(TAG_SUFFIX)
      const title = (tag ? match[2].slice(0, tag.index) : match[2]).trim()
      if (!title) {
        unreadable.push(`${at}  no title: ${line}`)
        continue
      }

      const size = tag ? TAG[tag[1]] : UNTAGGED
      tasks.push({
        title,
        project,
        status: marker.status,
        priority: marker.priority,
        scheduled_date: date,
        estimate_min: size.estimate_min,
        sort: tasks.length, // order of appearance within the day
        col_index: size.col_index,
        // The old files record no clock time, so a finished line is dated to the
        // middle of its own day rather than to whenever this import is run.
        completed_at: marker.status === 'done' ? new Date(`${date}T12:00:00`).toISOString() : null,
      })

      if (project) {
        const p = projects.get(project)
        p.total++
        if (marker.status === 'todo' || marker.status === 'doing') p.open++
      }
    }

    days.push({ date, path, tasks })
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const findProject = db.prepare('SELECT id FROM projects WHERE lower(name) = lower(?)')
const nextProjectSort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM projects')
const insertProject = db.prepare('INSERT INTO projects (name, color, status, sort) VALUES (?,?,?,?)')
const insertTask = db.prepare(`
  INSERT INTO tasks (title, project_id, status, priority, scheduled_date,
                     estimate_min, sort, from_template, col_index, completed_at, source)
  VALUES (?,?,?,?,?,?,?,0,?,?,'pln')
`)
const clearDay = db.prepare("DELETE FROM tasks WHERE scheduled_date = ? AND source = 'pln'")
const countDay = db.prepare("SELECT COUNT(*) n FROM tasks WHERE scheduled_date = ? AND source = 'pln'")
const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
const writeSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)')

/** Days cleared by the previous run, if there was one. */
function previouslyImported() {
  const row = readSetting.get(IMPORTED_DATES_KEY)
  if (!row) return []
  try {
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return [] // a hand-edited value is not worth failing the run over
  }
}

function statusFor(p) {
  return p.open === 0 && p.name.length > HEADER_NAME_LIMIT ? 'archived' : 'active'
}

/** Everything the import writes, in one transaction so a failure leaves no half-state. */
const write = db.transaction((stale) => {
  let removed = 0
  for (const date of stale) removed += clearDay.run(date).changes

  for (const p of projects.values()) {
    if (p.id) continue // an existing project keeps its own colour and status
    p.id = insertProject.run(p.name, p.color, statusFor(p), nextProjectSort.get().n).lastInsertRowid
  }

  for (const day of days) {
    for (const t of day.tasks) {
      insertTask.run(
        t.title,
        t.project ? projects.get(t.project).id : null, // loose lines keep no project
        t.status,
        t.priority,
        t.scheduled_date,
        t.estimate_min,
        t.sort,
        t.col_index,
        t.completed_at
      )
    }
  }

  writeSetting.run(IMPORTED_DATES_KEY, JSON.stringify(days.map((d) => d.date)))
  return removed
})

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

if (!existsSync(SOURCE)) {
  console.error(`nothing to import: ${SOURCE} does not exist`)
  console.error('point PLN_SOURCE at the old planner\'s data directory and run again')
  process.exit(1)
}

parse()

if (!days.length) {
  console.error(`nothing to import: no day files found under ${SOURCE}`)
  process.exit(1)
}

// Resolving names up front lets the dry run report the same created/reused split
// the real run would produce.
for (const p of projects.values()) p.id = findProject.get(p.name)?.id ?? null

const allTasks = days.flatMap((d) => d.tasks)
const stale = previouslyImported()
const reused = [...projects.values()].filter((p) => p.id).length
const archiving = [...projects.values()].filter((p) => !p.id && statusFor(p) === 'archived').length
const removed = DRY_RUN
  ? stale.reduce((n, date) => n + countDay.get(date).n, 0)
  : write(stale)

const tally = (key) => {
  const out = {}
  for (const t of allTasks) out[t[key]] = (out[t[key]] || 0) + 1
  return Object.entries(out).sort().map(([k, v]) => `${k} ${v}`).join('   ')
}

const estimated = allTasks.filter((t) => t.estimate_min !== null).length

console.log(DRY_RUN ? '\npln import — DRY RUN, nothing written\n' : '\npln import\n')
console.log('  source        ', SOURCE)
console.log('  files parsed  ', days.length, ` ${days[0].date} … ${days[days.length - 1].date}`)
console.log('  tasks         ', allTasks.length)
console.log('    status      ', tally('status'))
console.log('    priority    ', tally('priority'))
console.log('    duration    ', `set ${estimated}   unset ${allTasks.length - estimated}`)
console.log('  projects      ', `${projects.size}   reused ${reused}   ${DRY_RUN ? 'to create' : 'created'} ${projects.size - reused}   of those archived ${archiving}`)
console.log('  cleared first ', `${removed} task(s) across ${stale.length} previously imported day(s)`)
console.log('  free text     ', `${prose.length} line(s) skipped — the old files' notes and journalling`)
console.log('  unreadable    ', `${unreadable.length} line(s)`)

for (const line of unreadable) console.log('      !', line)

if (VERBOSE) {
  console.log('\n  per day')
  for (const d of days) console.log(`    ${d.date}  ${String(d.tasks.length).padStart(3)} task(s)`)

  console.log('\n  projects')
  for (const p of projects.values()) {
    const fate = p.id ? `reused #${p.id}` : `new, ${statusFor(p)}`
    console.log(`    ${p.name}  —  ${p.color}, ${p.total} task(s), ${fate}`)
  }

  console.log('\n  free text skipped')
  for (const line of prose) console.log('   ', line)
}

console.log(DRY_RUN ? '\nrun again without --dry-run to write.\n' : '\ndone.\n')
