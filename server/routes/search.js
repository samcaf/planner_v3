import { Router } from 'express'
import { db } from '../db.js'
import { badRequest, h } from './_helpers.js'
import { listUploads } from './uploads.js'

/**
 * Text search and `[[…]]` backlinks over tasks and day notes.
 *
 * Both are plain LIKE scans. One person's planner is a few thousand rows, so a
 * full scan costs well under a millisecond, while FTS5 would mean a shadow copy
 * of every note plus triggers to keep it honest — a lot of machinery to buy
 * nothing anyone would notice.
 */

const r = Router()

const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * `%` and `_` are wildcards inside LIKE, so an unescaped query like `a_b.png`
 * would match far more than itself. The backslash only counts because every
 * pattern below is used with ESCAPE '\'.
 */
const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`)
const contains = (s) => `%${escapeLike(s)}%`

const hasText = (text, needle) =>
  String(text || '').toLowerCase().includes(String(needle).toLowerCase())

/** A markdown title as plain text — a result row has no room to render it. */
const plain = (s) => String(s || '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`_]/g, '')

/** Characters of context kept on each side of a match. */
const PAD = 60

function snippet(text, needle) {
  const src = String(text || '').replace(/\s+/g, ' ').trim()
  const at = needle ? src.toLowerCase().indexOf(String(needle).toLowerCase()) : -1
  if (at < 0) return src.slice(0, PAD * 2)
  const from = Math.max(0, at - PAD)
  const to = Math.min(src.length, at + String(needle).length + PAD)
  return `${from > 0 ? '…' : ''}${src.slice(from, to)}${to < src.length ? '…' : ''}`
}

const WITH_PROJECT = `
  SELECT t.id, t.title, t.notes, t.kind, t.scheduled_date, t.status,
         p.name AS project_name, p.color AS project_color
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
`

/** One row of the unified result list, whichever endpoint produced it. */
function taskItem(t, field, needle) {
  return {
    kind: t.kind === 'note' ? 'note' : 'task',
    id: t.id,
    field,
    title: plain(t.title).trim() || (t.kind === 'note' ? 'Note' : `Task ${t.id}`),
    snippet: snippet(field === 'title' ? t.title : t.notes, needle),
    date: t.scheduled_date || null,
    project_name: t.project_name || null,
    project_color: t.project_color || null,
    // A backlog task has no day to open, so the cross-cutting list is where it
    // can actually be found — the same fallback the `[[…]]` resolver uses.
    href: t.scheduled_date ? `/day/${t.scheduled_date}` : '/tasks',
  }
}

function dayItem(d, needle) {
  return {
    kind: 'day',
    id: d.date,
    field: 'notes',
    title: d.title || d.date,
    snippet: snippet(d.notes, needle),
    date: d.date,
    project_name: null,
    project_color: null,
    href: `/day/${d.date}`,
  }
}

function noteItem(n, field, needle) {
  return {
    kind: 'notebook',
    id: n.id,
    field,
    title: plain(n.title).trim() || 'Untitled note',
    snippet: snippet(field === 'title' ? n.title : n.body, needle),
    date: null,
    project_name: null,
    project_color: null,
    href: '/notebook',
  }
}

function projectItem(p, field, needle) {
  return {
    kind: 'project',
    id: p.id,
    field,
    title: p.name,
    snippet: snippet(field === 'title' ? p.name : p.description, needle),
    date: null,
    project_name: p.name,
    project_color: p.color,
    href: `/projects/${p.id}`,
  }
}

function personItem(p, field, needle) {
  return {
    kind: 'person',
    id: p.id,
    field,
    title: p.name,
    snippet: snippet(field === 'title' ? [p.role, p.email].filter(Boolean).join(' · ') : p.notes, needle),
    date: p.last_touch || null,
    project_name: null,
    project_color: p.color || null,
    href: `/people/${p.id}`,
  }
}

function uploadItem(u, needle) {
  return {
    kind: 'upload',
    id: u.name,
    field: 'title',
    title: u.filename,
    snippet: `${u.mime} · ${Math.max(1, Math.round(u.bytes / 1024))} KB`,
    date: u.mtime.slice(0, 10),
    project_name: null,
    project_color: null,
    ext: (u.filename.slice(u.filename.lastIndexOf('.') + 1) || '').toLowerCase(),
    href: u.url,
    needle,
  }
}

/**
 * GET /api/search?q=… — everything the planner holds, in one list.
 *
 * Filters narrow it without needing a different endpoint per kind:
 *
 *   kind=task,note        which sorts of thing to include
 *   project_id=3          tasks and notes filed under one project
 *   priority=high,highest
 *   status=todo,doing
 *   from=…&to=…           scheduled between two dates
 *   ext=pdf,png           uploads of a given type
 *
 * An absent filter means "do not narrow on this", so the plain query still
 * searches everything. Filters that cannot apply to a kind — a priority on an
 * upload — simply exclude that kind rather than being ignored, because a search
 * for high-priority things should not return files.
 */
