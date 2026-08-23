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

export default r
