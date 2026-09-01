/**
 * What a status means on the other side, and how far a push may go.
 *
 * The two apps do not merely spell statuses differently — they disagree about
 * what a status IS. The planner's five are a flat set: any of them can be set
 * from any other, because a person deciding a task is done is the whole of the
 * event. Teleonomy's are a state machine held in table rows (`mode`, `state`,
 * `transition`, seeded in its 0010 migration), where a status is a position you
 * arrive at through a legal move, and every move is recorded in an audit ledger
 * that the team reads.
 *
 * So the mapping is not symmetric and should not pretend to be.
 */

/** Teleonomy's `do` lifecycle → what the planner should show. */
export const FROM_TEL = {
  // The planner's backlog is exactly an unscheduled task, which is the same
  // idea arrived at independently. The import leaves it unscheduled; giving it
  // a day is the person's job, and Teleonomy has no opinion about which day.
  backlog: { status: 'todo', waiting_on: null },
  ready: { status: 'todo', waiting_on: null },
  in_progress: { status: 'doing', waiting_on: null },
  // The planner has no `blocked` and no `needs_review`. `waiting_on` is a free
  // text column that already means "this is not moving until something else
  // happens", which is the true part of both — and it is emphatically NOT
  // `done`, because neither of them is.
  blocked: { status: 'doing', waiting_on: 'blocked in Teleonomy' },
  needs_review: { status: 'doing', waiting_on: 'review in Teleonomy' },
  done: { status: 'done', waiting_on: null },
}

/** The planner's statuses → where they mean to land in Teleonomy. */
export const TO_TEL = {
  todo: 'ready',
  doing: 'in_progress',
  done: 'needs_review',
  // `moved` is a planner-local scheduling fact — the task went to another day,
  // which is not a lifecycle event anywhere else. `dropped` is a decision that
  // deserves a person: Teleonomy's equivalent is `archive`, a different verb
  // with different consequences, and doing it silently from a tick box is not
  // a trade worth making.
  moved: null,
  dropped: null,
}

/**
 * The hops Teleonomy will actually accept, mirrored from its `transition` rows.
 *
 * Mirrored rather than discovered because a push has to know which moves exist
 * BEFORE it makes one: finding out from a refusal means having already sent a
 * write that should not have been sent, into a ledger that keeps it.
 *
 * `needs_review → done` is deliberately absent. It exists over there and is
 * `approval_only` — executed by the `approve` verb and refused by `advance`.
 * Ticking a box in a personal planner is not a code review, so the sync climbs
 * to `needs_review` and stops. The planner says so on the row; crossing that
 * last step is done in Teleonomy, by a person, on purpose.
 *
 * `done` has no way out, so once Teleonomy says done, reopening in the planner
 * changes the planner only. That is the same rule stated from the other end.
 */
const HOPS = {
  backlog: ['ready'],
  ready: ['in_progress'],
  in_progress: ['blocked', 'needs_review'],
  blocked: ['in_progress'],
  needs_review: ['in_progress'],
  done: [],
}

/**
 * The shortest legal run of `advance` calls from `from` to `to`, or [] if there
 * is no route that avoids the approval gate.
 *
 * Breadth-first over the table above, so "todo ticked to done" comes back as
 * the three hops it really is and each one lands in the ledger as its own
 * event — which is what happened, in order, even if it was one click here.
 */
export function pathTo(from, to) {
  if (from === to || !HOPS[from] || !HOPS[to]) return []
  const seen = new Set([from])
  const queue = [[from, []]]
  while (queue.length) {
    const [at, route] = queue.shift()
    for (const next of HOPS[at] || []) {
      if (seen.has(next)) continue
      const step = [...route, next]
      if (next === to) return step
      seen.add(next)
      queue.push([next, step])
    }
  }
  return []
}

/** Everything a linked task should look like, given what Teleonomy says. */
export function planFromTel(card) {
  const shape = FROM_TEL[card.status] || { status: 'todo', waiting_on: null }
  return {
    title: card.title,
    status: shape.status,
    waiting_on: shape.waiting_on,
    due_date: card.due_date || null,
    notes: descriptionOf(card),
  }
}

/**
 * Teleonomy keeps a description in the attribute bag rather than a column, and
 * an absent one is absent rather than empty — so this normalises both to a
 * string, which is what the planner's `notes` column is.
 */
export function descriptionOf(card) {
  const d = card?.attrs?.description
  return typeof d === 'string' ? d : ''
}

/**
 * Who wins, for one field, given what each side has and what the sync last saw.
 *
 * The third value is what makes this answerable at all. With only two, "they
 * differ" is all you can say; with the value the sync last wrote, you can tell
 * WHICH side moved — and only when both moved is there a conflict to resolve.
 *
 * Returns 'pull' (take theirs), 'push' (send ours), or 'hold' (nothing to do).
 * A genuine conflict resolves to 'pull', because for anything that came from
 * Teleonomy, Teleonomy is the record — but the caller is told, so the value it
 * is about to overwrite can be kept somewhere a person will find it.
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
