import { Router } from 'express'
import { db, today } from '../db.js'
import { h } from './_helpers.js'
import { withPeople } from './tasks.js'

const r = Router()

const WITH_PROJECT = `
  SELECT t.*, p.name AS project_name, p.color AS project_color
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
`

/**
 * Everything you have started, plus every descendant of it, flat — the client
 * nests it back into a forest. The descendants come along whatever their own
 * status, because the question the panel answers is "what am I in the middle
 * of", and a parent shorn of its subtasks does not answer it.
 *
 * A `doing` task nested inside another `doing` task is reached both by the seed
 * and by the walk, so UNION rather than UNION ALL is what keeps it to one row;
 * and since its parent is in the set too, the client hangs it underneath rather
 * than also standing it up as a root. Nothing appears twice either way.
 *
 * There is deliberately no LIMIT here, unlike the digest blocks below. Those are
 * derived from the whole task table and could be arbitrarily long; `doing` is a
 * state you set by hand, so its size is already a decision the user made — and
 * silently dropping the ninth thing you are in the middle of would be a lie the
 * panel's scrollbar exists precisely to avoid.
 */
function inProgressUnits() {
  const rows = withPeople(db.prepare(`
    WITH RECURSIVE unit(id) AS (
      SELECT id FROM tasks WHERE status = 'doing' AND kind != 'note'
      UNION
      SELECT t.id FROM tasks t JOIN unit ON t.parent_id = unit.id
    )
    SELECT t.*, p.name AS project_name, p.color AS project_color
    FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.id IN (SELECT id FROM unit)
    ORDER BY t.sort, t.id
  `).all())

  // A row is a root of the forest when its parent is absent from the set, which
  // is not the same as having no parent at all: a `doing` task filed under some
  // unrelated todo still leads its own unit here.
  const present = new Set(rows.map((t) => t.id))
  const isRoot = (t) => t.parent_id == null || !present.has(t.parent_id)

  // Roots read oldest-first, which is the staleness signal this block has always
  // carried. Nested rows are left in the day-page order the query already gave
  // them — sorting subtasks by age would make the panel disagree with the day
  // they live on. Array.sort is stable, so returning 0 preserves that.
  return rows.sort((a, b) => {
    const [ra, rb] = [isRoot(a), isRoot(b)]
    if (ra !== rb) return ra ? -1 : 1
    if (!ra) return 0
    return String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id
  })
}

/** N days back from today, oldest first, as YYYY-MM-DD. */
function lastDays(n) {
  const out = []
  const d = new Date(`${today()}T00:00:00`)
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d)
    x.setDate(x.getDate() - i)
    const pad = (v) => String(v).padStart(2, '0')
    out.push(`${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`)
  }
  return out
}

/**
 * Everything the dashboard shows, in one request. Each block answers a question
 * a flat list cannot: what matters today, what keeps sliding, what has been
 * open too long, and whether the thinking budget is actually being spent.
 */
r.get('/', h(() => {
  const now = today()
  const days = lastDays(14)

  const deepByDay = db.prepare(`
    SELECT scheduled_date AS date,
           COALESCE(SUM(CASE WHEN status = 'done' THEN estimate_min END), 0) AS done,
           COALESCE(SUM(estimate_min), 0) AS planned
    FROM tasks
    WHERE kind != 'note' AND intensity = 'deep' AND optional = 0
      AND status NOT IN ('dropped','moved')
      AND scheduled_date BETWEEN ? AND ?
    GROUP BY scheduled_date
  `).all(days[0], days[days.length - 1])

  const byDate = Object.fromEntries(deepByDay.map((d) => [d.date, d]))

  return {
    date: now,

    // The single most important open thing today: highest priority, then the
    // earliest time, then whatever you put first.
    focus: db.prepare(`
      ${WITH_PROJECT}
      WHERE t.scheduled_date = ? AND t.kind = 'task'
        AND t.status IN ('todo','doing') AND t.optional = 0
      ORDER BY
        CASE t.priority WHEN 'highest' THEN 0 WHEN 'high' THEN 1
          WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        t.intensity = 'light',
        t.start_time IS NULL, t.start_time, t.sort, t.id
      LIMIT 1
    `).get(now) || null,

    // Work that was pushed off a day. `moved` is only ever written by an actual
    // move, so this is a real trail rather than an inference.
    slipping: db.prepare(`
      ${WITH_PROJECT}
      WHERE t.status = 'moved' AND t.kind != 'note'
      ORDER BY t.moved_to_date DESC, t.id DESC
      LIMIT 8
    `).all(),

    // Started and not finished, each with its whole unit of work. Without a
    // status-change log the age is measured from creation, which understates a
    // task picked up long after it was made — the client says so rather than
    // implying precision it does not have.
    inProgress: inProgressUnits(),

    overdue: db.prepare(`
      ${WITH_PROJECT}
      WHERE t.due_date IS NOT NULL AND t.due_date < ?
        AND t.status IN ('todo','doing') AND t.kind != 'note'
      ORDER BY t.due_date
      LIMIT 8
    `).all(now),

    deep: days.map((date) => ({
      date,
      done: byDate[date]?.done || 0,
      planned: byDate[date]?.planned || 0,
    })),

    // What you actually touched, newest first — the re-entry question.
    recent: db.prepare(`
      ${WITH_PROJECT}
      WHERE t.kind != 'note'
      ORDER BY COALESCE(t.completed_at, t.created_at) DESC
      LIMIT 8
    `).all(),

    counts: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM tasks WHERE scheduled_date = ? AND kind = 'task'
          AND status IN ('todo','doing') AND optional = 0)             AS today_open,
        (SELECT COUNT(*) FROM tasks WHERE scheduled_date IS NULL
          AND status IN ('todo','doing') AND kind = 'task')            AS backlog,
        (SELECT COUNT(*) FROM projects WHERE status = 'active')        AS projects
    `).get(now),
  }
}))

export default r
