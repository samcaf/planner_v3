import { Router } from 'express'
import { db } from '../db.js'
import { badRequest, h, nextSort, notFound } from './_helpers.js'
import * as tel from '../tel/client.js'
import { descriptionOf, planFromTel } from '../tel/map.js'
import { linkedOne, reconcile, reconcileAll } from '../tel/sync.js'

/**
 * The planner's end of the Teleonomy link.
 *
 * Reads are proxied rather than made from the page: the bearer token stays on
 * this side, and the browser asks the planner for everything. The picker is
 * therefore an ordinary planner API consumer and knows nothing about
 * Teleonomy's shapes beyond what these routes hand it.
 *
 * Nothing here mirrors. `POST /link` is the only way a task acquires a
 * `tel_uuid`, and a task without one is invisible to every other route in this
 * file — so what syncs is exactly what somebody chose, and un-choosing it is
 * one call away.
 */
const r = Router()

/** Is this planner pointed at a Teleonomy at all, and does the token work? */
r.get('/status', h(async () => {
  const { base, on } = tel.connection()
  if (!base) return { configured: false, on: false }
  try {
    const me = await tel.whoami()
    return { configured: true, on, ok: true, actor: me?.actor ?? me?.user ?? me ?? null }
  } catch (e) {
    return { configured: true, on, ok: false, error: e.message }
  }
}))

/** The containers a pick can start from. */
r.get('/projects', h(async () => ({ roots: await tel.pickable() })))

/**
 * The work items under one direction, flattened with their depth.
 *
 * Flattened here rather than in the page: the tree is Teleonomy's shape, a list
 * of checkboxes is the picker's, and the conversion is the same every time.
 * `linked` says which are already in this planner, so the picker can show them
 * as taken rather than offering a second copy.
 */
r.get('/items', h(async (req) => {
  const parent = String(req.query.parent || '')
  if (!parent) throw badRequest('parent is required')

  const out = await tel.workUnder(parent, req.query.cursor || null)
  const already = new Map(
    db.prepare('SELECT tel_uuid, id FROM tasks WHERE tel_uuid IS NOT NULL').all()
      .map((t) => [t.tel_uuid, t.id]),
  )

  const items = []
  const walk = (nodes, depth) => {
    for (const n of nodes || []) {
      items.push({
        id: n.card.id,
        code: n.card.human_code,
        title: n.card.title,
        status: n.card.status,
        due_date: n.card.due_date,
        notes: descriptionOf(n.card),
        depth,
        linked_task_id: already.get(n.card.id) ?? null,
      })
      walk(n.children, depth + 1)
    }
  }
  walk(out?.roots, 0)
  return { items, cursor: out?.next_cursor ?? null }
}))

/**
 * Take these into the planner.
 *
 * They land in the backlog — unscheduled — because Teleonomy has no opinion
 * about which day you will do a thing on and the planner should not invent one.
 * Choosing the day is the next thing a person does, with the list in front of
 * them.
 *
 * The project is created on demand from the Teleonomy container, and matched by
 * `tel_uuid` rather than by name so that renaming either side does not fork it
 * into two.
 */
r.post('/link', h(async (req) => {
  const ids = Array.isArray(req.body?.items) ? req.body.items : []
  if (!ids.length) throw badRequest('items is required')

  const parent = req.body.parent || null
  let projectId = null
  if (parent) {
    const existing = db.prepare('SELECT id FROM projects WHERE tel_uuid = ?').get(parent)
    if (existing) projectId = existing.id
    else {
      const got = await tel.card(parent)
      const card = got?.card ?? got
      // `projects.name` is UNIQUE, so a project already carrying this name is
      // adopted rather than fought with — the alternative is a constraint error
      // in the middle of an import that has already created half its tasks.
      const byName = db.prepare('SELECT id FROM projects WHERE name = ?').get(card.title)
      projectId = byName
        ? byName.id
        : db.prepare('INSERT INTO projects (name, sort) VALUES (?, ?)')
          .run(card.title, nextSort('projects')).lastInsertRowid
      db.prepare('UPDATE projects SET tel_uuid = ? WHERE id = ?').run(parent, projectId)
    }
  }

  const made = []
  for (const id of ids) {
    const seen = db.prepare('SELECT id FROM tasks WHERE tel_uuid = ?').get(id)
    if (seen) { made.push({ id: seen.id, already: true }); continue }

    const got = await tel.card(id)
    const card = got?.card ?? got
    const plan = planFromTel(card)
    const info = db.prepare(
      `INSERT INTO tasks (title, notes, status, waiting_on, due_date, project_id, sort,
                          origin, tel_uuid, tel_code, tel_status, tel_notes, tel_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'teleonomy', ?, ?, ?, ?, datetime('now'))`,
    ).run(
      plan.title, plan.notes, plan.status, plan.waiting_on, plan.due_date,
      projectId, nextSort('tasks'), card.id, card.human_code, card.status, plan.notes,
    )
    made.push({ id: Number(info.lastInsertRowid), code: card.human_code })
  }
  return { linked: made, project_id: projectId }
}))

/** Stop syncing this task. It stays exactly as it is; it just stops listening. */
r.post('/unlink/:id', h((req) => {
  const task = linkedOne(Number(req.params.id))
  if (!task) throw notFound('no such task')
  db.prepare(
    `UPDATE tasks SET tel_uuid = NULL, tel_code = NULL, tel_status = NULL,
                      tel_notes = NULL, tel_seen_at = NULL WHERE id = ?`,
  ).run(task.id)
  return { unlinked: task.id, was: task.tel_code }
}))

/** What is currently linked, for the Settings page. */
r.get('/links', h(() => ({
  links: db.prepare(
    // tel_uuid is here for the daemon: a live ping names directions, and this
    // is what turns one of those into the task it belongs to.
    `SELECT id, title, status, tel_uuid, tel_code, tel_status, tel_seen_at
       FROM tasks WHERE tel_uuid IS NOT NULL ORDER BY tel_code`,
  ).all(),
})))

/** One task, brought back into step now. The daemon calls the same code. */
r.post('/reconcile/:id', h(async (req) => {
  const task = linkedOne(Number(req.params.id))
  if (!task?.tel_uuid) throw notFound('that task is not linked')
  const got = await tel.card(task.tel_uuid)
  return reconcile(task, got?.card ?? got)
}))

/** Everything linked, one pass. The manual "sync now". */
r.post('/reconcile', h(async () => ({ ran: await reconcileAll() })))

export default r
