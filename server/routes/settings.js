import { Router } from 'express'
import { db } from '../db.js'
import { h } from './_helpers.js'
import { secretKeys } from '../integrations/registry.js'

const r = Router()

/**
 * Settings that are credentials rather than preferences.
 *
 * An integration's token is a credential for ANOTHER system. Everything else in
 * this table is a pomodoro length or a column name — losing one costs a
 * preference; losing a token costs whatever it can do over there. So they go
 * out one-way: writing works, reading back gives `''` and a companion
 * `<key>_set` saying whether there is one, which is all a page offering to
 * replace it needs to know.
 *
 * Which keys those are comes from the adapter registry, so an integration that
 * adds a secret field is redacted without this file being told about it.
 */
const readable = () => {
  const all = Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map((s) => [s.key, s.value]),
  )
  for (const key of secretKeys()) {
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
