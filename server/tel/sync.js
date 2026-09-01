import { db } from '../db.js'
import * as tel from './client.js'
import { FROM_TEL, TO_TEL, decide, descriptionOf, pathTo, planFromTel } from './map.js'

/**
 * Bringing one linked task back into step with its Teleonomy direction.
 *
 * Everything here works on the linked set only — a task with `tel_uuid` set,
 * which is a task somebody chose. Nothing is mirrored, so this never has an
 * opinion about work that was not picked.
 *
 * Two fields cross the boundary: status and notes. Scheduling, priority,
 * estimates, sections and everything else the planner knows are local by
 * definition, because Teleonomy has no place to put them and no view that
 * would be improved by having them.
 */

export const linked = () => db.prepare(
  `SELECT id, title, status, notes, waiting_on, due_date,
          tel_uuid, tel_code, tel_status, tel_notes
     FROM tasks WHERE tel_uuid IS NOT NULL`,
).all()

export const linkedOne = (id) => db.prepare(
  `SELECT id, title, status, notes, waiting_on, due_date,
          tel_uuid, tel_code, tel_status, tel_notes
     FROM tasks WHERE id = ?`,
).get(id)

/** A note on the task saying what the sync did, so an overwrite leaves a trail
 *  a person can find. The planner's own doctrine: your prose is the notes, what
 *  an agent did is a comment. */
const note = (taskId, body) => db.prepare(
  `INSERT INTO task_comments (task_id, author, body, kind) VALUES (?, 'teleonomy', ?, 'comment')`,
).run(taskId, body)

/**
 * One task, one pass. Returns what it did, so a caller can report rather than
 * guess.
 *
 * The order matters: pull first, then push. A pull is applying what the record
 * says; a push is asking the record to change. Doing them the other way round
 * would push a value we were about to be told is stale.
 */
export async function reconcile(task, card) {
  const acted = []
  const theirStatus = card.status
  const theirNotes = descriptionOf(card)
  const want = planFromTel(card)

  // ── status ───────────────────────────────────────────────────────────────
  //
  // Each side is measured in its OWN vocabulary, and the asymmetry is the whole
  // point. Their five statuses do not map onto our three one-to-one:
  // `in_progress` and `blocked` are both `doing` here. Judge their move by our
  // words and a task becoming blocked reads as no change at all — the row keeps
  // saying `doing` and quietly loses the one fact that mattered.
  //
  // So: did THEY move is asked of their statuses, did WE move is asked of ours,
  // against what their last status meant over here.
  const baseStatus = task.tel_status ? (FROM_TEL[task.tel_status]?.status ?? null) : null
  const theyMoved = !!task.tel_status && theirStatus !== task.tel_status
  const weMoved = baseStatus !== null && task.status !== baseStatus
  const call = theyMoved
    ? { how: 'pull', conflict: weMoved }
    : weMoved
      ? { how: 'push', conflict: false }
      : { how: 'hold', conflict: false }

  if (call.how === 'pull') {
    if (call.conflict) {
      note(task.id, `Status was "${task.status}" here and "${theirStatus}" in `
        + `${task.tel_code}. Teleonomy is the record for work that came from it, `
        + `so this row now says "${want.status}".`)
    }
    db.prepare('UPDATE tasks SET status = ?, waiting_on = ? WHERE id = ?')
      .run(want.status, want.waiting_on, task.id)
    acted.push({ field: 'status', how: 'pull', to: want.status, conflict: call.conflict })
  } else if (call.how === 'push') {
    const target = TO_TEL[task.status]
    if (!target) {
      // `moved` and `dropped` have no honest equivalent. Saying so is the
      // action; inventing one would not be.
      acted.push({ field: 'status', how: 'skip', why: `"${task.status}" has no Teleonomy equivalent` })
    } else {
      const route = pathTo(theirStatus, target)
      if (!route.length && theirStatus !== target) {
        acted.push({
          field: 'status',
          how: 'blocked',
          why: `no route from "${theirStatus}" to "${target}" that avoids the approval gate`,
        })
      }
      for (const hop of route) {
        await tel.advance(task.tel_uuid, hop)
        acted.push({ field: 'status', how: 'push', to: hop })
      }
      // Ticking done here reaches needs_review there, and stops. The row says
      // so rather than quietly disagreeing with the board.
      if (task.status === 'done' && route.at(-1) === 'needs_review') {
        db.prepare('UPDATE tasks SET waiting_on = ? WHERE id = ?')
          .run('review in Teleonomy', task.id)
        acted.push({ field: 'status', how: 'gated', at: 'needs_review' })
      }
    }
  }

  // ── notes ────────────────────────────────────────────────────────────────
  const ours = task.notes ?? ''
  const base = task.tel_notes ?? ''
  const notes = decide({ theirs: theirNotes, ours, base })

  if (notes.how === 'pull') {
    if (notes.conflict) {
      note(task.id, `Notes differed on both sides. Teleonomy's won; what was `
        + `here is kept below.\n\n${ours}`)
    }
    db.prepare('UPDATE tasks SET notes = ? WHERE id = ?').run(theirNotes, task.id)
    acted.push({ field: 'notes', how: 'pull', conflict: notes.conflict })
  } else if (notes.how === 'push') {
    await tel.setDescription(task.tel_uuid, ours)
    acted.push({ field: 'notes', how: 'push' })
  }

  // What Teleonomy holds NOW, which is the base for the next comparison. Read
  // back rather than assumed: a push we just made is part of it, and a hop the
  // gate refused is not.
  const after = await tel.card(task.tel_uuid).catch(() => null)
  const settled = after?.card ?? after ?? card
  db.prepare(
    `UPDATE tasks SET tel_status = ?, tel_notes = ?, tel_seen_at = datetime('now'),
                      due_date = COALESCE(due_date, ?)
       WHERE id = ?`,
  ).run(
    settled.status ?? theirStatus,
    notes.how === 'push' ? ours : theirNotes,
    want.due_date,
    task.id,
  )

  return { task: task.id, code: task.tel_code, acted }
}

/** Every linked task, one pass each. The manual "sync now", and what the daemon
 *  runs when it reconnects so a change missed while it was down is repaired
 *  rather than lost. */
export async function reconcileAll() {
  const out = []
  for (const task of linked()) {
    try {
      const got = await tel.card(task.tel_uuid)
      out.push(await reconcile(task, got?.card ?? got))
    } catch (e) {
      out.push({ task: task.id, code: task.tel_code, error: e.message })
    }
  }
  return out
}
