/**
 * Demo data, so a fresh install has something to look at.
 *   npm run seed            add demo rows
 *   npm run seed -- --reset wipe everything first
 */
import { db, today } from './db.js'

const pad = (n) => String(n).padStart(2, '0')
const shift = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

if (process.argv.includes('--reset')) {
  for (const t of ['task_people', 'routine_items', 'routines',
    'tasks', 'milestones', 'projects', 'people', 'groups', 'days']) {
    db.prepare(`DELETE FROM ${t}`).run()
  }
  console.log('cleared existing rows')
}

const project = db.prepare('INSERT INTO projects (name, color, description, status, due_date, sort) VALUES (?,?,?,?,?,?)')
const milestone = db.prepare('INSERT INTO milestones (project_id, title, due_date, done, sort) VALUES (?,?,?,?,?)')
const task = db.prepare('INSERT INTO tasks (title, notes, project_id, status, priority, scheduled_date, due_date, estimate_min, sort) VALUES (?,?,?,?,?,?,?,?,?)')
const group = db.prepare('INSERT INTO groups (name, kind, website) VALUES (?,?,?)')
const person = db.prepare('INSERT INTO people (name, role, group_id, email, tags, notes, color) VALUES (?,?,?,?,?,?,?)')
const template = db.prepare('INSERT INTO routines (name, weekdays, sort) VALUES (?,?,?)')
const titem = db.prepare('INSERT INTO routine_items (routine_id, project_id, title, start_time, estimate_min, sort) VALUES (?,?,?,?,?,?)')

