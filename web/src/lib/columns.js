/**
 * The three-box grading, in one place.
 *
 * The day view invented this, but the backlog boards on the project and
 * all-tasks pages now show the same rows in the same three columns, and a
 * backlog that graded "Focused" differently from the day it feeds would make
 * the two views disagree about the same task.
 */
import { branchMinutes, spanMinutes } from '../components/TaskRow.jsx'

/** What each column means in minutes, used when a drag re-times what it moves. */
export const COLUMN_MINUTES = [5, 15, 60]

export const DEFAULT_COLUMN_LABELS = ['Quick', 'Focused', 'Deep']

/** Where a duration falls among the three boxes. 30m is the top of the middle. */
export function columnByMinutes(m) {
  if (!m) return 0
  if (m <= 10) return 0
  if (m <= 30) return 1
  return 2
}

/** A task's own time: an explicit estimate, else the span between its clock times. */
export const ownMinutes = (t) => t.estimate_min || spanMinutes(t.start_time, t.end_time) || 0

/** Is this section a conversation rather than a list of work? */
export const isDialogue = (section) => section?.kind === 'ai'

export const TURN_LABELS = ['Yours', 'Theirs', 'Settled']

/**
 * Which box a task sits in when the section is a dialogue.
 *
 * The three boxes stop meaning how long something takes and start meaning
 * whose move it is. Nothing else changes: the grid, the drag targets and the
 * vim cursor all ask this one function where a task belongs, so swapping what
 * it answers is the whole of the feature.
 *
 * A settled task is one nobody owes a move on — which is not the same as done.
 * A question you have answered is settled; so is a task the AI finished.
 */
export function columnByTurn(task) {
  if (task.status === 'done' || task.status === 'dropped') return 2
  if (task.waiting_on === 'human') return 0
  if (task.waiting_on === 'ai') return 1
  return 2
}

/** What a drop into each box means in a dialogue. */
export const TURN_BY_COLUMN = ['human', 'ai', null]

/**
 * Which of the three boxes a task belongs in. An explicit col_index wins;
 * otherwise it falls out of the duration, so tasks land somewhere sensible
 * without the user placing every one by hand.
 *
 * A parent is sized by its whole subtree, not by its own estimate. A ten-minute
 * task carrying two hours of children is a two-hour commitment, and filing it
 * under "quick" misrepresents the day.
 *
 * In a dialogue the turn decides, and col_index is ignored outright — a stale
 * placement from before the section became a conversation would otherwise pin
 * a task in a column that contradicts whose move it is.
 */
export function columnFor(task, section) {
  if (isDialogue(section)) return columnByTurn(task)
  if (task.col_index != null) return Math.min(2, Math.max(0, task.col_index))
  return columnByMinutes(ownMinutes(task) + branchMinutes(task.subtasks || []))
}

/** The user's names for the three boxes, falling back to the defaults. */
export function columnLabels(settings, section) {
  if (isDialogue(section)) return TURN_LABELS
  return userColumnLabels(settings)
}

function userColumnLabels(settings) {
  try {
    const parsed = JSON.parse(settings?.column_labels || '[]')
    return parsed.length === 3 ? parsed : DEFAULT_COLUMN_LABELS
  } catch { return DEFAULT_COLUMN_LABELS }
}

/** Deal a list of tasks into the three columns, preserving order within each. */
export function dealIntoColumns(tasks = [], section) {
  const cols = [[], [], []]
  for (const t of tasks) cols[columnFor(t, section)].push(t)
  return cols
}
