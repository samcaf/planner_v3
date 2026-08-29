import { Router } from 'express'
import { db, ensureDay, today } from '../db.js'
import { h } from './_helpers.js'
import { withPeople } from './tasks.js'

const r = Router()

/** `today` is accepted wherever a date is, so reads and writes agree. */
const resolve = (value) => (value === 'today' ? today() : value)

/** Everything the day view needs, in one request. */
r.get('/:date', h((req) => {
  const date = resolve(req.params.date)
  const day = ensureDay(date)
  const weekday = new Date(`${date}T00:00:00`).getDay()

  return {
    ...day,
    date,
    weekday,
    // Attendees ride along: meetings are ordinary rows in this list, and the
    // schedule panel would otherwise render every one as unattended.
    tasks: db.prepare(`
      SELECT t.*, p.name AS project_name, p.color AS project_color,
             (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comment_count,
             g.name AS group_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN groups g   ON g.id = t.group_id
      WHERE t.scheduled_date = ?
      ORDER BY t.sort, t.id
    `).all(date).map(withPeople),
    // Deadlines that land on this day, surfaced even without a scheduled task.
    due: db.prepare(`
      SELECT m.*, p.name AS project_name, p.color AS project_color
      FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.due_date = ? AND m.done = 0
    `).all(date),
    sections: db.prepare(`
      SELECT s.*, p.name AS project_name, p.color AS project_color
      FROM sections s LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.date = ? ORDER BY s.sort, s.id
    `).all(date),
    // String(weekday) matters: better-sqlite3 binds a JS number as REAL, so
    // the concatenation would render '4.0' and match nothing.
    routines: db.prepare(`
      SELECT * FROM routines
      WHERE active = 1
        AND (weekdays = '' OR ',' || weekdays || ',' LIKE '%,' || ? || ',%')
      ORDER BY sort, id
    `).all(String(weekday)),
  }
}))

r.patch('/:date', h((req) => {
  const date = resolve(req.params.date)
  ensureDay(date)
  const fields = ['title', 'notes', 'reflection'].filter((f) => req.body[f] !== undefined)
  if (fields.length) {
    db.prepare(`UPDATE days SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE date = ?`)
      .run(...fields.map((f) => req.body[f]), date)
  }
  return db.prepare('SELECT * FROM days WHERE date = ?').get(date)
}))

/**
 * Aggregate counts for a date range, so the week and month grids can render
 * without fetching every task individually.
 */
r.get('/range/:from/:to', h((req) => {
  const { from, to } = req.params
  return {
    // Calendar ordering, unlike the day view's manual order: unfinished first,
    // then by priority, so a crowded cell shows what still matters.
    tasks: db.prepare(`
      SELECT t.*, p.name AS project_name, p.color AS project_color
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.scheduled_date BETWEEN ? AND ?
      ORDER BY
        t.scheduled_date,
        CASE WHEN t.status IN ('done','dropped','moved') THEN 1 ELSE 0 END,
        CASE t.priority
          WHEN 'highest' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
          WHEN 'low' THEN 3 ELSE 4 END,
        t.start_time IS NULL, t.start_time,
        t.sort, t.id
    `).all(from, to),
    // Week groups tasks by section, so shipping them here saves one request per
    // visible day.
    sections: db.prepare(`
      SELECT s.*, p.name AS project_name, p.color AS project_color
      FROM sections s LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.date BETWEEN ? AND ?
      ORDER BY s.date, s.sort, s.id
    `).all(from, to),
    milestones: db.prepare(`
      SELECT m.*, p.name AS project_name, p.color AS project_color
      FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.due_date BETWEEN ? AND ?
      ORDER BY m.due_date
    `).all(from, to),
    days: db.prepare('SELECT * FROM days WHERE date BETWEEN ? AND ?').all(from, to),
  }
}))

export default r
