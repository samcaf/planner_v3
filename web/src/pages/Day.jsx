import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import TaskRow, { nestTasks, visibleIds } from '../components/TaskRow.jsx'
import QuickMeeting from '../components/QuickMeeting.jsx'
import {
  SelectAllBox, SelectionBar, SelectionProvider, bulkPatch, draggedIds,
  isSectionDrag, isTaskDrag, parentsFirst,
} from '../components/Selection.jsx'
import { Empty, Panel, ProjectSelect, cls } from '../components/ui.jsx'
import Progress, { tally } from '../components/Progress.jsx'
import DeepBar from '../components/DeepBar.jsx'
import { PRIORITIES, PriorityChip, PriorityIcon } from '../components/Priority.jsx'
import { useToast } from '../components/Toast.jsx'
import { Rich, RichEditor, plainTitle } from '../lib/rich.jsx'
import { taskOps, useUndo } from '../lib/undo.jsx'
import { api, useApi } from '../lib/api.js'
import { BACKLOG_QUERY, isBacklogTask } from '../lib/backlog.js'
import { makeTaskDnd } from '../lib/taskDnd.js'
import { tabDate, usePageTitle } from '../lib/title.js'
import { useVimActions } from '../lib/vim.jsx'
import { useArrowNav } from '../lib/keys.js'
import { addDays, longDate, minutesLabel, shortDate, today } from '../lib/dates.js'
import {
  COLUMN_MINUTES, columnFor, columnLabels as labelsFor, ownMinutes,
} from '../lib/columns.js'

const UNSECTIONED = 'loose'

/**
 * What a column means as a duration. Dropping a task into a column and holding
 * it there re-times it to this, which is the middle of what that column stands
 * for rather than its boundary — a task dragged into "quick" is a five-minute
 * job, not a ten-minute one.
 */

/** How long a task must be held over a column before its time is rewritten. */
const RETIME_DWELL = 900

/** Wide enough for the backlog to read, narrow enough to leave the day room. */
const clampAside = (px) => Math.min(560, Math.max(240, Math.round(px)))

/** Rank for sorting; anything unrecognised sits with medium. */
const PRI_RANK = { highest: 0, high: 1, medium: 2, low: 3, lowest: 4 }
const byPriority = (a, b) =>
  (PRI_RANK[a.priority] ?? 2) - (PRI_RANK[b.priority] ?? 2) || a.sort - b.sort || a.id - b.id


/**
 * `/day/0` is today, `/day/+1` tomorrow, `/day/-3` three days back.
 *
 * Bookmarking a real date pins it to that date forever, which is no use for
 * "the day before yesterday" — a link you want to mean the same thing relative
 * to whenever you follow it. The relative form resolves and then replaces
 * itself with the concrete date, so the URL you end up on is still shareable
 * and the back button does not bounce through the redirect.
 */
const RELATIVE = /^[+-]?\d+$/

export default function Day() {
  const { date } = useParams()
  if (RELATIVE.test(date || '')) {
    return <Navigate to={`/day/${addDays(today(), Number(date))}`} replace />
  }
  return <DayView key={date} date={date} />
}

