/**
 * Teleonomy, as one adapter.
 *
 * Everything in this file is true of Teleonomy and of nothing else. The
 * lifecycle below is a mirror of rows in its database — `mode`, `state` and
 * `transition`, seeded in its 0010 migration — and nothing on this side can
 * detect that those rows have changed. See CLAUDE.md.
 *
 * The one rule worth reading before the code: this never calls `approve`.
 */
import { call, connect as http } from './http.js'

/** Their `do` lifecycle → what the planner should show. */
const TO_PLANNER = {
  // The planner's backlog is exactly an unscheduled task, which is the same
  // idea arrived at independently. An import leaves it unscheduled; choosing a
  // day is the person's job, and Teleonomy has no opinion about which.
  backlog: { status: 'todo', waiting_on: null },
  ready: { status: 'todo', waiting_on: null },
  in_progress: { status: 'doing', waiting_on: null },
  // The planner has no `blocked` and no `needs_review`. `waiting_on` is free
  // text already meaning "not moving until something else happens", which is
  // the true part of both — and emphatically not `done`, because neither is.
  blocked: { status: 'doing', waiting_on: 'blocked in Teleonomy' },
  needs_review: { status: 'doing', waiting_on: 'review in Teleonomy' },
  done: { status: 'done', waiting_on: null },
}

/** Ours → where they mean to land over there. */
const FROM_PLANNER = {
  todo: 'ready',
  doing: 'in_progress',
  done: 'needs_review',
  // `moved` is a planner-local scheduling fact — the task went to another day,
  // which is not a lifecycle event anywhere else. `dropped` is a decision that
  // deserves a person: their equivalent is `archive`, a different verb with
  // different consequences, and doing that silently from a tick box is not a
  // trade worth making.
  moved: null,
  dropped: null,
}

/**
 * The hops `advance` will accept, mirrored from their `transition` rows.
 *
 * Mirrored rather than discovered because a push has to know which moves exist
 * BEFORE making one: learning it from a refusal means having already sent a
 * write that should not have been sent, into a ledger that keeps it.
 *
 * `needs_review → done` is deliberately absent. It exists over there and is
 * `approval_only` — executed by `approve`, refused by `advance`. Ticking a box
 * in a personal planner is not a code review, so this climbs to `needs_review`
 * and stops; the planner says so on the row, and crossing that step is done in
 * Teleonomy, by a person, on purpose.
 *
 * `done` has no way out, so once they say done, reopening here changes only
 * here. That is the same rule stated from the other end.
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
 * The shortest legal run of `advance` calls, or [] where no route avoids the
 * approval gate. Breadth-first, so "todo ticked to done" comes back as the
 * three hops it really is — and each lands in the ledger as its own event,
 * which is what happened, in order, even if it was one click here.
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

/** Their description lives in the attribute bag, and absent is not empty. */
const notesOf = (card) => (typeof card?.attrs?.description === 'string' ? card.attrs.description : '')

const item = (card, depth = 0) => ({
  id: card.id,
  key: card.human_code,
  title: card.title,
  status: card.status,
  notes: notesOf(card),
  due_date: card.due_date || null,
  depth,
})

export default {
  name: 'teleonomy',
  label: 'Teleonomy',

  fields: [
    {
      key: 'url',
      label: 'Server',
      placeholder: 'https://tel-server.porgy-emperor.ts.net',
      hint: 'Where Teleonomy answers. The planner talks to it; your browser never does.',
    },
    {
      key: 'token',
      label: 'Agent token',
      secret: true,
      hint: 'Minted with POST /auth/agent_token, which only an admin there can call. '
        + 'Every write the sync makes is recorded against this token’s actor.',
    },
  ],

  connect: (values) => http(values.url, values.token),

  whoami: async (conn) => {
    const me = await call(conn, '/api/whoami', null)
    return { id: me?.actor?.id ?? me?.user?.id ?? null, label: me?.actor?.label ?? me?.user?.label ?? null }
  },

  /**
   * `read/root` answers with ONE card — the workspace, the single parentless
   * direction — which is the top of the graph and not a list of projects. So
   * ask for it, then for its children, and offer the root first so "everything"
   * is pickable too. Everything under it, not just what looks like a project: a
   * work item with children is a fine place to import a branch from, and
   * guessing which of somebody else's directions counts as a project is the
   * kind of rule that is wrong for half of them.
   */
  containers: async (conn) => {
    const root = await call(conn, '/api/read/root', {}).catch(() => null)
    if (!root) return []
    const out = await call(conn, '/api/read/project', {
      filters: [{ under_parent: root.id }], shape: 'tree', sort: 'status_order', limit: 200,
    })
    return [root, ...(out?.roots || []).map((n) => n.card)]
      .map((c) => ({ id: c.id, key: c.human_code, title: c.title }))
  },

  /** `under_subtree`, because a task two levels down is still that project's. */
  items: async (conn, parent) => {
    const out = await call(conn, '/api/read/project', {
      filters: [{ under_subtree: parent }, { mode: 'do' }],
      shape: 'tree', sort: 'status_order', limit: 200,
    })
    const flat = []
    const walk = (nodes, depth) => {
      for (const n of nodes || []) { flat.push(item(n.card, depth)); walk(n.children, depth + 1) }
    }
    walk(out?.roots, 0)
    return flat
  },

  read: async (conn, id) => {
    const got = await call(conn, `/api/d/${encodeURIComponent(id)}`, null)
    return item(got?.card ?? got)
  },

  statusToPlanner: (status) => TO_PLANNER[status] || { status: 'todo', waiting_on: null },

  pushStatus: async (conn, it, plannerStatus) => {
    const target = FROM_PLANNER[plannerStatus]
    if (!target) {
      return [{ how: 'skip', why: `"${plannerStatus}" has no Teleonomy equivalent` }]
    }
    if (it.status === target) return []

    const route = pathTo(it.status, target)
    if (!route.length) {
      return [{
        how: 'blocked',
        why: `no route from "${it.status}" to "${target}" that avoids the approval gate`,
      }]
    }

    const acted = []
    for (const hop of route) {
      await call(conn, '/api/verbs/advance', { direction: it.id, to_status: hop })
      acted.push({ how: 'push', to: hop })
    }
    // Ticking done here reaches needs_review there, and stops.
    if (plannerStatus === 'done' && route.at(-1) === 'needs_review') {
      acted.push({ how: 'gated', at: 'needs_review', waiting_on: 'review in Teleonomy' })
    }
    return acted
  },

  /** `refine` merges the attribute bag; null removes a key. */
  pushNotes: (conn, it, text) => call(conn, '/api/verbs/refine', {
    direction: it.id,
    fields: { attrs: { description: text === '' ? null : text } },
  }),
}
