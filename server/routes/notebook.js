import { Router } from 'express'
import { db } from '../db.js'
import { crud, h, nextSort } from './_helpers.js'

const FIELDS = ['title', 'body', 'sort', 'pinned', 'archived']
const notes = crud('notebook', FIELDS)
const r = Router()

/**
 * Pinned first, then the order the user put them in, then recency for anything
 * never dragged. `sort` used to be written but never read — the list was purely
 * by recency — so a note moved by hand sprang back the moment anything was
 * edited. Recency is still the tiebreaker, which is what a pile of notes falls
 * back to before it has been arranged.
 *
 * Archived notes are excluded unless asked for: archiving exists to get a note
 * out of the list without deleting it, so leaving it in the list would be no
 * archiving at all.
 */
r.get('/', h((req) => {
  const withArchived = req.query.archived === '1'
  return db.prepare(`
    SELECT * FROM notebook
    ${withArchived ? '' : 'WHERE archived = 0'}
    ORDER BY pinned DESC, sort, updated_at DESC, id DESC
  `).all()
}))

/**
 * A new order for the list. Positions are written from the array's own order,
 * so the client sends what it drew and does not have to know the old values.
 */
r.post('/reorder', h((req) => {
  const ids = req.body?.ids || []
  if (!ids.length) return { ok: true, moved: 0 }

  const set = db.prepare('UPDATE notebook SET sort = ? WHERE id = ?')
  db.transaction(() => { ids.forEach((id, i) => set.run(i, id)) })()
  return { ok: true, moved: ids.length }
}))

r.get('/:id', h((req) => notes.get(req.params.id)))

r.post('/', h((req) => notes.create({ sort: nextSort('notebook'), ...(req.body || {}) })))

r.patch('/:id', h((req) => {
  const body = req.body || {}
  notes.update(req.params.id, body)

  // Touched on writes to the note's CONTENT, because "most recently worked on"
  // is the fallback ordering. Filing a note — pinning, archiving, reordering —
  // is not working on it, and stamping those would shuffle the list every time
  // you tidied it.
  const filingOnly = Object.keys(body).every((k) => ['pinned', 'archived', 'sort'].includes(k))
  if (!filingOnly) {
    db.prepare("UPDATE notebook SET updated_at = datetime('now') WHERE id = ?").run(req.params.id)
  }
  return notes.get(req.params.id)
}))

r.delete('/:id', h((req) => {
  notes.remove(req.params.id)
  return { ok: true }
}))

export default r
