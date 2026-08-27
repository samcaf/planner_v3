import { api } from './api.js'

/**
 * The handlers a page lends the keyboard, built once.
 *
 * The day grew these and is where they are tested; the project pages and the
 * all-tasks list want the same ones over their own lists. Everything here works
 * from a flat array of tasks and a way to reload, which is what every one of
 * those pages already has — so a page supplies what only it knows (its list,
 * its refresh, how it patches) and gets the rest.
 *
 * `date` is the day a new or moved task belongs to. A page with no single day —
 * all-tasks, a project — passes null, and a task added there simply has no
 * date, which is what the backlog is.
 */
export function makeVimActions({
  tasks = [],
  sections = [],
  date = null,
  undo,
  refresh,
  patch,
  remove,
  reschedule,
  onAdded,
}) {
  const byId = (id) => tasks.find((t) => t.id === id)

  /** Everything under a task, however deep — what a sub-section amounts to. */
  const branch = (id) => {
    const out = []
    const walk = (parentId) => {
      for (const t of tasks.filter((x) => x.parent_id === parentId)) { out.push(t); walk(t.id) }
    }
    const head = byId(id)
    if (head) { out.push(head); walk(id) }
    return out
  }

  /** The rows a task shares its position with, in the order they are drawn. */
  const siblingsOf = (me) => tasks
    .filter((t) => (t.parent_id ?? null) === (me.parent_id ?? null)
      && (t.section_id ?? null) === (me.section_id ?? null)
      && t.kind !== 'note')
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map((t) => t.id)

  return {
    date,
    undo,
    taskById: byId,
    branch,
    patch,
    remove,
    reschedule,

    /** Which band a task sits in, for a markdown yank that keeps its shape. */
    sectionName: (t) => sections.find((s) => s.id === (t.section_id ?? null))?.name
      || t.project_name
      || null,

    /** Move the task itself among its siblings — what Alt-j and Alt-k do. */
    shift: async (id, by) => {
      const me = byId(id)
      if (!me) return
      const order = siblingsOf(me)
      const at = order.indexOf(id)
      const to = at + by
      if (at < 0 || to < 0 || to >= order.length) return

      const wasOrder = [...order]
      order.splice(to, 0, ...order.splice(at, 1))
      const apply = async () => { await api.post('/tasks/reorder', { ids: order }) }
      await apply()
      undo?.record?.({
        label: 'move task',
        undo: async () => { await api.post('/tasks/reorder', { ids: wasOrder }) },
        redo: apply,
      })
      refresh?.()
    },

    /** A new row beside another, carrying whatever a yank put in the register. */
    addNear: async (nearId, row, side) => {
      const near = byId(nearId)
      const created = await api.post('/tasks', {
        title: row.title || 'New task',
        // A page with no day of its own makes a dateless task, which is the
        // backlog — not a task quietly filed on today.
        ...(date ? { scheduled_date: date } : {}),
        section_id: near?.section_id ?? null,
        project_id: near?.project_id ?? null,
        estimate_min: row.estimate_min ?? null,
        priority: row.priority || 'medium',
      })
      if (near?.parent_id) await api.post(`/tasks/${created.id}/nest`, { parent_id: near.parent_id })

      // Placed against the row it was added from rather than at the end, which
      // is what "below the cursor" has to mean.
      if (near) {
        const order = siblingsOf(near).filter((id) => id !== created.id)
        const at = order.indexOf(nearId)
        order.splice(side === 'above' ? at : at + 1, 0, created.id)
        await api.post('/tasks/reorder', { ids: order })
      }
      onAdded?.(created.id)
      refresh?.()
      return created
    },
  }
}
