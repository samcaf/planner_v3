import { Router } from 'express'
import { db } from '../db.js'
import { h } from './_helpers.js'

const r = Router()

/**
 * Settings that are credentials rather than preferences.
 *
 * `tel_token` is a bearer token for ANOTHER system. Everything else in this
 * table is a pomodoro length or a column name — losing one costs a preference;
 * losing this one costs whatever that token can do in Teleonomy. So it goes out
 * one-way: writing it works, reading it back gives you `''` and a companion
 * `tel_token_set` saying whether there is one, which is all the page that
 * offers to replace it actually needs to know.
 */
const SECRET = ['tel_token']

const readable = () => {
  const all = Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map((s) => [s.key, s.value]),
  )
  for (const key of SECRET) {
    if (!(key in all)) continue
    all[`${key}_set`] = all[key] ? '1' : ''
    all[key] = ''
  }
  return all
}

r.get('/', h(() => readable()))

r.patch('/', h((req) => {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)
  db.transaction(() => {
    for (const [key, value] of Object.entries(req.body || {})) stmt.run(key, String(value))
  })()
  return readable()
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
