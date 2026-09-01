import { db } from '../db.js'

/**
 * Build a CRUD router body for a table. Each route module composes these so the
 * per-entity files only describe what is genuinely specific to that entity.
 */
export function crud(table, fields) {
  const cols = fields.join(', ')

  return {
    list: (where = '', args = [], order = 'id') =>
      db.prepare(`SELECT * FROM ${table} ${where} ORDER BY ${order}`).all(...args),

    get: (id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id),

    create(body) {
      const keys = fields.filter((f) => body[f] !== undefined)
      if (!keys.length) throw badRequest('no fields supplied')
      const stmt = db.prepare(
        `INSERT INTO ${table} (${keys.join(', ')})
         VALUES (${keys.map(() => '?').join(', ')})`
      )
      const info = stmt.run(...keys.map((k) => body[k]))
      return this.get(info.lastInsertRowid)
    },

    update(id, body) {
      const keys = fields.filter((f) => body[f] !== undefined)
      if (keys.length) {
        db.prepare(
          `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`
        ).run(...keys.map((k) => body[k]), id)
      }
      return this.get(id)
    },

    remove: (id) => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id),

    cols,
  }
}

export function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

/**
 * A refusal the caller is expected to handle, rather than a mistake it made.
 *
 * `code` is what it keys on. An agent that has spent its budget must do
 * something different from one that sent a malformed field, and telling them
 * apart by reading the sentence is how a protocol becomes a guessing game.
 */
export function refused(code, message, detail) {
  const err = new Error(message)
  err.status = 409
  err.code = code
  if (detail) err.detail = detail
  return err
}

export function notFound(message = 'not found') {
  const err = new Error(message)
  err.status = 404
  return err
}

/** Wrap an async/throwing handler so errors reach the express error middleware. */
export function h(fn) {
  const send = (out, res, next) => {
    // A handler that returns a promise gets awaited rather than serialised.
    // Without this a route that talks to anything over the network answers
    // `{}` — a resolved Promise has no enumerable keys — which looks like a
    // successful empty result rather than the mistake it is.
    if (out && typeof out.then === 'function') {
      out.then((v) => {
        if (v !== undefined) { res.json(v); return }
        if (!res.headersSent) res.status(404).json({ error: 'not found' })
      }, next)
      return true
    }
    return false
  }
  return (req, res, next) => {
    try {
      const out = fn(req, res)
      if (send(out, res, next)) return
      if (out !== undefined) { res.json(out); return }
      // A handler may answer through `res` itself; if it did neither, it looked
      // something up and found nothing. Without this the request hangs forever
      // instead of 404ing, which wedges the page rather than showing an error.
      if (!res.headersSent) res.status(404).json({ error: 'not found' })
    } catch (err) {
      next(err)
    }
  }
}

/** Next free sort value, so new rows land at the end of their group. */
export function nextSort(table, where = '', args = []) {
  const row = db
    .prepare(`SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM ${table} ${where}`)
    .get(...args)
  return row.n
}
