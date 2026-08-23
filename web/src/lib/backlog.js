/**
 * What "the backlog" means, in one place.
 *
 * On the server `?backlog=1` only adds `scheduled_date IS NULL`, so the other
 * half of the definition — which statuses still count as open — has to travel
 * with every caller. Keeping both halves here is what stops the day's aside, a
 * project's own panel and the projects digest from quoting different numbers
 * for the same rows; a backlog that disagrees with itself is worse than no
 * backlog at all.
 *
 * `project_id` composes with this on the server, so a single project's backlog
 * is this query with `&project_id=N` appended.
 */
// 'maybe' used to be listed here and did nothing: it was retired when meetings
// landed, and the live table's CHECK constraint rejects it outright, so no row
// can ever carry it. It is dropped rather than left as decoration, because a
// dead term in a filter reads like a deliberate inclusion.
export const BACKLOG_QUERY = 'backlog=1&status=todo'

/**
 * A project's note sections are unscheduled `kind='note'` rows, so the query
 * above picks them up too. They are prose filed against the project, not work
 * waiting for a day, and counting them would inflate every backlog that has a
 * notebook.
 */
export const isBacklogTask = (t) => t.kind !== 'note'
