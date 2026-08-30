import { Router } from 'express'
import { db } from '../db.js'
import { h } from './_helpers.js'

const r = Router()

r.get('/', h(() =>
  Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s) => [s.key, s.value]))
))

r.patch('/', h((req) => {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  db.transaction(() => {
    for (const [key, value] of Object.entries(req.body || {})) stmt.run(key, String(value))
  })()
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((s) => [s.key, s.value]))
}))

/**
 * Forget a setting entirely.
 *
 * Distinct from patching it to '': an empty row reads the same to every
 * consumer but is residue, and the next person to look at the table has to
 * work out whether it means "off" or "never set".
 */
r.delete('/:key', h((req) => {
  db.prepare('DELETE FROM settings WHERE key = ?').run(req.params.key)
  return null
}))

export default r
