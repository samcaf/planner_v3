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
  /**
   * Rows the page can SEE but that are not part of its list.
   *
   * The day's side column draws the backlog and whatever is in progress, and
   * the cursor can now stand on those. They must be findable — a key that
   * reads a row's current priority before stepping it needs the row — but they
   * must not join `tasks`, because that list is what decides who a task's
   * siblings are and what a branch contains. A backlog row has no day and no
   * section, so folding it in would make it a sibling of every loose task on
   * the day and quietly reorder them.
   */
  others = [],
  sections = [],
  date = null,
  undo,
  refresh,
  patch,
  remove,
  reschedule,
  onAdded,
  /** Only a day has sections to reorder, so only a day passes this. */
  shiftSection,
}) {
  const byId = (id) => tasks.find((t) => t.id === id) || others.find((t) => t.id === id)

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
    shiftSection,

    /** Which band a task sits in, for a markdown yank that keeps its shape. */
    sectionName: (t) => sections.find((s) => s.id === (t.section_id ?? null))?.name
      || t.project_name
      || null,

    /**
     * Off the calendar and into the backlog.
     *
     * Through /backlog rather than a date patch: the row leaves carrying copies
     * of the parents it hung from, and only the server can build that path.
     */
    backlog: async (id) => {
      const before = byId(id)
      await api.post(`/tasks/${id}/backlog`, {})
      undo?.record?.({
        label: 'send to backlog',
        undo: async () => {
          await api.patch(`/tasks/${id}`, {
            scheduled_date: before?.scheduled_date ?? null,
            section_id: before?.section_id ?? null,
          })
        },
        redo: async () => { await api.post(`/tasks/${id}/backlog`, {}) },
      })
      refresh?.()
    },

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
        // Everything a copy should carry. Without the note a pasted task is
        // the heading of the thing rather than the thing.
        notes: row.notes || '',
        ...(row.intensity ? { intensity: row.intensity } : {}),
        ...(row.optional ? { optional: row.optional } : {}),
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
