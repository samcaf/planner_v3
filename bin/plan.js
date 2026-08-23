#!/usr/bin/env node
/**
 * Terminal front-end for the same SQLite database the web app uses.
 * Talks to the file directly, so it works whether or not the server is running.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db, ensureDay, today } from '../server/db.js'

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', off: '\x1b[0m' }
  : { dim: '', b: '', g: '', y: '', r: '', c: '', off: '' }

const MARK = { todo: '[ ]', doing: '[~]', done: '[x]', dropped: '[-]' }

const [cmd = 'today', ...rest] = process.argv.slice(2)

/**
 * `-f value` pulled out, leaving the positional words. Bare `-!` is a boolean,
 * so it must not swallow the next argument.
 */
function opts(args) {
  const flags = {}
  const words = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-!') flags['!'] = true
    else if (a.startsWith('-')) flags[a.replace(/^-+/, '')] = args[++i]
    else words.push(a)
  }
  return { flags, words, text: words.join(' ') }
}

function resolveDate(s) {
  if (!s || s === 'today') return today()
  if (s === 'tomorrow' || s === 'tmr') return offset(1)
  if (s === 'yesterday') return offset(-1)
  if (/^[+-]\d+$/.test(s)) return offset(Number(s))
  return s
}

function offset(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function findProject(name) {
  if (!name) return null
  const row = db.prepare('SELECT id, name FROM projects WHERE name LIKE ? ORDER BY length(name) LIMIT 1')
    .get(`%${name}%`)
  if (!row) {
    console.error(`${C.r}no project matching "${name}"${C.off}`)
    process.exit(1)
  }
  return row.id
}

function taskLine(t) {
  const mark = t.status === 'done' ? `${C.g}${MARK.done}${C.off}`
    : t.status === 'doing' ? `${C.y}${MARK.doing}${C.off}`
    : t.status === 'dropped' ? `${C.dim}${MARK.dropped}${C.off}`
    : MARK.todo
  const proj = t.project_name ? ` ${C.c}[${t.project_name}]${C.off}` : ''
  const pri = t.priority === 'high' ? ` ${C.r}!${C.off}` : ''
  const est = t.estimate_min ? ` ${C.dim}${t.estimate_min}m${C.off}` : ''
  const title = t.status === 'done' || t.status === 'dropped' ? `${C.dim}${t.title}${C.off}` : t.title
  return `  ${C.dim}${String(t.id).padStart(3)}${C.off} ${mark} ${title}${proj}${pri}${est}`
}

function showDay(date) {
  const day = ensureDay(date)
  const events = db.prepare(`
    SELECT e.*, p.name AS project_name FROM events e
    LEFT JOIN projects p ON p.id = e.project_id
    WHERE e.date = ? ORDER BY e.start_time IS NULL, e.start_time
  `).all(date)
  const tasks = db.prepare(`
    SELECT t.*, p.name AS project_name FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.scheduled_date = ? ORDER BY t.sort, t.id
  `).all(date)
  const due = db.prepare(`
    SELECT m.title, p.name AS project_name FROM milestones m
    JOIN projects p ON p.id = m.project_id
    WHERE m.due_date = ? AND m.done = 0
  `).all(date)

  console.log(`\n${C.b}${date}${C.off}${date === today() ? `${C.dim}  (today)${C.off}` : ''}`)

  if (events.length) {
    console.log(`\n${C.dim}schedule${C.off}`)
    for (const e of events) {
      const time = (e.start_time || '—').padEnd(5)
      console.log(`  ${C.y}${time}${C.off} ${e.title}${e.project_name ? ` ${C.c}[${e.project_name}]${C.off}` : ''}`)
    }
  }

  if (due.length) {
    console.log(`\n${C.dim}due${C.off}`)
    for (const m of due) console.log(`  ${C.r}⚑${C.off} ${m.title} ${C.c}[${m.project_name}]${C.off}`)
  }

  const open = tasks.filter((t) => t.status === 'todo' || t.status === 'doing')
  const closed = tasks.filter((t) => t.status === 'done' || t.status === 'dropped')

  console.log(`\n${C.dim}tasks${C.off}`)
  if (!tasks.length) console.log(`  ${C.dim}nothing planned${C.off}`)
  open.forEach((t) => console.log(taskLine(t)))
  if (closed.length) {
    console.log(`  ${C.dim}──${C.off}`)
    closed.forEach((t) => console.log(taskLine(t)))
  }

  if (day.notes) {
    console.log(`\n${C.dim}notes${C.off}`)
    day.notes.split('\n').forEach((l) => console.log(`  ${l}`))
  }
  console.log()
}

/** Round-trip a value through $EDITOR (vim by default). */
function edit(initial, suffix = '.md') {
  const file = join(mkdtempSync(join(tmpdir(), 'plan-')), `note${suffix}`)
  writeFileSync(file, initial ?? '')
  execFileSync(process.env.EDITOR || 'vim', [file], { stdio: 'inherit' })
  return readFileSync(file, 'utf8')
}

const commands = {
  today: () => showDay(today()),

  day: ([d]) => showDay(resolveDate(d)),

  add(_words, { text, flags }) {
    if (!text) return console.error('usage: plan add "title" [-p project] [-d date|+N|backlog] [-e minutes] [-!]')
    const date = flags.d === 'backlog' ? null : resolveDate(flags.d)
    const info = db.prepare(`
      INSERT INTO tasks (title, project_id, scheduled_date, estimate_min, priority, sort)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM tasks WHERE scheduled_date IS ?))
    `).run(text, findProject(flags.p), date, flags.e ? Number(flags.e) : null,
      '!' in flags ? 'high' : 'normal', date)
    console.log(`${C.g}added${C.off} #${info.lastInsertRowid} ${text}`)
  },

  done: ([id]) => setStatus(id, 'done'),
  doing: ([id]) => setStatus(id, 'doing'),
  undone: ([id]) => setStatus(id, 'todo'),
  drop: ([id]) => setStatus(id, 'dropped'),

  rm([id]) {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    console.log(`${C.dim}deleted #${id}${C.off}`)
  },

  mv([id, d]) {
    const date = d === 'backlog' ? null : resolveDate(d)
    db.prepare('UPDATE tasks SET scheduled_date = ? WHERE id = ?').run(date, id)
    console.log(`${C.g}moved${C.off} #${id} → ${date || 'backlog'}`)
  },

  week() {
    const start = new Date()
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    const p = (x) => String(x).padStart(2, '0')
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      const rows = db.prepare(`
        SELECT status, COUNT(*) n FROM tasks WHERE scheduled_date = ? GROUP BY status
      `).all(date)
      const open = rows.filter((r) => r.status === 'todo' || r.status === 'doing')
        .reduce((s, r) => s + r.n, 0)
      const done = rows.find((r) => r.status === 'done')?.n || 0
      const mark = date === today() ? `${C.b}▸${C.off}` : ' '
      console.log(`${mark} ${date}  ${String(open).padStart(2)} open  ${C.dim}${done} done${C.off}`)
    }
  },

  backlog() {
    const rows = db.prepare(`
      SELECT t.*, p.name AS project_name FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.scheduled_date IS NULL AND t.status IN ('todo','doing')
      ORDER BY t.sort, t.id
    `).all()
    console.log(`\n${C.b}backlog${C.off} ${C.dim}(${rows.length})${C.off}`)
    rows.forEach((t) => console.log(taskLine(t)))
    console.log()
  },

  projects() {
    const rows = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status IN ('todo','doing')) open
      FROM projects p WHERE status != 'archived' ORDER BY sort, name
    `).all()
    console.log()
    for (const p of rows) {
      console.log(`  ${C.c}${p.name.padEnd(18)}${C.off} ${String(p.open).padStart(3)} open  ${C.dim}${p.status}${C.off}`)
    }
    console.log()
  },

  people(_words, { text }) {
    const rows = text
      ? db.prepare(`
          SELECT pe.*, o.name org_name FROM people pe LEFT JOIN orgs o ON o.id = pe.org_id
          WHERE pe.name LIKE ? OR pe.role LIKE ? OR pe.tags LIKE ? ORDER BY pe.name
        `).all(`%${text}%`, `%${text}%`, `%${text}%`)
      : db.prepare(`
          SELECT pe.*, o.name org_name FROM people pe LEFT JOIN orgs o ON o.id = pe.org_id
          ORDER BY pe.name
        `).all()
    console.log()
    for (const p of rows) {
      console.log(`  ${p.name.padEnd(22)} ${C.dim}${(p.role || '').padEnd(16)}${p.org_name || ''}${C.off}`)
      if (p.email) console.log(`  ${C.dim}${''.padEnd(22)}${p.email}${C.off}`)
    }
    console.log()
  },

  note([d]) {
    const date = resolveDate(d)
    const day = ensureDay(date)
    const next = edit(day.notes)
    db.prepare('UPDATE days SET notes = ? WHERE date = ?').run(next, date)
    console.log(`${C.g}saved${C.off} notes for ${date}`)
  },

  edit([id]) {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
    if (!t) return console.error(`${C.r}no task #${id}${C.off}`)
    const next = edit(`${t.title}\n---\n${t.notes}`)
    const [title, ...body] = next.split('\n---\n')
    db.prepare('UPDATE tasks SET title = ?, notes = ? WHERE id = ?')
      .run(title.trim(), body.join('\n---\n').trim(), id)
    console.log(`${C.g}saved${C.off} #${id}`)
  },

  apply([name, d]) {
    const date = resolveDate(d)
    const t = db.prepare('SELECT * FROM templates WHERE name LIKE ? LIMIT 1').get(`%${name}%`)
    if (!t) return console.error(`${C.r}no template matching "${name}"${C.off}`)
    const items = db.prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort').all(t.id)
    const seen = new Set(db.prepare('SELECT title FROM tasks WHERE scheduled_date = ?').all(date).map((x) => x.title))
    let base = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 n FROM tasks WHERE scheduled_date = ?').get(date).n
    let added = 0
    const ins = db.prepare(`
      INSERT INTO tasks (title, project_id, scheduled_date, estimate_min, sort, from_template)
      VALUES (?, ?, ?, ?, ?, 1)
    `)
    db.transaction(() => {
      for (const i of items) {
        if (seen.has(i.title)) continue
        ins.run(i.title, i.project_id, date, i.estimate_min, base++)
        added++
      }
    })()
    console.log(`${C.g}applied${C.off} "${t.name}" to ${date} — ${added} added`)
  },

  rollover([from, to]) {
    const a = resolveDate(from || '-1')
    const b = resolveDate(to || 'today')
    const info = db.prepare(`
      UPDATE tasks SET scheduled_date = ?
      WHERE scheduled_date = ? AND status IN ('todo','doing')
    `).run(b, a)
    console.log(`${C.g}moved${C.off} ${info.changes} task(s) ${a} → ${b}`)
  },

  help() {
    console.log(`
${C.b}plan${C.off} — terminal planner

  ${C.c}plan${C.off}                        today's plan
  ${C.c}plan day${C.off} <date|+N|tomorrow>  a specific day
  ${C.c}plan week${C.off}                    this week at a glance
  ${C.c}plan backlog${C.off}                 unscheduled tasks

  ${C.c}plan add${C.off} "title" [-p proj] [-d date|backlog] [-e mins] [-!]
  ${C.c}plan done|doing|undone|drop${C.off} <id>
  ${C.c}plan mv${C.off} <id> <date|backlog>   reschedule
  ${C.c}plan rm${C.off} <id>                  delete
  ${C.c}plan edit${C.off} <id>                title + notes in $EDITOR
  ${C.c}plan note${C.off} [date]              day notes in $EDITOR

  ${C.c}plan apply${C.off} <template> [date]  pre-fill a day
  ${C.c}plan rollover${C.off} [from] [to]     move unfinished tasks forward

  ${C.c}plan projects${C.off}                 ${C.c}plan people${C.off} [query]

Dates accept ${C.dim}2026-08-20${C.off}, ${C.dim}today${C.off}, ${C.dim}tomorrow${C.off}, ${C.dim}yesterday${C.off}, or ${C.dim}+3${C.off} / ${C.dim}-1${C.off}.
`)
  },
}

function setStatus(id, status) {
  const info = db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?')
    .run(status, status === 'done' ? new Date().toISOString() : null, id)
  if (!info.changes) return console.error(`${C.r}no task #${id}${C.off}`)
  console.log(`${C.g}#${id}${C.off} → ${status}`)
}

const run = commands[cmd]
if (!run) {
  console.error(`unknown command "${cmd}"`)
  commands.help()
  process.exit(1)
}

const parsed = opts(rest)
run(parsed.words, parsed)