function DayView({ date }) {
  usePageTitle(tabDate(date))
  const navigate = useNavigate()
  const day = useApi(`/days/${date}`, [date])
  const backlog = useApi(`/tasks?${BACKLOG_QUERY}`)
  // In-progress work is worth seeing whatever day you are looking at, so this
  // deliberately ignores the current date.
  const doing = useApi('/tasks?status=doing')
  const projects = useApi('/projects')
  const settings = useApi('/settings')

  const [draft, setDraft] = useState('')
  const [draftProject, setDraftProject] = useState(null)
  const [addingSection, setAddingSection] = useState(false)
  const [sectionName, setSectionName] = useState('')
  const [priFilter, setPriFilter] = useState([])
  // null when closed; otherwise { section } — the section id to file into,
  // or null for the day's loose list.
  const [meetingFor, setMeetingFor] = useState(null)
  // Which section is being carried, and the gap it would land in.
  // The row created by the last add, so its title opens selected and ready.
  const [justAdded, setJustAdded] = useState(null)
  const [dragSection, setDragSection] = useState(null)
  const [sectionDropAt, setSectionDropAt] = useState(null)

  // A section being carried leaves the same kind of stale marker if the drag
  // ends anywhere that does not handle it.
  useEffect(() => {
    if (dragSection === null && sectionDropAt === null) return
    const clear = () => { setDragSection(null); setSectionDropAt(null) }
    document.addEventListener('dragend', clear)
    document.addEventListener('drop', clear)
    return () => {
      document.removeEventListener('dragend', clear)
      document.removeEventListener('drop', clear)
    }
  }, [dragSection, sectionDropAt])
  const [backlogBy, setBacklogBy] = useState(() => localStorage.getItem('backlog_by') || 'priority')
  const [foldRoutines, setFoldRoutines] = useState(() => localStorage.getItem('fold_routines') === '1')
  const [foldBacklog, setFoldBacklog] = useState(() => localStorage.getItem('fold_backlog') === '1')
  const fold = (key, on, set) => { set(on); localStorage.setItem(key, on ? '1' : '0') }
  const [asideWidth, setAsideWidth] = useState(
    () => clampAside(Number(localStorage.getItem('day_aside_width')) || 340)
  )
  useEffect(() => {
    localStorage.setItem('day_aside_width', String(asideWidth))
  }, [asideWidth])
  useArrowNav(useCallback((by) => navigate(`/day/${addDays(date, by)}`), [date, navigate]))
  const undo = useUndo()
  const toast = useToast()

  /**
   * Lend the keyboard the handlers the buttons already use, so a keystroke and
   * the click it replaces do exactly the same thing — including landing on the
   * undo stack. Nothing here is new behaviour; it is the same four functions
   * the rows are already wired to.
   */
  // ABOVE the early returns below. A hook after one runs on some renders and
  // not others, and React treats the changing count as a hard error — which
  // white-screened this whole page the moment it had data to draw.
  //
  // Everything inside reads `day.data` when it is called rather than closing
  // over `d`, because at this point in the render there may not be any yet.
  useVimActions({
    date,
    undo,
    taskById: (id) => (day.data?.tasks || []).find((t) => t.id === id),
    /** Which band a task sits in, for a markdown yank that keeps its shape. */
    sectionName: (t) => (day.data?.sections || [])
      .find((sec) => sec.id === (t.section_id ?? null))?.name || null,
    /** Move the task itself among its siblings — what J and K do. */
    shift: async (id, by) => {
      const all = day.data?.tasks || []
      const me = all.find((t) => t.id === id)
      if (!me) return
      const siblings = all
        .filter((t) => (t.parent_id ?? null) === (me.parent_id ?? null)
          && (t.section_id ?? null) === (me.section_id ?? null)
          && t.kind !== 'note')
        .sort((a2, b2) => a2.sort - b2.sort || a2.id - b2.id)
        .map((t) => t.id)
      const at = siblings.indexOf(id)
      const to = at + by
      if (at < 0 || to < 0 || to >= siblings.length) return
      siblings.splice(to, 0, ...siblings.splice(at, 1))

      // The order captured here rather than through the drag helpers: those are
      // built below the early returns, and a handler lent from a render that
      // returned early would reach for them before they exist.
      const wasOrder = all
        .filter((t) => siblings.includes(t.id))
        .sort((a2, b2) => a2.sort - b2.sort || a2.id - b2.id)
        .map((t) => t.id)
      const apply = async () => { await api.post('/tasks/reorder', { ids: siblings }) }
      await apply()
      undo?.record?.({
        label: 'move task',
        undo: async () => { await api.post('/tasks/reorder', { ids: wasOrder }) },
        redo: apply,
      })
      refresh()
    },
    patch: (id, body) => patchTask(id, body),
    remove: (id) => removeTask(id),
    reschedule,
    /** A new row beside another, carrying whatever a yank put in the register. */
    addNear: async (nearId, row, side) => {
      const near = (day.data?.tasks || []).find((t) => t.id === nearId)
      const created = await api.post('/tasks', {
        title: row.title || 'New task',
        scheduled_date: date,
        section_id: near?.section_id ?? null,
        project_id: near?.project_id ?? null,
        estimate_min: row.estimate_min ?? null,
        priority: row.priority || 'medium',
      })
      if (near?.parent_id) await api.post(`/tasks/${created.id}/nest`, { parent_id: near.parent_id })

      // Placed against the row it was added from rather than at the end, which
      // is what "below the cursor" has to mean.
      if (near) {
        const siblings = (day.data?.tasks || [])
          .filter((t) => (t.parent_id ?? null) === (near.parent_id ?? null)
            && (t.section_id ?? null) === (near.section_id ?? null))
          .sort((a2, b2) => a2.sort - b2.sort || a2.id - b2.id)
          .map((t) => t.id)
          .filter((id) => id !== created.id)
        const at = siblings.indexOf(nearId)
        siblings.splice(side === 'above' ? at : at + 1, 0, created.id)
        await api.post('/tasks/reorder', { ids: siblings })
      }
      setJustAdded(created.id)
      refresh()
      return created
    },
  })

  if (day.error) return <div className="page"><p className="muted">{day.error.message}</p></div>
  if (!day.data) return <div className="page"><p className="muted">Loading…</p></div>

  const d = day.data
  const isToday = date === today()

  // The schedule is everything with a clock time — a meeting is just the case
  // where the time came with the thing. Sorted so the day reads top to bottom.
  const scheduled = d.tasks
    .filter((t) => t.kind !== 'note' && t.start_time)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
  // Meetings still drive the meeting-minutes figure in the day bar.
  const meetings = d.tasks.filter((t) => t.kind === 'meeting')

  const deepTarget = Number(settings.data?.deep_capacity_min ?? 240)
  const raw = settings.data?.daily_capacity_min
  const capacity = raw === undefined ? 330 : Number(raw)

  const columnLabels = labelsFor(settings.data)

  function refresh() {
    day.reload()
    backlog.reload()
    doing.reload()
  }

  /** A day either side, in this tab or a new one. */
  const step = (e, by) => {
    const to = `/day/${addDays(date, by)}`
    if (e?.ctrlKey || e?.metaKey) window.open(to, '_blank', 'noopener')
    else navigate(to)
  }

  const ops = taskOps(undo, refresh)

  const patchTask = async (id, patch) => {
    const task = d.tasks.find((t) => t.id === id)
    if (task) await ops.patch(task, patch)
    else { await api.patch(`/tasks/${id}`, patch); refresh() }
  }

  // The aside's rows can be dragged too, so a drop has to be able to look up a
  // task that is not on this day.
  const known = [...d.tasks, ...(backlog.data || []), ...(doing.data || [])]

  /** A drop moves whatever the drag carries — one row, or the whole selection. */
  const dropTasks = async (ids, patch, label, parent) => {
    if (!ids.length) return

    // A row arriving from the backlog is not just a date change: it carries a
    // path of scaffold copies that has to be matched against what this day
    // already holds, and then cleared away. Only the server can do that, so
    // those ids go through /schedule and the rest stay a plain patch.
    const returning = patch.scheduled_date === date
      ? ids.filter((id) => known.find((t) => t.id === id)?.scheduled_date == null)
      : []

    for (const id of returning) {
      await api.post(`/tasks/${id}/schedule`, { date, section_id: patch.section_id ?? null })
    }
    const rest = ids.filter((id) => !returning.includes(id))
    if (rest.length) await bulkPatch(rest, patch, { known, label, undo, parent })
    refresh()
  }

  /** Deleting is undoable both by Ctrl-Z and by the toast it leaves behind. */
  const removeTask = async (id) => {
    const task = d.tasks.find((t) => t.id === id)
    if (!task) return
    const restore = await ops.remove(task)
    toast({
      // The whole title. It was cut at forty characters to stop it running out
      // of the box; the box wraps and is bounded now, so the cut only hid which
      // task the Undo beside it referred to.
      message: `Deleted "${plainTitle(task.title) || 'note'}"`,
      action: { label: 'Undo', onClick: async () => { await restore(); refresh() } },
    })
  }

  /**
   * One gesture, two outcomes: a drop across the middle of a row nests, a drop
   * near either edge reorders within that row's own sibling group.
   */
  // The day is where this behaviour was grown and is where it is tested; the
  // backlog boards call the same module rather than each keeping half of it.
  const { onDropTask, snapshot, restoreAll } = makeTaskDnd({
    tasks: d.tasks, sections: d.sections, date, known, undo, refresh,
  })

  /**
   * Move a whole section within the day. The full resulting order is sent rather
   * than the one id that moved, so the server cannot disagree with what is on
   * screen and repeated drags never leave ties for `sort` to break.
   */
  async function reorderSections(movedId, targetId) {
    const side = sectionDropAt?.id === targetId ? sectionDropAt.side : 'before'
    setDragSection(null)
    setSectionDropAt(null)
    if (!movedId || movedId === targetId) return

    const ids = d.sections.map((s) => s.id)
    const from = ids.indexOf(movedId)
    if (from < 0) return
    ids.splice(from, 1)
    const at = ids.indexOf(targetId)
    if (at < 0) return
    ids.splice(side === 'after' ? at + 1 : at, 0, movedId)

    const wasOrder = d.sections.map((sec) => sec.id)
    const apply = async () => { await api.post('/sections/reorder', { ids }) }
    await apply()
    undo?.record?.({
      label: 'move section',
      undo: async () => { await api.post('/sections/reorder', { ids: wasOrder }) },
      redo: apply,
    })
    refresh()
  }

  /**
   * Out of the backlog and onto this day. It goes through /schedule rather than
   * a date patch because the row may be carrying a path of scaffold parents
   * that has to be matched against the day and then cleared away.
   */
  async function scheduleFromBacklog(id) {
    await api.post(`/tasks/${id}/schedule`, { date })
    refresh()
  }

  /**
   * Move a task to another day, or leave it and put a copy there. Undoable
   * either way: a move goes back to the day and section it came from, and a
   * copy is simply removed again.
   */
  async function reschedule(task, to, copy) {
    const before = { date: task.scheduled_date, section_id: task.section_id ?? null }
    const made = await api.post(`/tasks/${task.id}/move`, { date: to, copy })

    undo?.record?.({
      label: copy ? 'copy' : 'move',
      undo: async () => {
        if (copy) await api.del(`/tasks/${made.id}`)
        else {
          await api.patch(`/tasks/${task.id}`, {
            scheduled_date: before.date,
            section_id: before.section_id,
            status: 'todo',
            moved_to_date: null,
          })
        }
      },
      redo: async () => { await api.post(`/tasks/${task.id}/move`, { date: to, copy }) },
    })
    refresh()
  }

  /**
   * Drop into one of a section's three columns.
   *
   * `under` is what makes a sub-section band work in both directions: a drop
   * into the band's own columns re-parents onto its heading, and a drop into
   * the section's columns detaches. Without writing the parent at all — which
   * is what this used to do — a child dropped into the main grid kept pointing
   * at the heading and stayed in the band, which is why band children could
   * not be dragged out of one.
   *
   * `section_id` is written in BOTH cases, never cleared for a child. The day
   * builds its tree from a list already filtered by section, so a child whose
   * section is null under a parent whose section is set is not in the list its
   * parent is nested from, and disappears from the day entirely.
   */
  const moveToColumn = (ids, col, retime, under, section, labels) => dropTasks(
    ids,
    {
      col_index: col,
      section_id: section.id,
      scheduled_date: date,
      // Only when the drag was held there, and only for rows already in this
      // section: re-timing something arriving from elsewhere would overwrite
      // an estimate you had just made somewhere else.
      ...(retime ? { estimate_min: COLUMN_MINUTES[col] } : {}),
    },
    retime ? `re-time to ${labels[col]}` : `move to ${labels[col]}`,
    under,
  )

  /**
   * Put one or more top-level rows at a new position in a section.
   *
   * Every gesture in a columns section ends here: a band dropped on a band, a
   * band dropped on a run of tasks, a task dropped on a band's top or bottom
   * edge. They differ only in what moves and what it lands next to, so they
   * share one implementation and one undo entry.
   *
   * The whole top level is renumbered rather than nudging one row's `sort`.
   * Bands and ordinary tasks share a single sequence — that shared order is
   * exactly what makes them interleave — so writing positions for part of it
   * would renumber those rows into the range the rest is already using.
   *
   * `where` is 'auto' unless a caller is specific. Auto follows the ordinary
   * list-drag rule: dragging something DOWN onto a row lands it after that row,
   * dragging UP lands it before. Landing before the target unconditionally
   * reads fine until you try to move a band to the very end and find there is
   * no row past the last one to aim at. The band edges pass 'before'/'after'
   * outright, because there the user has aimed at a side already.
   */
  const placeInSection = async (moved, targetId, where = 'auto') => {
    const ids = Array.isArray(moved) ? moved : [moved]
    if (!ids.length || !targetId || ids.includes(targetId)) return

    const target = d.tasks.find((t) => t.id === targetId)
    if (!target) return
    const sectionId = target.section_id ?? null

    // Top level only: a child's position is decided by its parent, and pulling
    // one into this list would silently un-nest it.
    const order = d.tasks
      .filter((t) => (t.section_id ?? null) === sectionId && t.parent_id == null && t.kind !== 'note')
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((t) => t.id)

    const moving = ids.filter((id) => order.includes(id))
    const arriving = ids.filter((id) => !order.includes(id))
    const rest = order.filter((id) => !moving.includes(id))
    let at = rest.indexOf(targetId)
    if (at < 0) return

    const side = where === 'auto'
      // Compared in the ORIGINAL order: `rest` has the moved rows taken out
      // already, so it can no longer say which way the drag went.
      ? (moving.length && order.indexOf(moving[0]) < order.indexOf(targetId) ? 'after' : 'before')
      : where
    if (side === 'after') at += 1
    rest.splice(at, 0, ...moving, ...arriving)

    const before = snapshot([...rest, ...arriving])
    const apply = async () => {
      // Anything arriving from elsewhere needs the section and the date as well
      // as a position; a row already here needs only the position.
      for (const id of arriving) {
        await api.post(`/tasks/${id}/nest`, { parent_id: null })
        await api.patch(`/tasks/${id}`, { section_id: sectionId, scheduled_date: date })
      }
      await api.post('/tasks/reorder', { ids: rest })
    }
    await apply()
    undo?.record?.({ label: 'reorder', undo: restoreAll(before), redo: apply })
    refresh()
  }

  /**
   * Delete a section and the work in it.
   *
   * Both halves come back from the server — the section row and every task it
   * took — and both restore by their original ids, so undo is a matter of
   * putting the rows back rather than rebuilding anything. Tasks go back
   * parents-first: parent_id is a real foreign key and a child restored ahead
   * of its parent is rejected outright.
   */
  const removeSection = async (section) => {
    const inside = d.tasks.filter((t) => (t.section_id ?? null) === section.id)
    const count = inside.length
    // No confirm. The toast below names what went and offers Undo, and Ctrl-Z
    // does the same — a modal asking "are you sure" before an action that is
    // already reversible is a keystroke charged for nothing.
    const gone = await api.del(`/sections/${section.id}`)
    const restore = async () => {
      await api.post('/sections/restore', gone.section)
      for (const row of parentsFirst(gone.tasks || [])) await api.post('/tasks/restore', row)
    }

    undo?.record?.({
      label: `delete ${section.name}`,
      undo: restore,
      redo: async () => { await api.del(`/sections/${section.id}`) },
    })
    toast({
      message: `Deleted "${section.name}"${count ? ` and ${count} task${count === 1 ? '' : 's'}` : ''}`,
      action: { label: 'Undo', onClick: async () => { await restore(); refresh() } },
    })
    refresh()
  }

  const rowProps = (task) => ({
    task,
    subtasks: task.subtasks || [],
    onChange: (patch, id = task.id) => {
      // Once it has a real name it is no longer the row that was just added,
      // so it must not spring back into an editor if the list re-renders.
      if (patch.title !== undefined && id === justAdded) setJustAdded(null)
      return patchTask(id, patch)
    },
    onDelete: (id = task.id) => removeTask(id),
    onDropTask,
    onAddChild: addChild,
    autoEditId: justAdded,
    onReschedule: reschedule,
  })

  async function addChild(parent) {
    const created = await api.post('/tasks', {
      title: 'New subtask',
      scheduled_date: date,
      project_id: parent.project_id,
      section_id: parent.section_id,
    })
    await api.post(`/tasks/${created.id}/nest`, { parent_id: parent.id })

    // Above the others, not below. A subtask you are adding now is the one you
    // are thinking about, and a list that grows downward buries it under work
    // you wrote days ago and pushes it off the bottom of a long parent.
    const siblings = d.tasks.filter((t) => t.parent_id === parent.id)
    const first = Math.min(...siblings.map((t) => t.sort), 0)
    await api.patch(`/tasks/${created.id}`, { sort: first - 1 })

    setJustAdded(created.id)
    refresh()
  }

  async function addTask(e) {
    e.preventDefault()
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await api.post('/tasks', { title, scheduled_date: date, project_id: draftProject })
    refresh()
  }

  async function addTo(sectionId, kind = 'task') {
    // A note starts empty — its text is prose in `notes`, and a placeholder
    // title would just have to be deleted before writing anything.
    // A section tied to a project passes that on, which is also what gives the
    // new task the project's deep/light default — the server reads it from the
    // project on create. Without this, adding a task to a project's own band
    // produced one belonging to no project at all.
    const section = d.sections.find((sec) => sec.id === sectionId)

    const created = await api.post('/tasks', {
      title: kind === 'note' ? '' : 'New task',
      kind,
      scheduled_date: date,
      section_id: sectionId === UNSECTIONED ? null : sectionId,
      project_id: section?.project_id ?? null,
    })
    setJustAdded(created.id)
    refresh()
  }

  async function addSection(e) {
    e.preventDefault()
    const name = sectionName.trim()
    if (!name) { setAddingSection(false); return }
    setSectionName('')
    setAddingSection(false)
    await api.post('/sections', { date, name })
    refresh()
  }

  // Notes are prose and carry no priority, so a priority filter must not hide
  // them — otherwise filtering silently empties the notebook.
  const passesFilter = (t) =>
    !priFilter.length || t.kind === 'note' || priFilter.includes(t.priority)

  const inSection = (id) =>
    d.tasks.filter((t) => (t.section_id ?? null) === id && passesFilter(t))
  const loose = inSection(null)
  const looseOpen = loose.filter(
    (t) => t.kind !== 'note' && (t.status === 'todo' || t.status === 'doing')
  ).length

  const backlogTasks = (backlog.data || []).filter(isBacklogTask).sort(
    backlogBy === 'project'
      ? (a, b) => (a.project_name || '~').localeCompare(b.project_name || '~') || byPriority(a, b)
      : byPriority
  )
  const load = d.tasks
    .filter((t) => t.kind !== 'note' && (t.status === 'todo' || t.status === 'doing'))
    .reduce((sum, t) => sum + (t.estimate_min || 0), 0)
  // What the Tasks panel actually holds, which is only the work in no section
  // at all. Counting every open task on the day — which is what this used to do
  // — made the number disagree with the rows underneath it by however many were
  // filed in bands. `loose` is already filtered, so the count follows the
  // filters too, and nested rows count because they are drawn.

  return (
    <SelectionProvider>
    <div className="day-shell">
      <header className="topbar">
        <div className="daynav">
          {/* Ctrl/Cmd-click opens the day in a new tab, the way it would on any
              link. These are buttons because they navigate within the app, so
              the browser does not do this for us. */}
          <button className="btn ghost sm" onClick={(e) => step(e, -1)} aria-label="Previous day">
            <Icon name="left" size={15} />
          </button>
          <button className="btn ghost sm" onClick={(e) => step(e, 1)} aria-label="Next day">
            <Icon name="right" size={15} />
          </button>
        </div>
        <h1>{longDate(date)}</h1>
        {isToday && <span className="chip c-blue">Today</span>}
        <input
          className="input"
          type="date"
          style={{ width: 150 }}
          value={date}
          onChange={(e) => e.target.value && navigate(`/day/${e.target.value}`)}
        />
        {!isToday && <button className="btn sm" onClick={() => navigate(`/day/${today()}`)}>Today</button>}
        <span className="spacer" />
        <PriorityFilter value={priFilter} onChange={setPriFilter} />
        <button className="btn sm" onClick={() => setMeetingFor({ section: null })}>
          <Icon name="clock" size={13} /> New meeting
        </button>
        <Link className="btn ghost sm" to={`/notes/${date}`}><Icon name="templates" size={13} /> Notes page</Link>
      </header>

      <DayBar
        tasks={d.tasks}
        events={meetings}
        deepTarget={deepTarget}
      />

      <div
        className="day-wrap"
        style={{ gridTemplateColumns: `minmax(0, 1fr) 4px ${asideWidth}px` }}
      >
        <div className="day-col">
          {scheduled.length > 0 && (
            <Panel title={<><Icon name="clock" size={14} /> Schedule</>}>
              {scheduled.map((e) => (
                <div key={e.id} className={`event ${cls(e.project_color)}`}>
                  <span className="time">{e.start_time || '—'}</span>
                  <div style={{ flex: 1 }}>
                    <div className="etitle"><Rich text={e.title} inline /></div>
                    <div className="task-meta">
                      <span className="chip">{e.kind === 'meeting' ? 'meeting' : e.end_time ? `${e.start_time}–${e.end_time}` : 'timed'}</span>
                      {e.project_name && <span className={`chip ${cls(e.project_color)}`}>{e.project_name}</span>}
                      {(e.people || []).map((p) => (
                        <Link key={p.id} to={`/people/${p.id}`} className="chip">{p.name}</Link>
                      ))}
                      {e.url && (
                        <a className="chip" href={e.url} target="_blank" rel="noopener noreferrer">
                          <Icon name="link" size={11} /> join
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </Panel>
          )}

          {d.due.length > 0 && (
            <Panel title={<><Icon name="flag" size={14} /> Due today</>}>
              {d.due.map((m) => (
                <div key={m.id} className="row" style={{ padding: '4px 0' }}>
                  <span className="dot" style={{ background: `var(--${m.project_color})` }} />
                  <Link to={`/projects/${m.project_id}`}>{m.title}</Link>
                  <span className={`chip ${cls(m.project_color)}`}>{m.project_name}</span>
                </div>
              ))}
            </Panel>
          )}

          {d.sections.map((section) => (
            <SectionPanel
              key={section.id}
              section={section}
              tasks={inSection(section.id)}
              projects={projects.data || []}
              columnLabels={columnLabels}
              rowProps={rowProps}
              onAdd={(kind) => addTo(section.id, kind)}
              onAddMeeting={() => setMeetingFor({ section: section.id })}
              dragging={dragSection}
              dropAt={sectionDropAt}
              onDragSection={setDragSection}
              onDragSectionEnd={() => { setDragSection(null); setSectionDropAt(null) }}
              onDragOverSection={(id, side) => setSectionDropAt({ id, side })}
              onDropSection={reorderSections}
              onPatch={async (patch) => { await api.patch(`/sections/${section.id}`, patch); refresh() }}
              onDelete={() => removeSection(section)}
              onDropLoose={(ids) =>
                dropTasks(ids, { section_id: section.id, scheduled_date: date }, `move to ${section.name}`)}
              onMoveToColumn={(ids, col, retime, under = null) => moveToColumn(
                ids, col, retime, under, section, columnLabels,
              )}
              onPlace={placeInSection}
            />
          ))}

          <Panel
            title={
              <>
                Tasks <span className="muted">({looseOpen})</span>
                <Progress tasks={loose} className="section-prog" />
              </>
            }
            bodyClass=""
            actions={
              <>
                <button className="btn ghost sm" onClick={() => addTo(UNSECTIONED, 'note')}>
                  <Icon name="plus" size={12} /> Note
                </button>
                <button
                  className="btn ghost sm"
                  title="Move unfinished tasks from yesterday to this day"
                  onClick={async () => {
                    await api.post('/tasks/rollover', { from: addDays(date, -1), to: date })
                    refresh()
                  }}
                >
                  Pull yesterday
                </button>
              </>
            }
          >
            <div
              style={{ padding: 6 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => dropTasks(draggedIds(e), { section_id: null, scheduled_date: date }, 'move to loose')}
            >
              {loose.length === 0 && (
                <Empty>Nothing loose here. Add a task below, or make a section.</Empty>
              )}
              <TaskList tasks={loose} rowProps={rowProps} />
            </div>

            <form className="quick-add" onSubmit={addTask}>
              <input
                className="input"
                placeholder="Add a task…  (markdown, links and $math$ all work)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div style={{ width: 150 }}>
                <ProjectSelect
                  projects={projects.data || []}
                  value={draftProject}
                  onChange={setDraftProject}
                />
              </div>
              <button className="btn primary" type="submit"><Icon name="plus" size={14} /> Add</button>
            </form>
          </Panel>

          {addingSection ? (
            <form onSubmit={addSection} className="panel" style={{ padding: 10 }}>
              <input
                className="input"
                autoFocus
                placeholder="Section name — e.g. Deep work, Admin, Teleonomy…"
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                onBlur={addSection}
                onKeyDown={(e) => { if (e.key === 'Escape') { setSectionName(''); setAddingSection(false) } }}
              />
            </form>
          ) : (
            <button className="btn ghost" onClick={() => setAddingSection(true)}>
              <Icon name="plus" size={14} /> Add a section to this day
            </button>
          )}

          <Panel title="Day notes" actions={<Link className="btn ghost sm" to={`/notes/${date}`}>Open</Link>}>
            <RichEditor
              value={d.notes}
              onChange={async (notes) => { await api.patch(`/days/${date}`, { notes }); day.reload() }}
              placeholder="Plan, thinking, anything. Markdown, images and LaTeX: $e^{i\pi} = -1$"
              rows={8}
              draftKey={`day:${date}`}
            />
          </Panel>
        </div>

        {/* The aside's inner edge, as a handle. Dragging left widens it, which
            is the direction it grows — the grip is on that side of it. */}
        <div
          className="grip-v"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the side column"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            const from = e.clientX
            const start = asideWidth
            const move = (ev) => setAsideWidth(clampAside(start - (ev.clientX - from)))
            const done = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', done)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', done)
          }}
          onDoubleClick={() => setAsideWidth(340)}
        />

        <aside className="day-aside">
          {d.routines.length > 0 && (
            <Panel
              title={
                <>
                  <button
                    className="done-toggle bl-fold"
                    aria-expanded={!foldRoutines}
                    title={foldRoutines ? 'Show routines' : 'Minimise routines'}
                    onClick={() => fold('fold_routines', !foldRoutines, setFoldRoutines)}
                  >
                    <Icon name={foldRoutines ? 'right' : 'chevronDown'} size={12} />
                  </button>
                  <Icon name="today" size={14} /> Routines
                  {foldRoutines && <span className="muted"> ({d.routines.length})</span>}
                </>
              }
            >
              <div className="col" style={{ gap: 6, display: foldRoutines ? 'none' : undefined }}>
                {d.routines.map((rt) => {
                  const already = d.sections.some((s) => s.name === rt.name)
                  return (
                    <div key={rt.id} className="row">
                      <span style={{ flex: 1 }}>
                        {rt.name}
                        {already && <span className="muted"> · added</span>}
                      </span>
                      <button
                        className="btn sm"
                        onClick={async () => {
                          await api.post(`/routines/${rt.id}/apply`, { date })
                          refresh()
                        }}
                      >
                        {already ? 'Top up' : 'Add'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}

          {(doing.data || []).length > 0 && (
            <Panel
              title={<><Icon name="clock" size={14} /> In progress <span className="muted">({doing.data.length})</span></>}
              bodyClass=""
            >
              <div style={{ padding: 6 }}>
                {doing.data.map((t) => (
                  <div key={t.id} className="task doing" draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/task-id', String(t.id))}
                  >
                    <button
                      className="task-check st-doing"
                      title="Mark done"
                      onClick={() => patchTask(t.id, { status: 'done' })}
                    >
                      <span className="glyph-dot" />
                    </button>
                    <div className="task-body">
                      <div className="task-title">{t.title}</div>
                      <div className="task-meta">
                        {t.project_name && (
                          <span className={`chip ${cls(t.project_color)}`}>{t.project_name}</span>
                        )}
                        {t.scheduled_date && t.scheduled_date !== date && (
                          <Link to={`/day/${t.scheduled_date}`} className="chip">
                            {shortDate(t.scheduled_date)}
                          </Link>
                        )}
                      </div>
                    </div>
                    <div className="task-actions">
                      <button
                        className="btn ghost sm"
                        title="Stop working on this"
                        onClick={() => patchTask(t.id, { status: 'todo' })}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel
            title={
              <>
                <button
                  className="done-toggle bl-fold"
                  aria-expanded={!foldBacklog}
                  title={foldBacklog ? 'Show the backlog' : 'Minimise the backlog'}
                  onClick={() => fold('fold_backlog', !foldBacklog, setFoldBacklog)}
                >
                  <Icon name={foldBacklog ? 'right' : 'chevronDown'} size={12} />
                </button>
                Backlog <span className="muted">({backlogTasks.length})</span>
              </>
            }
            bodyClass=""
            actions={!foldBacklog && (
              <>
                <button
                  className="btn ghost sm"
                  title={`Ordered by ${backlogBy} — click to switch`}
                  onClick={() => {
                    const next = backlogBy === 'priority' ? 'project' : 'priority'
                    setBacklogBy(next)
                    localStorage.setItem('backlog_by', next)
                  }}
                >
                  {backlogBy === 'priority' ? 'By priority' : 'By project'}
                </button>
                {/* The whole backlog, grouped by project and gradeable in the
                    day's own three columns. */}
                <Link className="btn ghost sm" to="/tasks?view=backlog" title="See the whole backlog by project">
                  All
                </Link>
              </>
            )}
          >
            <div
              // Still a drop target when folded: dragging work off the day and
              // into a shut backlog is the whole reason to shut it.
              style={{ padding: 6, minHeight: 60, ...(foldBacklog ? { minHeight: 0, padding: 0 } : {}) }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                const ids = draggedIds(e)
                if (!ids.length) return
                for (const id of ids) await api.post(`/tasks/${id}/backlog`, {})
                refresh()
              }}
            >
              {foldBacklog ? null : backlogTasks.length === 0 ? (
                <Empty>Empty. Drag a task here to unschedule it.</Empty>
              ) : (
                nestTasks(backlogTasks).map((t) => (
                  <BacklogRow
                    key={t.id}
                    task={t}
                    date={date}
                    onPriority={(pri) => patchTask(t.id, { priority: pri })}
                    onSchedule={scheduleFromBacklog}
                  />
                ))
              )}
            </div>
          </Panel>

          <DayBucket
            label="Optional"
            defaultOpen
            hint="Tasks you might do today — not counted in the day's totals."
            tasks={d.tasks.filter((t) => t.kind !== 'note' && t.optional)}
            rowProps={rowProps}
          />

          <DayBucket
            label="Dropped"
            hint="Dropped or moved off this day."
            tasks={d.tasks.filter((t) => t.kind !== 'note' && ['dropped', 'moved'].includes(t.status))}
            rowProps={rowProps}
          />
        </aside>
      </div>

      <SelectionBar tasks={known} onDone={refresh} />

      {meetingFor && (
        <QuickMeeting
          date={date}
          section={meetingFor.section}
          onClose={() => setMeetingFor(null)}
          onCreated={() => { setMeetingFor(null); refresh() }}
        />
      )}
    </div>
    </SelectionProvider>
  )
}

function PriorityFilter({ value, onChange }) {
  const toggle = (p) =>
    onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p])

  return (
    <div className="pri-filter" role="group" aria-label="Filter by priority">
      <span className="pri-filter-label">Priority</span>
      {PRIORITIES.map((p) => (
        <button
          key={p}
          className={`pri-filter-btn pri-${p} ${value.includes(p) ? 'is-on' : ''}`}
          aria-pressed={value.includes(p)}
          title={`Show only ${p} priority`}
          onClick={() => toggle(p)}
        >
          <PriorityIcon level={p} size={15} />
        </button>
      ))}
      {value.length > 0 && (
        <button className="btn ghost sm" onClick={() => onChange([])} title="Clear filter">
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  )
}

/** Minutes a meeting occupies; untimed events contribute nothing. */
function meetingMinutes(events) {
  return events.reduce((sum, e) => {
    if (!e.start_time || !e.end_time) return sum
    const [sh, sm] = e.start_time.split(':').map(Number)
    const [eh, em] = e.end_time.split(':').map(Number)
    return sum + Math.max(0, eh * 60 + em - (sh * 60 + sm))
  }, 0)
}

/**
 * The day's headline. A day is tasks AND meetings — counting only tasks
 * understates it, so both go into the total and the bar; the breakdown below
 * keeps the two legible separately.
 */
function DayBar({ tasks, events, deepTarget }) {
  const t = tally(tasks)
  const meetings = meetingMinutes(events)

  const total = t.total + meetings
  const done = t.done
  const pct = total ? Math.round((done / total) * 100) : t.pct
  const remaining = Math.max(0, total - done)

  // Optional work extends the track to the right rather than filling it, so the
  // committed part of the day keeps its own proportions and a pile of maybes
  // never reads as a full day.
  const span = total + t.optional
  const width = (mins) => (span ? `${Math.min(100, (mins / span) * 100)}%` : '0%')

  if (!total && !t.doneCount && !t.openCount) return null

  return (
    <div className="daybar">
      <div className="daybar-bar">
        <i style={{ width: width(done) }} />
        {t.optional > 0 && (
          <b
            className="daybar-optional"
            style={{ left: width(total), width: width(t.optional) }}
            title={`${minutesLabel(t.optional)} of optional work — not counted in the day's total`}
          />
        )}
        {meetings > 0 && (
          <b
            className="daybar-meet"
            style={{ width: width(meetings) }}
            title={`${minutesLabel(meetings)} of meetings`}
          />
        )}
      </div>
      <div className="daybar-stats">
        <strong>{minutesLabel(remaining) || '0m'} still to do</strong>
        <span className="daybar-pct">{pct}%</span>
        <span className="daybar-sep">·</span>
        <span className="muted">{t.doneCount} of {t.doneCount + t.openCount} tasks</span>
        <span className="daybar-sep">·</span>
        <span className="muted">{minutesLabel(done) || '0m'} complete</span>
        <span className="daybar-sep">·</span>
        <span className="muted">{minutesLabel(total) || '0m'} planned</span>
        {meetings > 0 && (
          <>
            <span className="daybar-sep">·</span>
            <span className="muted">{minutesLabel(meetings)} meetings</span>
          </>
        )}
        {t.optional > 0 && (
          <>
            <span className="daybar-sep">·</span>
            <span className="daybar-opt-label">{minutesLabel(t.optional)} optional</span>
          </>
        )}
        <span className="spacer" />
        <DeepBar tasks={tasks} target={deepTarget} />
      </div>
    </div>
  )
}

/**
 * Open tasks with notes interleaved in place, then finished ones behind a
 * disclosure. The count stays visible so the day's progress is legible without
 * the finished work crowding out what is left.
 */
function TaskList({ tasks, rowProps }) {
  const [showDone, setShowDone] = useState(false)
  const tree = nestTasks(tasks)
  const open = tree.filter((t) => t.kind === 'note' || !['done', 'dropped'].includes(t.status))
  const closed = tree.filter((t) => t.kind !== 'note' && ['done', 'dropped'].includes(t.status))

  // Hidden rows are outside any range a shift-click could mean.
  const ids = [...visibleIds(open), ...(showDone ? visibleIds(closed) : [])]

  return (
    <>
      {open.map((t) => <TaskRow key={t.id} {...rowProps(t)} listIds={ids} />)}
      {closed.length > 0 && (
        <>
          <div className="hr" />
          {/* aria-expanded because the chevron alone is the only sign of which
              way this fold is sitting, and a screen reader cannot see it. */}
          <button
            className="done-toggle"
            aria-expanded={showDone}
            onClick={() => setShowDone(!showDone)}
          >
            <Icon name={showDone ? 'chevronDown' : 'right'} size={12} />
            {closed.length} done
          </button>
          {showDone && closed.map((t) => <TaskRow key={t.id} {...rowProps(t)} listIds={ids} />)}
        </>
      )}
    </>
  )
}

/**
 * A collapsed-by-default bucket for this day's optional and set-aside work —
 * present so nothing is lost, quiet so it does not compete with the plan.
 */
function DayBucket({ label, hint, tasks, rowProps, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  if (tasks.length === 0) return null

  const ids = visibleIds(tasks)

  return (
    <section className="panel">
      <header className="panel-h">
        <button className="done-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name={open ? 'chevronDown' : 'right'} size={12} />
          {label} <span className="muted">({tasks.length})</span>
        </button>
      </header>
      {open && (
        <div style={{ padding: 6 }}>
          <p className="muted" style={{ fontSize: 11.5, padding: '0 6px 4px', margin: 0 }}>{hint}</p>
          {tasks.map((t) => <TaskRow key={t.id} {...rowProps(t)} listIds={ids} />)}
        </div>
      )}
    </section>
  )
}

/**
 * Cut a section's top-level rows into the blocks it is drawn as.
 *
 * A run of ordinary tasks becomes one three-column grid; a sub-section becomes
 * a band of its own. They alternate in `sort` order, so a section reads top to
 * bottom the way it was arranged — tasks, a sub-section, more tasks — and a
 * task genuinely has a position above or below a band. Collecting every
 * non-band row into a single grid, which is what this replaced, made that
 * position impossible to express.
 */
/** Every row under a band, however deep — what its progress is measured over. */
function branchOf(tasks) {
  const out = []
  const walk = (list) => {
    for (const t of list) { out.push(t); walk(t.subtasks || []) }
  }
  walk(tasks)
  return out
}

function blocksOf(tree) {
  const blocks = []
  for (const t of tree) {
    if (t.kind === 'note') continue
    if (t.subsection) { blocks.push({ kind: 'band', task: t }); continue }
    const last = blocks[blocks.length - 1]
    if (last?.kind === 'grid') last.tasks.push(t)
    else blocks.push({ kind: 'grid', tasks: [t] })
  }
  // A section with nothing but bands still needs one place to drop a task that
  // is not going into any of them.
  if (!blocks.some((b) => b.kind === 'grid')) blocks.push({ kind: 'grid', tasks: [] })
  return blocks
}

/**
 * One run of ordinary tasks, graded into the three boxes.
 *
 * Split out of the section so a section can hold several — one per run between
 * sub-sections — rather than the single grid it used to have.
 */
function ColumnGrid({
  tasks, columnLabels, rowProps, armed, watchColumn, stopWatching,
  inSection, onMoveToColumn, onSettle, onPlaceBand,
}) {
  const [bandOver, setBandOver] = useState(false)
  const cols = [[], [], []]
  for (const t of tasks) cols[columnFor(t)].push(t)
  const colIds = cols.map(visibleIds)

  return (
    <div
      className={`box-cols${bandOver ? ' is-band-over' : ''}`}
      // A band being dragged past is looking for a position, not a column, so
      // it is caught here before it reaches one.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/band-id')) return
        e.preventDefault()
        e.stopPropagation()
        setBandOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setBandOver(false)
      }}
      onDrop={(e) => {
        const bandId = Number(e.dataTransfer.getData('text/band-id')) || null
        if (!bandId) return
        e.preventDefault()
        e.stopPropagation()
        setBandOver(false)
        onPlaceBand?.(bandId)
      }}
    >
      {cols.map((colTasks, i) => (
        <div
          key={i}
          className={`box-col${armed === i ? ' is-armed' : ''}`}
          onDragOver={(e) => {
            // A section passing over is not looking for a column, and neither
            // is a band hunting for a position.
            if (isSectionDrag(e)) return
            if (e.dataTransfer.types.includes('text/band-id')) return
            e.preventDefault()
            watchColumn(i)
          }}
          onDragLeave={(e) => {
            // Only when the pointer has actually left this column, not when it
            // crosses one of the rows inside it.
            if (!e.currentTarget.contains(e.relatedTarget)) stopWatching()
          }}
          onDrop={(e) => {
            if (e.dataTransfer.types.includes('text/band-id')) return
            const ids = draggedIds(e)
            if (!ids.length) return
            e.stopPropagation()
            onSettle?.()
            const held = armed === i
            stopWatching()
            // Only rows already in this section are re-timed; one arriving from
            // elsewhere keeps whatever it was given there.
            const here = inSection(ids)
            // Explicitly null, not omitted: this is the section's own grid, so
            // landing here means "no longer inside a band".
            onMoveToColumn(ids, i, held && here, null)
          }}
        >
          <div className="box-col-h">
            <SelectAllBox ids={colIds[i]} label={`the ${columnLabels[i]} column`} />
            {columnLabels[i]}
          </div>
          {colTasks.length === 0
            ? <p className="box-col-empty">Drop here</p>
            : colTasks.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} showProject={false} listIds={colIds[i]} />
            ))}
          {/* Soaks up the leftover height so even a column filled to its
              section's bottom edge keeps somewhere to drop onto. */}
          <div className="box-col-tail" />
        </div>
      ))}
    </div>
  )
}

/**
 * A top-level task promoted to a heading for the work under it. The heading is
 * graded by its WHOLE branch — a heading over two hours of work belongs in the
 * long column and should say two hours — while each child below grades by its
 * own total, exactly as it would out in the grid. The heading counts its
 * subtree without drawing it, because the band below IS that subtree; the rows
 * in the band draw theirs normally, which is how a grandchild stays visible.
 * Rules above, between and below make the band read as one unit.
 */
function SubSection({
  task, columnLabels, rowProps, onMoveToColumn,
  onPlace, dragging, over, onDragState, tone,
}) {
  // Which edge a task is hovering over, so the strip it will land on lights up.
  const [edge, setEdge] = useState(null)
  const [open, setOpen] = useState(true)
  // Armed by the grip only. The head row carries editable titles and time
  // boxes, and a heading draggable everywhere cannot have its text selected.
  const [armed, setArmed] = useState(false)
  const children = task.subtasks || []

  // Graded by the whole branch, like any other parent. The heading is not drawn
  // with its subtree — the band below is that — but it is still the sum of it,
  // so a heading over two hours of work reads as two hours.
  const head = [[], [], []]
  head[columnFor(task)].push(task)

  const kids = [[], [], []]
  for (const c of children) kids[columnFor(c)].push(c)

  const row = (groups, opts = {}) => (
    <div className="box-cols">
      {groups.map((group, i) => (
        <div
          className="box-col"
          key={i}
          // Columns inside the band take drops too, or a child could be moved
          // between the band's own columns only by luck.
          onDragOver={(e) => { if (!isSectionDrag(e)) e.preventDefault() }}
          onDrop={(e) => {
            // The heading cannot go inside itself, and /nest rejects the cycle
            // with a 400 rather than ignoring it, so drop it from the gesture
            // instead of sending a request that is known to fail.
            const ids = draggedIds(e).filter((id) => id !== task.id)
            if (!ids.length) return
            e.stopPropagation()
            onMoveToColumn?.(ids, i, false, task.id)
          }}
        >
          {group.map((t) => (
            <TaskRow
              key={t.id}
              {...rowProps(t)}
              subtasks={t.subtasks || []}
              // The heading counts its branch but does not draw it; the rows
              // below draw theirs, which is how a grandchild becomes visible.
              renderChildren={!opts.head}
              showProject={false}
              listIds={group.map((x) => x.id)}
            />
          ))}
        </div>
      ))}
    </div>
  )

  return (
    <div
      className={[
        'subsec',
        dragging ? 'is-dragging' : '',
        over ? 'is-over' : '',
      ].filter(Boolean).join(' ')}
      draggable={armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        // The id rides on the dataTransfer rather than in React state: a drop
        // can land before the dragstart's state update has committed, and the
        // reorder would then be silently dropped.
        e.dataTransfer.setData('text/band-id', String(task.id))
        onDragState?.('drag', task.id)
      }}
      onDragEnd={() => { setArmed(false); onDragState?.('end', null) }}
      onDragOver={(e) => {
        // Only for another band. A task being dragged into this band's columns
        // is a different gesture, handled by the columns themselves.
        if (!e.dataTransfer.types.includes('text/band-id')) return
        e.preventDefault()
        e.stopPropagation()
        onDragState?.('over', task.id)
      }}
      onDrop={(e) => {
        const from = Number(e.dataTransfer.getData('text/band-id')) || null
        if (!from) return
        e.preventDefault()
        e.stopPropagation()
        onDragState?.('end', null)
        onPlace?.(from, task.id)
      }}
    >
      {/* The two strips are what give a task a position outside this band.
          Dropping on the top strip puts it immediately before the heading, on
          the bottom strip immediately after — which is the run of ordinary
          tasks above or below, creating one if there is none. */}
      <EdgeStrip
        side="top"
        lit={edge === 'top'}
        onOver={() => setEdge('top')}
        onLeave={() => setEdge(null)}
        onDropTask={(ids) => { setEdge(null); onPlace?.(ids, task.id) }}
      />
      <div className="subsec-rule" />
      <div className="subsec-head">
        <span
          className="subsec-grip"
          title="Drag to reorder this sub-section"
          onMouseDown={() => setArmed(true)}
          onMouseUp={() => setArmed(false)}
        >
          <Icon name="grip" size={13} />
        </span>
        <button
          className="task-twist subsec-twist"
          title={open ? 'Minimise what is under this' : 'Show what is under this'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? 'chevronDown' : 'right'} size={12} />
        </button>
        {row(head, { head: true })}
      </div>

      {/* Under the heading, full width, in the section's own colour — beside it
          the bar had to share the row with a title of unknown length and pushed
          the text out of the box. The heading itself is excluded from the
          count: it is the container, and counting it would let a band read as
          part-done purely because its own box had been ticked. */}
      {children.length > 0 && (
        <Progress tasks={branchOf(children)} color={tone} className="subsec-prog" />
      )}

      {open && (
        <>
          <div className="subsec-rule" />
          {children.length > 0
            ? row(kids)
            : <p className="subsec-empty">Nothing under this yet — add a subtask.</p>}
        </>
      )}
      <div className="subsec-rule" />
      <EdgeStrip
        side="bottom"
        lit={edge === 'bottom'}
        onOver={() => setEdge('bottom')}
        onLeave={() => setEdge(null)}
        onDropTask={(ids) => { setEdge(null); onPlace?.(ids, task.id, 'after') }}
      />
    </div>
  )
}

/**
 * A thin band-edge target for a task being placed outside a sub-section.
 *
 * It only accepts task drags: a band being dragged is looking for a position
 * among the blocks, which the sub-section itself handles, and letting both
 * through here would make the two gestures fight over the same few pixels.
 */
function EdgeStrip({ side, lit, onOver, onLeave, onDropTask }) {
  return (
    <div
      className={`subsec-edge is-${side}${lit ? ' is-lit' : ''}`}
      onDragOver={(e) => {
        if (isSectionDrag(e) || e.dataTransfer.types.includes('text/band-id')) return
        if (!isTaskDrag(e)) return
        e.preventDefault()
        e.stopPropagation()
        onOver()
      }}
      onDragLeave={onLeave}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes('text/band-id')) return
        const ids = draggedIds(e)
        if (!ids.length) return
        e.preventDefault()
        e.stopPropagation()
        onDropTask(ids)
      }}
    />
  )
}

/**
 * A backlog entry and everything filed under it. Since a task now leaves for
 * the backlog carrying copies of its parents, the panel has real trees in it,
 * and a flat list would show "Draft" three times with no clue which was which.
 * Open by default: the path is the point of it being there.
 */
function BacklogRow({ task, date, onPriority, onSchedule, depth = 0 }) {
  // Closed to begin with. A backlogged branch arrives whole — its path above it
  // and everything under it — and unrolling all of that into the aside buries
  // the rest of the backlog under one item you have deliberately set aside.
  const [open, setOpen] = useState(false)
  const kids = task.subtasks || []

  return (
    <>
      <div
        className={`task bl-row${task.scaffold ? ' is-scaffold' : ''}`}
        style={depth ? { marginLeft: depth * 16 } : undefined}
        draggable
        onDragStart={(ev) => ev.dataTransfer.setData('text/task-id', String(task.id))}
      >
        {kids.length > 0 ? (
          <button
            className="task-twist"
            title={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? 'chevronDown' : 'right'} size={12} />
          </button>
        ) : (
          <span className="task-twist" aria-hidden="true" />
        )}

        <div className="task-body">
          <div className="task-title">{task.title}</div>
          <div className="task-meta">
            {/* A scaffold row is a heading, not work: it carries no priority of
                its own and nothing to schedule. */}
            {!task.scaffold && (
              <>
                <PriorityChip level={task.priority} onChange={onPriority} />
                {task.project_name && (
                  <span className={`chip ${cls(task.project_color)}`}>{task.project_name}</span>
                )}
              </>
            )}
            {kids.length > 0 && (
              <span className="chip">{kids.length} under this</span>
            )}
          </div>
        </div>

        {!task.scaffold && (
          <div className="task-actions">
            <button
              className="btn ghost sm"
              title="Schedule on this day, back under its own parents"
              onClick={() => onSchedule(task.id)}
            >
              <Icon name="arrowRight" size={13} />
            </button>
          </div>
        )}
      </div>

      {open && kids.map((kid) => (
        <BacklogRow
          key={kid.id}
          task={kid}
          date={date}
          onPriority={onPriority}
          onSchedule={onSchedule}
          depth={depth + 1}
        />
      ))}
    </>
  )
}

function SectionPanel({
  section, tasks, projects, columnLabels, rowProps,
  onAdd, onAddMeeting, onPatch, onDelete, onDropLoose, onMoveToColumn, onPlace,
  dragging, dropAt, onDragSection, onDragSectionEnd, onDragOverSection, onDropSection,
}) {
  const [renaming, setRenaming] = useState(false)
  const [over, setOver] = useState(false)
  // Which column the drag has been held over long enough to re-time into.
  // Re-timing rewrites an estimate you may have thought about, so it is not
  // something a passing drag should be able to do: a quick drop still moves the
  // task, and only a deliberate pause changes what it says about itself.
  const [armed, setArmed] = useState(null)
  const dwell = useRef({ col: null, timer: null })
  const [bandDrag, setBandDrag] = useState(null)
  const [bandOver, setBandOver] = useState(null)

  // Folded away once nothing in it is left to do, and only on the transition —
  // so opening a finished band to look at it stays open, and it only folds
  // again if something in it is reopened and finished afresh.
  const [folded, setFolded] = useState(false)
  const wasDone = useRef(null)
  const tree = nestTasks(tasks)
  const isColumns = section.layout === 'columns'

  const live = tasks.filter((t) => t.kind !== 'note' && t.status !== 'dropped' && !t.optional)
  const complete = live.length > 0 && live.every((t) => t.status === 'done')

  useEffect(() => {
    if (wasDone.current === null) { wasDone.current = complete; return }
    if (complete && !wasDone.current) setFolded(true)
    if (!complete && wasDone.current) setFolded(false)
    wasDone.current = complete
  }, [complete])

  const shut = section.collapsed || folded

  const watchColumn = (col) => {
    if (dwell.current.col === col) return
    clearTimeout(dwell.current.timer)
    dwell.current = {
      col,
      timer: setTimeout(() => setArmed(col), RETIME_DWELL),
    }
    setArmed(null)
  }

  const stopWatching = () => {
    clearTimeout(dwell.current.timer)
    dwell.current = { col: null, timer: null }
    setArmed(null)
  }

  useEffect(() => () => clearTimeout(dwell.current.timer), [])

  // Same reason as the row markers: an armed column must not stay lit once the
  // drag is over, however it ended.
  useEffect(() => {
    if (armed === null && !over) return
    const clear = () => { stopWatching(); setOver(false) }
    document.addEventListener('dragend', clear)
    document.addEventListener('drop', clear)
    return () => {
      document.removeEventListener('dragend', clear)
      document.removeEventListener('drop', clear)
    }
  })

  // The header takes drops as well as the body, so a collapsed section is still
  // somewhere to put a task. A section being dragged past is a different gesture
  // entirely, so it is filtered out here and handled by the panel below.
  const dropZone = {
    onDragOver: (e) => { if (!isTaskDrag(e)) return; e.preventDefault(); setOver(true) },
    onDragLeave: () => setOver(false),
    onDrop: (e) => {
      setOver(false)
      if (isSectionDrag(e)) return
      const ids = draggedIds(e)
      if (ids.length) onDropLoose(ids)
    },
  }

  /**
   * Reordering the section itself. Only the grip starts this drag — making the
   * whole header draggable would mean every attempt to rename or to use the
   * layout buttons began by picking the section up.
   */
  const reorderZone = {
    onDragOver: (e) => {
      if (!dragging || dragging === section.id) return
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      onDragOverSection(section.id, e.clientY - r.top < r.height / 2 ? 'before' : 'after')
    },
    onDrop: (e) => {
      if (!isSectionDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      onDropSection(Number(e.dataTransfer.getData('text/section-id')), section.id)
    },
  }

  // A loose note has no natural column, so in the three-column layout notes stay
  // full width above the grid rather than all collapsing into the first column.
  const notes = isColumns ? tree.filter((t) => t.kind === 'note') : []

  // A promoted task becomes a band of its own across the full width, so it is
  // lifted out of the three-column grid entirely rather than filed in one of
  // the columns. Everything else grades into a column as usual.
  const bands = isColumns
    ? tree.filter((t) => t.subsection && t.kind !== 'note')
    : []

  // Bands and ordinary work interleave in one `sort` order, so a section reads
  // top to bottom as it was arranged: a run of tasks, a sub-section, more
  // tasks. Grouping every non-band row into one grid regardless of position —
  // which is what this used to do — left no place to put a task above a band.
  const blocks = isColumns ? blocksOf(tree) : []

  // Each column is its own list, so a range never jumps between them.
  const noteIds = visibleIds(notes)

  // A section filed under a project wears the project's colour. Keeping a
  // separate palette for the band meant a day's "Teleonomy" section was some
  // other colour than every Teleonomy task and chip on the same screen, so the
  // one cue that ties work to a project stopped at the section heading.
  // A colour set on the section itself still wins: that is a deliberate choice
  // about this band, and the project is only the default.
  //
  // `gray` counts as unset, not as a choice: the column is NOT NULL DEFAULT
  // 'gray', so a plain `section.color ||` never falls through and the project
  // colour could never show at all.
  const chosen = section.color && section.color !== 'gray' ? section.color : null
  const tone = chosen || section.project_color || section.color

  return (
    <section
      className={[
        'panel section', cls(tone),
        complete ? 'is-complete' : '',
        over ? 'sel-drop-on' : '',
        dragging === section.id ? 'sec-dragging' : '',
        dropAt?.id === section.id ? `sec-drop-${dropAt.side}` : '',
      ].filter(Boolean).join(' ')}
      {...reorderZone}
    >
      <header className="panel-h section-h" {...dropZone}>
        <span
          className="sec-grip"
          title="Drag to reorder this section"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/section-id', String(section.id))
            e.dataTransfer.effectAllowed = 'move'
            onDragSection(section.id)
          }}
          onDragEnd={onDragSectionEnd}
        >
          <Icon name="grip" size={13} />
        </span>
        <button
          className="task-twist"
          title={section.collapsed ? 'Expand section' : 'Minimise section'}
          aria-expanded={!shut}
          onClick={() => {
            // Whichever way it is shut, the twist opens it — and opening one
            // that folded itself must not immediately re-fold.
            if (folded) setFolded(false)
            if (section.collapsed) onPatch({ collapsed: 0 })
            else if (!folded) onPatch({ collapsed: 1 })
          }}
        >
          <Icon name={shut ? 'right' : 'chevronDown'} size={12} />
        </button>
        <span className="dot" style={{ background: 'var(--c)' }} />
        {renaming ? (
          <input
            className="input"
            autoFocus
            style={{ width: 220 }}
            defaultValue={section.name}
            onBlur={(e) => { setRenaming(false); if (e.target.value.trim()) onPatch({ name: e.target.value.trim() }) }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false) }}
          />
        ) : (
          <button className="section-name" onClick={() => setRenaming(true)}>{section.name}</button>
        )}
        {section.project_name && (
          <Link to={`/projects/${section.project_id}`} className={`chip ${cls(section.project_color)}`}>
            {section.project_name}
          </Link>
        )}
        {/* Beside the progress bar, because that is where you are already
            looking when you decide to act on the whole band. In three-column
            layout each column has its own box as well; this is the one that
            covers all of them. */}
        <SelectAllBox ids={visibleIds(tree)} label={`everything in ${section.name}`} />
        <Progress tasks={tasks} color={tone} className="section-prog" />
        <span className="spacer" />

        <select
          className="input select sm"
          style={{ width: 128 }}
          value={section.project_id ?? ''}
          onChange={(e) => onPatch({ project_id: e.target.value ? Number(e.target.value) : null })}
          title="Link this section to a project"
        >
          <option value="">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <button
          className={`btn ghost sm ${!isColumns ? 'is-on' : ''}`}
          title="List"
          onClick={() => onPatch({ layout: 'list' })}
        >
          <Icon name="list" size={13} />
        </button>
        <button
          className={`btn ghost sm ${isColumns ? 'is-on' : ''}`}
          title="Three columns"
          onClick={() => onPatch({ layout: 'columns' })}
        >
          <Icon name="columns" size={13} />
        </button>
        <button className="btn ghost sm" title="Add task" onClick={() => onAdd('task')}>
          <Icon name="plus" size={13} />
        </button>
        <button className="btn ghost sm" title="Add note" onClick={() => onAdd('note')}>
          <Icon name="templates" size={13} />
        </button>
        {/* A meeting needs the composer rather than a blank row — it has people,
            a link and a span to fill in — so this opens it pre-filed here. */}
        <button className="btn ghost sm" title="Add meeting" onClick={onAddMeeting}>
          <Icon name="clock" size={13} />
        </button>
        <button
          className="btn ghost sm danger"
          title="Delete this section and the tasks in it"
          onClick={onDelete}
        >
          <Icon name="trash" size={13} />
        </button>
      </header>

      {shut ? null : (
      <div {...dropZone}>
        {isColumns ? (
          <>
          {blocks.map((block) => (block.kind === 'band' ? (
            <SubSection
              key={`band-${block.task.id}`}
              task={block.task}
              columnLabels={columnLabels}
              rowProps={rowProps}
              dragging={bandDrag === block.task.id}
              over={bandOver === block.task.id}
              onDragState={(what, id) => {
                if (what === 'drag') setBandDrag(id)
                else if (what === 'over') setBandOver(id)
                else { setBandDrag(null); setBandOver(null) }
              }}
              // Both gestures end in the same place: a new position in the
              // section's one top-level order. A band dropped on a band lands
              // before it; a task dropped on a band's edge lands just outside
              // it, which is what puts a task above or below a sub-section.
              onPlace={(movedId, targetId, where) => onPlace?.(movedId, targetId, where)}
              tone={tone}
              onMoveToColumn={(ids, col, retime, under) =>
                onMoveToColumn(ids, col, retime, under)}
            />
          ) : (
            <ColumnGrid
              key={`grid-${block.tasks[0]?.id ?? 'empty'}`}
              tasks={block.tasks}
              columnLabels={columnLabels}
              rowProps={rowProps}
              armed={armed}
              watchColumn={watchColumn}
              stopWatching={stopWatching}
              inSection={(ids) => ids.every((id) => tasks.some((t) => t.id === id))}
              onMoveToColumn={onMoveToColumn}
              onSettle={() => setOver(false)}
              // A band dragged onto a run of ordinary tasks lands above it.
              onPlaceBand={(bandId) => onPlace?.(bandId, block.tasks[0]?.id ?? null)}
            />
          )))}

          {/* Under the grid, not above it. A loose note is commentary on the
              section, and putting it first pushed the actual work down the
              page behind whatever had been jotted about it. */}
          {notes.length > 0 && (
            <div className="section-notes">
              {notes.map((t) => (
                <TaskRow key={t.id} {...rowProps(t)} showProject={false} listIds={noteIds} />
              ))}
            </div>
          )}
          </>
        ) : (
          <div style={{ padding: 6, minHeight: 44 }}>
            {tasks.length === 0
              ? <Empty>Empty — add a task or drag one here.</Empty>
              : <TaskList tasks={tasks} rowProps={rowProps} />}
          </div>
        )}
      </div>
      )}
    </section>
  )
}
