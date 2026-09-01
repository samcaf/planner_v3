import { db } from '../db.js'
import { bySource, secretKeys, settingKey } from './registry.js'

/**
 * Bringing linked tasks back into step with whatever they mirror.
 *
 * General: everything system-specific is behind the adapter. This file owns the
 * part that is the same whoever you are talking to — deciding which side moved,
 * what to do when both did, and leaving a trail when something is overwritten.
 *
 * It works on the linked set only: a task with `ext_source` set, which is a
 * task somebody chose. Nothing is mirrored, so this never has an opinion about
 * work that was not picked.
 *
 * Two fields cross the boundary: status and notes. Scheduling, priority,
 * estimates and sections are local by definition — the other system has no
 * place to put them and no view improved by having them.
 */

const setting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || ''

/** The configured, switched-on connection for one adapter, or null. */
export function connectionFor(name) {
  const adapter = bySource(name)
  if (!adapter) return null
  const values = Object.fromEntries(
    adapter.fields.map((f) => [f.key, setting(settingKey(name, f.key))]),
  )
  if (!values.url) return null
  return { adapter, conn: adapter.connect(values), on: setting(settingKey(name, 'on')) === '1' }
}

export const linked = () => db.prepare(
  `SELECT id, title, status, notes, waiting_on, due_date,
          ext_source, ext_id, ext_key, ext_status, ext_notes
     FROM tasks WHERE ext_source IS NOT NULL`,
).all()

export const linkedOne = (id) => db.prepare(
  `SELECT id, title, status, notes, waiting_on, due_date,
          ext_source, ext_id, ext_key, ext_status, ext_notes
     FROM tasks WHERE id = ?`,
).get(id)

/** What the sync did, where a person will find it. The planner's own doctrine:
 *  your prose is the notes, what an agent did is a comment. */
const note = (taskId, source, body) => db.prepare(
  `INSERT INTO task_comments (task_id, author, body, kind) VALUES (?, ?, ?, 'comment')`,
).run(taskId, source, body)

/**
 * Which side moved, given what each holds and what the sync last saw.
 *
 * The third value is what makes this answerable. With only two, "they differ"
 * is all you can say; with the value last written, you can tell WHICH side
 * moved — and only when both moved is there a conflict at all.
 *
 * A real conflict resolves to 'pull', because for anything that came from
 * another system, that system is the record. The caller is told, so the value
 * about to be overwritten can be kept somewhere.
 */
export function decide({ theirs, ours, base }) {
  const theyMoved = theirs !== base
  const weMoved = ours !== base
  if (!theyMoved && !weMoved) return { how: 'hold', conflict: false }
  if (theyMoved && !weMoved) return { how: 'pull', conflict: false }
  if (!theyMoved && weMoved) return { how: 'push', conflict: false }
  if (theirs === ours) return { how: 'hold', conflict: false }
  return { how: 'pull', conflict: true }
}

/**
 * One task, one pass. Returns what it did, so a caller can report rather than
 * guess.
 *
 * Pull before push: a pull applies what the record says, a push asks the record
 * to change, and doing it the other way round pushes a value we were about to
 * be told is stale.
 */
export async function reconcile(task, item, { adapter, conn }) {
  const acted = []
  const want = adapter.statusToPlanner(item.status)

  // ── status ───────────────────────────────────────────────────────────────
  //
  // Each side is measured in its OWN vocabulary, and the asymmetry is the
  // point. Their statuses need not map onto ours one-to-one — Teleonomy's
  // `in_progress` and `blocked` are both `doing` here. Judge their move by our
  // words and a task becoming blocked reads as no change at all: the row keeps
  // saying `doing`, having quietly lost the one fact that mattered.
  const baseStatus = task.ext_status ? adapter.statusToPlanner(task.ext_status).status : null
  const theyMoved = !!task.ext_status && item.status !== task.ext_status
  const weMoved = baseStatus !== null && task.status !== baseStatus

  if (theyMoved) {
    if (weMoved) {
      note(task.id, task.ext_source,
        `Status was "${task.status}" here and "${item.status}" in ${task.ext_key}. `
        + `${adapter.label} is the record for work that came from it, so this row `
        + `now says "${want.status}".`)
    }
    db.prepare('UPDATE tasks SET status = ?, waiting_on = ? WHERE id = ?')
      .run(want.status, want.waiting_on, task.id)
    acted.push({ field: 'status', how: 'pull', to: want.status, conflict: weMoved })
  } else if (weMoved) {
    // The adapter owns which moves are legal and where it must stop.
    for (const a of await adapter.pushStatus(conn, item, task.status)) {
      acted.push({ field: 'status', ...a })
      if (a.how === 'gated' && a.waiting_on) {
        db.prepare('UPDATE tasks SET waiting_on = ? WHERE id = ?').run(a.waiting_on, task.id)
      }
    }
  }

  // ── notes ────────────────────────────────────────────────────────────────
  const ours = task.notes ?? ''
  const call = decide({ theirs: item.notes, ours, base: task.ext_notes ?? '' })

  if (call.how === 'pull') {
    if (call.conflict) {
      note(task.id, task.ext_source,
        `Notes differed on both sides. ${adapter.label}'s won; what was here is kept below.\n\n${ours}`)
    }
    db.prepare('UPDATE tasks SET notes = ? WHERE id = ?').run(item.notes, task.id)
    acted.push({ field: 'notes', how: 'pull', conflict: call.conflict })
  } else if (call.how === 'push') {
    await adapter.pushNotes(conn, item, ours)
    acted.push({ field: 'notes', how: 'push' })
  }

  // What they hold NOW, the base for the next comparison. Read back rather than
  // assumed: a push just made is part of it, and a hop the gate refused is not.
  const after = await adapter.read(conn, task.ext_id).catch(() => item)
  db.prepare(
    `UPDATE tasks SET ext_status = ?, ext_notes = ?, ext_seen_at = datetime('now'),
                      due_date = COALESCE(due_date, ?)
       WHERE id = ?`,
  ).run(after.status, call.how === 'push' ? ours : item.notes, item.due_date, task.id)

  return { task: task.id, key: task.ext_key, source: task.ext_source, acted }
}

/** Every linked task, one pass each. The manual "sync now", and what the daemon
 *  runs on reconnect so a change missed while it was down is repaired. */
export async function reconcileAll() {
  const out = []
  const conns = new Map()
  for (const task of linked()) {
    try {
      if (!conns.has(task.ext_source)) conns.set(task.ext_source, connectionFor(task.ext_source))
      const link = conns.get(task.ext_source)
      if (!link) { out.push({ task: task.id, key: task.ext_key, error: 'not configured' }); continue }
      const item = await link.adapter.read(link.conn, task.ext_id)
      out.push(await reconcile(task, item, link))
    } catch (e) {
      out.push({ task: task.id, key: task.ext_key, error: e.message })
    }
  }
  return out
}

export { secretKeys }