db.transaction(() => {
  const research = project.run('Research', 'purple',
    'Signal-processing work.\n\nCurrent focus: bounding reconstruction error under compression ratio $r$, where\n\n$$\\varepsilon(r) \\le C \\, r^{-\\alpha} \\log \\frac{1}{\\delta}$$\n\nwith $\\alpha$ set by the sparsity of the underlying representation.',
    'active', shift(38), 0).lastInsertRowid

  const platform = project.run('Platform', 'blue',
    'Internal tooling and infrastructure.', 'active', shift(15), 1).lastInsertRowid

  const fundraise = project.run('Fundraising', 'green',
    'Seed round. Track conversations in the [People](/people) directory.', 'active', shift(60), 2).lastInsertRowid

  const writing = project.run('Writing', 'amber', 'Papers, notes and talks.', 'planned', null, 3).lastInsertRowid

  milestone.run(research, 'Derive the error bound', shift(3), 0, 0)
  milestone.run(research, 'Simulation results reproduced', shift(20), 0, 1)
  milestone.run(research, 'Literature sweep', shift(-8), 1, 2)
  milestone.run(platform, 'v1 deploy', shift(15), 0, 0)
  milestone.run(fundraise, 'First close', shift(60), 0, 0)

  const orgA = group.run('Northwind Capital', 'investor', 'https://example.com').lastInsertRowid
  const orgB = group.run('Vector Labs', 'company', 'https://example.org').lastInsertRowid
  const orgC = group.run('University', 'academic', '').lastInsertRowid

  const p1 = person.run('Dana Whitfield', 'Partner', orgA, 'dana@example.com', 'investor, seed',
    'Warm intro through the accelerator. Wants to see the **error bound** result before committing.', 'green').lastInsertRowid
  const p2 = person.run('Ravi Menon', 'CTO', orgB, 'ravi@example.org', 'technical, advisor',
    'Deep background in RF front-ends. Good person to sanity-check hardware assumptions.', 'blue').lastInsertRowid
  const p3 = person.run('Ellen Park', 'Professor', orgC, 'epark@example.edu', 'academic, collaborator',
    'Co-author on the compression paper. Prefers async — send drafts, not meetings.', 'purple').lastInsertRowid
  person.run('Tom Alvarez', 'Analyst', orgA, 'tom@example.com', 'investor', '', 'teal')

  // Meetings are tasks with kind='meeting', so they carry time and intensity
  // like everything else and land in the same totals.
  const meet = db.prepare(`
    INSERT INTO tasks (title, kind, scheduled_date, start_time, end_time, url, notes,
                       project_id, estimate_min, intensity)
    VALUES (?, 'meeting', ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const attend = db.prepare('INSERT INTO task_people (task_id, person_id) VALUES (?,?)')

  attend.run(meet.run('Weekly research sync', shift(0), '10:00', '11:00',
    'https://example.com/meet/research', 'Standing agenda: results, blockers, next week.',
    research, 60, 'light').lastInsertRowid, p3)

  attend.run(meet.run('Northwind follow-up', shift(1), '15:30', '16:00',
    'https://example.com/call', 'Send the deck beforehand.',
    fundraise, 30, 'light').lastInsertRowid, p1)

  attend.run(meet.run('Hardware review', shift(3), '11:00', '12:00', '', '',
    platform, 60, 'deep').lastInsertRowid, p2)

  task.run('Finish the $\\varepsilon(r)$ derivation', 'Stuck on the constant $C$ — check whether the union bound is tight enough.', research, 'doing', 'high', shift(0), shift(6), 120, 0)
  task.run('Re-run simulations at $r = 8, 16, 32$', '', research, 'todo', 'medium', shift(0), null, 90, 1)
  task.run('Reply to [Ellen](/people/3) about the draft', '', research, 'todo', 'medium', shift(0), null, 15, 2)
  task.run('Review deploy checklist', '', platform, 'todo', 'medium', shift(0), null, 30, 3)
  task.run('Morning reading', '', null, 'done', 'low', shift(0), null, 30, 4)

  task.run('Update the pitch deck', '', fundraise, 'todo', 'high', shift(1), shift(1), 60, 0)
  task.run('Draft intro email to Vector Labs', '', fundraise, 'todo', 'medium', shift(1), null, 20, 1)
  task.run('Fix the flaky import job', '', platform, 'todo', 'medium', shift(2), null, 45, 0)
  task.run('Outline the methods section', '', writing, 'todo', 'medium', shift(3), null, 60, 0)
  task.run('Weekly review', '', null, 'todo', 'medium', shift(4), null, 30, 0)
  task.run('Prep hardware review notes', '', platform, 'todo', 'medium', shift(3), null, 30, 1)
  task.run('Read the Candès–Tao paper', 'Compare their RIP constant to ours.', research, 'todo', 'low', shift(-2), null, 60, 0)

  // Backlog — unscheduled on purpose, to demonstrate pulling into a day.
  task.run('Refactor the ingest pipeline', '', platform, 'todo', 'medium', null, null, 180, 0)
  task.run('Write up the noise-floor experiment', '', writing, 'todo', 'medium', null, null, 120, 1)
  task.run('Book travel for the conference', '', null, 'todo', 'low', null, null, 20, 2)

  const morning = template.run('Morning routine', '', 0).lastInsertRowid
  titem.run(morning, null, 'Plan the day', '08:30', 15, 0)
  titem.run(morning, null, 'Clear inbox', '08:45', 20, 1)
  titem.run(morning, research, 'Deep work block', '09:30', 120, 2)

  const weekly = template.run('Monday planning', '1', 1).lastInsertRowid
  titem.run(weekly, null, 'Review last week', null, 30, 0)
  titem.run(weekly, null, 'Set three priorities for the week', null, 15, 1)
  titem.run(weekly, fundraise, 'Update the pipeline', null, 30, 2)

  const friday = template.run('Friday wrap-up', '5', 2).lastInsertRowid
  titem.run(friday, null, 'Weekly review', null, 30, 0)
  titem.run(friday, writing, 'Write up what I learned', null, 45, 1)
  titem.run(friday, null, 'Clear the backlog', null, 20, 2)

  db.prepare('INSERT OR REPLACE INTO days (date, notes) VALUES (?, ?)').run(
    today(),
    'Today the goal is the error bound. Everything else is secondary.\n\nThe claim to prove:\n\n$$\\|x - \\hat{x}\\|_2 \\le C_1 \\frac{\\|x - x_s\\|_1}{\\sqrt{s}} + C_2 \\epsilon$$\n\nIf $C_2$ blows up for small $s$, the whole approach needs rethinking.'
  )
})()

console.log('seeded:',
  db.prepare('SELECT COUNT(*) n FROM projects').get().n, 'projects,',
  db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 'tasks,',
  db.prepare('SELECT COUNT(*) n FROM people').get().n, 'people,',
  db.prepare('SELECT COUNT(*) n FROM routines').get().n, 'routines')