const ALL_KINDS = ['task', 'note', 'day', 'notebook', 'project', 'person', 'upload']

const csv = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean)

r.get('/', h((req) => {
  const q = String(req.query.q || '').trim()
  const kinds = new Set(csv(req.query.kind).length ? csv(req.query.kind) : ALL_KINDS)
  const projectId = req.query.project_id ? Number(req.query.project_id) : null
  const priorities = csv(req.query.priority)
  const statuses = csv(req.query.status)
  const exts = csv(req.query.ext).map((e) => e.toLowerCase().replace(/^\./, ''))
  const from = ISO.test(req.query.from || '') ? req.query.from : null
  const to = ISO.test(req.query.to || '') ? req.query.to : null

  const narrowed = projectId || priorities.length || statuses.length || exts.length || from || to
  // A single character matches most of the database. With a filter on, though,
  // an empty query is a perfectly good way to say "everything in this project".
  if (q.length < 2 && !narrowed) return { query: q, count: 0, results: [] }

  const limit = Math.min(Number(req.query.limit) || 60, 200)
  const like = contains(q)
  const anyText = q.length < 2

  const results = []

  // --- tasks and the notes written on a day ------------------------------
  if (kinds.has('task') || kinds.has('note')) {
    const where = [anyText ? '1' : `(t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')`]
    const args = anyText ? [] : [like, like]
    if (projectId) { where.push('t.project_id = ?'); args.push(projectId) }
    if (priorities.length) {
      where.push(`t.priority IN (${priorities.map(() => '?').join(',')})`)
      args.push(...priorities)
    }
    if (statuses.length) {
      where.push(`t.status IN (${statuses.map(() => '?').join(',')})`)
      args.push(...statuses)
    }
    if (from) { where.push('t.scheduled_date >= ?'); args.push(from) }
    if (to) { where.push('t.scheduled_date <= ?'); args.push(to) }
    where.push('t.archived = 0')

    const rows = db.prepare(`
      ${WITH_PROJECT}
      WHERE ${where.join(' AND ')}
      ORDER BY t.scheduled_date IS NULL, t.scheduled_date DESC, t.id DESC
      LIMIT ?
    `).all(...args, limit)

    for (const t of rows) {
      const kind = t.kind === 'note' ? 'note' : 'task'
      if (!kinds.has(kind)) continue
      results.push(taskItem(t, hasText(t.title, q) ? 'title' : 'notes', q))
    }
  }

  // --- a day's own notes ---------------------------------------------------
  // Skipped whenever a filter is on that a day cannot answer: a day has no
  // project, priority or status, so including it would widen a narrowed search.
  if (kinds.has('day') && !projectId && !priorities.length && !statuses.length && !exts.length) {
    const where = [anyText ? '1' : `notes LIKE ? ESCAPE '\\'`]
    const args = anyText ? [] : [like]
    if (from) { where.push('date >= ?'); args.push(from) }
    if (to) { where.push('date <= ?'); args.push(to) }
    const days = db.prepare(`
      SELECT date, title, notes FROM days
      WHERE ${where.join(' AND ')}
      ORDER BY date DESC LIMIT ?
    `).all(...args, limit)
    results.push(...days.map((d) => dayItem(d, q)))
  }

  // --- notebook ------------------------------------------------------------
  if (kinds.has('notebook') && !projectId && !priorities.length && !statuses.length && !exts.length) {
    const notes = anyText
      ? db.prepare('SELECT * FROM notebook WHERE archived = 0 ORDER BY pinned DESC, sort LIMIT ?').all(limit)
      : db.prepare(`
          SELECT * FROM notebook
          WHERE archived = 0 AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
          ORDER BY pinned DESC, sort LIMIT ?
        `).all(like, like, limit)
    results.push(...notes.map((n) => noteItem(n, hasText(n.title, q) ? 'title' : 'body', q)))
  }

  // --- projects and people -------------------------------------------------
  if (kinds.has('project') && !priorities.length && !statuses.length && !exts.length) {
    const rows = anyText
      ? db.prepare('SELECT * FROM projects ORDER BY sort, id LIMIT ?').all(limit)
      : db.prepare(`
          SELECT * FROM projects
          WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
          ORDER BY sort, id LIMIT ?
        `).all(like, like, limit)
    results.push(...rows
      .filter((row) => !projectId || row.id === projectId)
      .map((row) => projectItem(row, hasText(row.name, q) ? 'title' : 'description', q)))
  }

  if (kinds.has('person') && !projectId && !priorities.length && !statuses.length && !exts.length) {
    const rows = anyText
      ? db.prepare('SELECT * FROM people ORDER BY name LIMIT ?').all(limit)
      : db.prepare(`
          SELECT * FROM people
          WHERE name LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\'
             OR email LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\'
          ORDER BY name LIMIT ?
        `).all(like, like, like, like, limit)
    results.push(...rows.map((row) => personItem(row, hasText(row.name, q) ? 'title' : 'notes', q)))
  }

  // --- uploads -------------------------------------------------------------
  // Files live on disk, not in a table, so this is a scan of the same listing
  // the uploads page shows rather than a query.
  if (kinds.has('upload') && !projectId && !priorities.length && !statuses.length) {
    const files = listUploads().filter((u) => {
      const ext = (u.filename.slice(u.filename.lastIndexOf('.') + 1) || '').toLowerCase()
      if (exts.length && !exts.includes(ext)) return false
      if (from && u.mtime.slice(0, 10) < from) return false
      if (to && u.mtime.slice(0, 10) > to) return false
      return anyText || hasText(u.filename, q) || hasText(u.mime, q)
    })
    results.push(...files.slice(0, limit).map((u) => uploadItem(u, q)))
  }

  // A hit in a title is usually what was being looked for; within that, the most
  // recent day first, since old plans are rarely the target of a search.
  results.sort((a, b) =>
    (a.field === b.field ? 0 : a.field === 'title' ? -1 : 1)
    || String(b.date || '').localeCompare(String(a.date || '')))

  return { query: q, count: results.length, results: results.slice(0, limit) }
}))

