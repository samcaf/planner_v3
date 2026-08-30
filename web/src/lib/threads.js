/**
 * Which rows belong to the same exchange.
 *
 * A conversation board separates a brief from its answer by design: the brief
 * waits on the AI and sits in Theirs, and the follow-ups it produces wait on
 * you and sit in Yours. That is the right arrangement for deciding what to do
 * next, and the wrong one for seeing what came from what — the two halves of
 * one exchange end up as far apart as the board can put them.
 *
 * So an exchange is given an identity of its own. Every row that descends from
 * a brief — its answer, the follow-ups under that answer, the steps the agent
 * raised on the way — resolves to the same root, and the board can tint them
 * alike and light them together.
 *
 * The links followed are `answers_id` first and `parent_id` second. An answer
 * points at the brief it answers; a follow-up is a child of that answer. Both
 * lead to the same place.
 */

/** How many distinct tints an exchange can take before they start repeating. */
export const THREAD_TINTS = 6

/**
 * Root of the exchange each task belongs to, plus what to say about it.
 *
 * Returns a Map from task id to `{ key, tint, size, answers, replies }`:
 *   key      the root task's id — the same for every row in the exchange
 *   tint     0…5, stable for the day, for a rule down the side of the row
 *   size     how many rows are in the exchange, so a lone task can be left plain
 *   answers  the task this one is a reply to, when it is one
 *   replies  how many rows point back at this one, directly
 */
export function threadMap(tasks = []) {
  const byId = new Map(tasks.map((t) => [t.id, t]))

  const rootOf = (task) => {
    const seen = new Set()
    let cur = task
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      const up = (cur.answers_id != null && byId.get(cur.answers_id))
        || (cur.parent_id != null && byId.get(cur.parent_id))
      // A parent outside this list — nested under something in another section —
      // ends the walk here rather than losing the row entirely.
      if (!up) return cur.id
      cur = up
    }
    return cur?.id ?? task.id
  }

  const roots = new Map()
  const size = new Map()
  const replies = new Map()

  for (const t of tasks) {
    const root = rootOf(t)
    roots.set(t.id, root)
    size.set(root, (size.get(root) || 0) + 1)
    if (t.answers_id != null) replies.set(t.answers_id, (replies.get(t.answers_id) || 0) + 1)
  }

  // Tints are handed out in the order exchanges first appear, so they are
  // stable for a given day and do not shuffle when a row is added.
  const tints = new Map()
  for (const t of tasks) {
    const root = roots.get(t.id)
    if (!tints.has(root)) tints.set(root, tints.size % THREAD_TINTS)
  }

  const out = new Map()
  for (const t of tasks) {
    const root = roots.get(t.id)
    out.set(t.id, {
      key: root,
      tint: tints.get(root),
      size: size.get(root) || 1,
      answers: t.answers_id != null ? byId.get(t.answers_id) || null : null,
      replies: replies.get(t.id) || 0,
    })
  }
  return out
}

/**
 * Draw attention to a row that is somewhere else on the board.
 *
 * Scroll to it and mark it briefly. Following a link between two columns
 * otherwise leaves you at the far end with no idea which of a dozen cards you
 * were sent to.
 */
export function flashTask(id) {
  const el = document.querySelector(`.task[data-task-id="${id}"]`)
  if (!el) return false
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.remove('is-flashed')
  // Reading offsetWidth restarts the animation; without it a second click on
  // the same link does nothing at all.
  void el.offsetWidth
  el.classList.add('is-flashed')
  setTimeout(() => el.classList.remove('is-flashed'), 1400)
  return true
}
