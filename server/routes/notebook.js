import { Router } from 'express'
import { db } from '../db.js'
import { crud, h, nextSort } from './_helpers.js'

const FIELDS = ['title', 'body', 'sort', 'pinned']
const notes = crud('notebook', FIELDS)
const r = Router()

/** Pinned first, then most recently touched — a notebook is not a queue. */
r.get('/', h(() => db.prepare(`
  SELECT * FROM notebook ORDER BY pinned DESC, updated_at DESC, id DESC
`).all()))

r.get('/:id', h((req) => notes.get(req.params.id)))

r.post('/', h((req) => notes.create({ sort: nextSort('notebook'), ...(req.body || {}) })))

r.patch('/:id', h((req) => {
  notes.update(req.params.id, req.body || {})
  // Touched on every write, because "most recently worked on" is the only
  // ordering a loose pile of notes has that means anything.
  db.prepare("UPDATE notebook SET updated_at = datetime('now') WHERE id = ?").run(req.params.id)
  return notes.get(req.params.id)
}))

r.delete('/:id', h((req) => {
  notes.remove(req.params.id)
  return { ok: true }
}))

export default r