/**
 * `[[2026-08-10]]` and `[[day:2026-08-10]]` name the same day, so both collapse
 * to one `kind:value` key. A bare word is not a link the app can resolve — the
 * renderer leaves it as prose — so it canonicalises to nothing.
 */
function canonical(target) {
  const [, kind, rest] = /^(?:(day|project|task):)?([\s\S]*)$/.exec(String(target || '')) || []
  const value = (rest || '').trim()
  if (!value) return null
  const known = kind || (ISO.test(value) ? 'day' : null)
  return known ? `${known}:${value.toLowerCase()}` : null
}

/** LIKE patterns that could hold a link to `wanted`, with or without a label. */
function linkPatterns(wanted) {
  const at = wanted.indexOf(':')
  const kind = wanted.slice(0, at)
  const value = wanted.slice(at + 1)
  const bodies = [`${kind}:${value}`]
  if (kind === 'day') bodies.push(value)
  return bodies.map((b) => `%[[${escapeLike(b)}%`)
}

/** The first `[[…]]` in `text` that points at `wanted`, exactly as written. */
function findLink(text, wanted) {
  const src = String(text || '')
  const wiki = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g
  for (let m = wiki.exec(src); m; m = wiki.exec(src)) {
    if (canonical(m[1]) === wanted) return m[0]
  }
  return null
}

/**
 * GET /api/search/backlinks?target=project:Teleonomy — everything whose text
 * links to that target. LIKE only narrows the scan; the regex is what decides,
 * so `[[project:Teleonomy Labs]]` is not counted as a link to `Teleonomy`.
 */
r.get('/backlinks', h((req) => {
  const raw = String(req.query.target || '').trim()
  // A bare name is not a link inside a note, but as a query it can only have
  // meant a project — accepting it saves every caller knowing the syntax.
  const wanted = canonical(raw) || canonical(`project:${raw}`)
  if (!wanted) throw badRequest('target is required, e.g. project:Teleonomy or day:2026-08-10')

  const patterns = linkPatterns(wanted)
  const anyOf = (col) => patterns.map(() => `${col} LIKE ? ESCAPE '\\'`).join(' OR ')

  const tasks = db.prepare(`
    ${WITH_PROJECT}
    WHERE (${anyOf('t.title')}) OR (${anyOf('t.notes')})
    ORDER BY t.scheduled_date IS NULL, t.scheduled_date DESC, t.id DESC
  `).all(...patterns, ...patterns)

  const days = db.prepare(`
    SELECT date, title, notes FROM days
    WHERE ${anyOf('notes')}
    ORDER BY date DESC
  `).all(...patterns)

  const results = []

  for (const t of tasks) {
    const inTitle = findLink(t.title, wanted)
    const link = inTitle || findLink(t.notes, wanted)
    if (link) results.push(taskItem(t, inTitle ? 'title' : 'notes', link))
  }

  for (const d of days) {
    const link = findLink(d.notes, wanted)
    if (link) results.push(dayItem(d, link))
  }

  return { target: wanted, count: results.length, results }
}))

export default r
