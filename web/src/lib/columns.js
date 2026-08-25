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

/**
 * Which of the three boxes a task belongs in. An explicit col_index wins;
 * otherwise it falls out of the duration, so tasks land somewhere sensible
 * without the user placing every one by hand.
 *
 * A parent is sized by its whole subtree, not by its own estimate. A ten-minute
 * task carrying two hours of children is a two-hour commitment, and filing it
 * under "quick" misrepresents the day.
 */
export function columnFor(task) {
  if (task.col_index != null) return Math.min(2, Math.max(0, task.col_index))
  return columnByMinutes(ownMinutes(task) + branchMinutes(task.subtasks || []))
}

/** The user's names for the three boxes, falling back to the defaults. */
export function columnLabels(settings) {
  try {
    const parsed = JSON.parse(settings?.column_labels || '[]')
    return parsed.length === 3 ? parsed : DEFAULT_COLUMN_LABELS
  } catch { return DEFAULT_COLUMN_LABELS }
}

/** Deal a list of tasks into the three columns, preserving order within each. */
export function dealIntoColumns(tasks = []) {
  const cols = [[], [], []]
  for (const t of tasks) cols[columnFor(t)].push(t)
  return cols
}
