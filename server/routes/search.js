import { Router } from 'express'
import { db } from '../db.js'
import { badRequest, h } from './_helpers.js'

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

/** GET /api/search?q=… — tasks (title and notes) and day notes, in one list. */
r.get('/', h((req) => {
  const q = String(req.query.q || '').trim()
  // A single character matches most of the database, so it is not worth running.
  if (q.length < 2) return { query: q, count: 0, results: [] }

  const limit = Math.min(Number(req.query.limit) || 60, 200)
  const like = contains(q)

  const tasks = db.prepare(`
    ${WITH_PROJECT}
    WHERE t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\'
    ORDER BY t.scheduled_date IS NULL, t.scheduled_date DESC, t.id DESC
    LIMIT ?
  `).all(like, like, limit)

  const days = db.prepare(`
    SELECT date, title, notes FROM days
    WHERE notes LIKE ? ESCAPE '\\'
    ORDER BY date DESC
    LIMIT ?
  `).all(like, limit)

  const results = [
    ...tasks.map((t) => taskItem(t, hasText(t.title, q) ? 'title' : 'notes', q)),
    ...days.map((d) => dayItem(d, q)),
  ]

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
