import { Router } from 'express'
import { db, today } from '../db.js'
import { h } from './_helpers.js'

const r = Router()

const WITH_PROJECT = `
  SELECT t.*, p.name AS project_name, p.color AS project_color
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
`

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

    // Started and not finished. Without a status-change log the age is measured
    // from creation, which understates a task picked up long after it was made —
    // the client says so rather than implying precision it does not have.
    stuck: db.prepare(`
      ${WITH_PROJECT}
      WHERE t.status = 'doing' AND t.kind != 'note'
      ORDER BY t.created_at
      LIMIT 8
    `).all(),

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
