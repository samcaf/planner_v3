import { api } from './api.js'
import { columnFor, ownMinutes, COLUMN_MINUTES } from './columns.js'

/**
 * Dragging tasks about, in one place.
 *
 * The day view grew this and is where it is tested, but the same three columns
 * now appear in a project's backlog and in the all-tasks backlog — and those
 * had no row-to-row drop at all, so a task could not be nested or reordered
 * there, only dropped into a column. Rather than each view growing its own
 * half of the behaviour, they all call this.
 *
 * Three things differ between a day and a backlog board, and they are the
 * options rather than separate implementations:
 *
 *   date      the day rows belong to, or null on a board of dateless work
 *   sections  the day's bands; empty on a board, which has none
 *   columns   whether this view lays work out in three boxes at all
 *
 * `known` is every row the view can see, including ones outside `tasks` — the
 * day's aside can drag a backlog row onto the grid, and looking it up is how
 * the drop knows whether it already carries a duration.
 */
export function makeTaskDnd({
  tasks, sections = [], date = null, known = tasks, columns = null, undo, refresh,
}) {
  /**
   * Everything a move can disturb, captured so it can be put back. A drag
   * rewrites `sort` across a whole sibling group and may change the parent,
   * section and column of the row that moved — none of which a PATCH-based
   * snapshot would cover, which is why moves used to be absent from undo.
   */
  const snapshot = (ids) => ids
    .map((id) => known.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => ({
      id: t.id,
      sort: t.sort,
      parent_id: t.parent_id ?? null,
      section_id: t.section_id ?? null,
      col_index: t.col_index ?? null,
      scheduled_date: t.scheduled_date ?? null,
    }))

  const restoreAll = (rows) => async () => {
    for (const r of rows) {
      // parent_id is rejected by PATCH — re-parenting is /nest's job, because
      // that is the only path that checks for cycles.
      await api.post(`/tasks/${r.id}/nest`, { parent_id: r.parent_id })
      await api.patch(`/tasks/${r.id}`, {
        sort: r.sort,
        section_id: r.section_id,
        col_index: r.col_index,
        scheduled_date: r.scheduled_date,
      })
    }
  }

  /**
   * One gesture, two outcomes: a drop across the middle of a row nests, a drop
   * near either edge reorders within that row's own sibling group.
   */
  async function onDropTask(draggedId, target, zone) {
    if (!draggedId || draggedId === target?.id) return

    if (zone === 'nest') {
      const before = snapshot([draggedId])
      const nest = async () => { await api.post(`/tasks/${draggedId}/nest`, { parent_id: target.id }) }
      await nest()
      undo?.record?.({ label: 'nest', undo: restoreAll(before), redo: nest })
      refresh()
      return
    }

    const siblings = tasks
      .filter((t) => (t.parent_id ?? null) === (target.parent_id ?? null)
        && (t.section_id ?? null) === (target.section_id ?? null))
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((t) => t.id)
      .filter((id) => id !== draggedId)

    const at = siblings.indexOf(target.id)
    if (at < 0) return
    siblings.splice(zone === 'before' ? at : at + 1, 0, draggedId)

    // Land in the target's column too, when the view has columns at all.
    // Dropping onto a row is the *only* way into a column that is full to the
    // bottom — there is no empty space left below the last row to hit the
    // column's own drop zone — so without this the commonest drop in a busy
    // day silently put the task back where it came from.
    const section = sections.find((s) => s.id === target.section_id)
    const intoColumns = columns ?? section?.layout === 'columns'

    // A task that already says how long it is sorts itself: clearing the pin
    // lets it grade into the column its own duration implies, rather than being
    // filed under whichever row it happened to land next to.
    const dragged = known.find((t) => t.id === draggedId)
    const selfTiming = intoColumns && !!(dragged && ownMinutes(dragged))

    const before = snapshot([draggedId, ...siblings])
    const move = async () => {
      await api.post('/tasks/reorder', {
        ids: siblings,
        // Omitted rather than sent as null: /tasks/reorder only writes these
        // when it is given them, so a board of dateless work reorders without
        // its rows quietly acquiring a date or a section.
        ...(date ? { scheduled_date: date } : {}),
        ...(sections.length ? { section_id: target.section_id ?? null } : {}),
        parent_id: target.parent_id ?? null,
        // Named, so the server applies the column to this one row rather than
        // to every sibling in the list.
        ...(intoColumns
          ? { col_index: selfTiming ? null : columnFor(target), moved_id: draggedId }
          : {}),
      })
    }
    await move()
    undo?.record?.({ label: 'move', undo: restoreAll(before), redo: move })
    refresh()
  }

  /** A drop into one of the three boxes, rather than onto a row. */
  async function onMoveToColumn(ids, col, { retime = false, parent, sectionId } = {}) {
    if (!ids.length) return
    const before = snapshot(ids)
    const apply = async () => {
      for (const id of ids) {
        if (parent !== undefined) await api.post(`/tasks/${id}/nest`, { parent_id: parent })
        await api.patch(`/tasks/${id}`, {
          col_index: col,
          ...(sectionId !== undefined ? { section_id: sectionId } : {}),
          ...(date ? { scheduled_date: date } : {}),
          // Only when the drag was held there: re-timing overwrites an estimate
          // that was thought about, so a passing drag must not do it.
          ...(retime ? { estimate_min: COLUMN_MINUTES[col] } : {}),
        })
      }
    }
    await apply()
    undo?.record?.({ label: 'move between columns', undo: restoreAll(before), redo: apply })
    refresh()
  }

  return { onDropTask, onMoveToColumn, snapshot, restoreAll }
}
