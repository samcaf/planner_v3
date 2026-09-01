import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import Progress, { CLOSED, OPEN } from '../components/Progress.jsx'
import QuickMeeting from '../components/QuickMeeting.jsx'
import TaskFilter, {
  ActiveChips, Chip, ChipGroup, emptyFilters, filterChips, taskFilter, toggleFilter,
} from '../components/TaskFilter.jsx'
import TaskRow from '../components/TaskRow.jsx'
import { Empty, Panel, ProjectSelect, cls } from '../components/ui.jsx'
import BacklogBoards from '../components/BacklogBoards.jsx'
import ExternalPicker from '../components/ExternalPicker.jsx'
import { bulkPatch } from '../components/Selection.jsx'
import { isBacklogTask } from '../lib/backlog.js'
import { columnLabels as labelsFor } from '../lib/columns.js'
import { makeTaskDnd } from '../lib/taskDnd.js'
import { useVimActions } from '../lib/vim.jsx'
import { makeVimActions } from '../lib/vimActions.js'
import { taskOps, useUndo } from '../lib/undo.jsx'
import { api, useApi } from '../lib/api.js'
import { longDate, relative, shortDate } from '../lib/dates.js'
import '../styles/alltasks.css'
import { usePageTitle } from '../lib/title.js'

const GROUPINGS = [
  ['none', 'No grouping'],
  ['project', 'By project'],
  ['date', 'By scheduled date'],
]

// One shared instance, so clearing an already-clear filter is a no-op re-render.
const NO_FILTERS = emptyFilters()

export default function AllTasks() {
  usePageTitle('All tasks')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [projectId, setProjectId] = useState(null)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [showClosed, setShowClosed] = useState(false)
  const [showRoutine, setShowRoutine] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  // Imported work lands unscheduled, so the backlog is where you stand when you
  // want more of it.
  const [importing, setImporting] = useState(false)
  // By project by default: an ungrouped list of every open task in the
  // planner is the one shape of this page nobody reads.
  const [groupBy, setGroupBy] = useState('project')
  // In the URL so the day's backlog panel can link straight here, and so the
  // view survives a refresh the way the grouping in a bookmarked link would.
  const [urlParams, setUrlParams] = useSearchParams()
  const backlogView = urlParams.get('view') === 'backlog'
  const setBacklogView = (on) => setUrlParams((prev) => {
    const next = new URLSearchParams(prev)
    if (on) next.set('view', 'backlog'); else next.delete('view')
    return next
  }, { replace: true })
  const [board, setBoard] = useState(true)
  const undo = useUndo()
  const settings = useApi('/settings')
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null)
  const [draft, setDraft] = useState('')
  const [draftProject, setDraftProject] = useState(null)
  const [meeting, setMeeting] = useState(false)

  // The dragover that fixes the insertion point can land in the same commit as
  // the drop, so the drop reads the position from a ref rather than a closure
  // over state that is still a render behind. The state copy only draws the line.
  const overRef = useRef(null)
  const hover = (next) => { overRef.current = next; setOver(next) }

  // Typing straight into the query string would refetch on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q), 250)
    return () => clearTimeout(timer)
  }, [q])

  // q, project_id and status are the three filters GET /api/tasks understands,
  // so they travel as query params; everything else is applied below.
  const statuses = filters.status.length ? filters.status : (showClosed ? [] : OPEN)
  const params = new URLSearchParams()
  if (search.trim()) params.set('q', search.trim())
  if (projectId) params.set('project_id', String(projectId))
  if (statuses.length) params.set('status', statuses.join(','))
  const query = params.toString()

  const tasks = useApi(`/tasks${query ? `?${query}` : ''}`, [query])
  const doing = useApi('/tasks?status=doing')
  const projects = useApi('/projects')

  // Routine chores and prose notes are noise in a cross-cutting task list, so
  // both are out until asked for. See `hidesRoutine` for the caveat.
  // Archived rows are out everywhere. A project note section that has been
  // filed away should not come back through a cross-cutting list — that would
  // make archiving mean "hidden on one page" rather than "put away".
  const included = (t) => !t.archived
    && (showNotes || t.kind !== 'note')
    && (showRoutine || !t.hide_from_all_tasks)

  // The status group is already in the query string above, so re-applying it
  // here changes nothing — the shared predicate simply owns every group.
  const keep = taskFilter(filters)

  const all = tasks.data || []
  const list = all.filter((t) => included(t) && keep(t))
  const groups = tasks.data ? buildGroups(list, groupBy) : []
  // The same definition the day's aside and each project's panel use: open work
  // that has never been given a day. See lib/backlog.js.
  const backlogTasks = list.filter((t) => isBacklogTask(t) && t.scheduled_date == null)

  // The keyboard gets the same handlers the buttons use, so a key here does
  // what it does on a day. No date of its own: a task added from this list is
  // dateless, which is the backlog rather than something filed on today.
  useVimActions(makeVimActions({
    tasks: all, date: null, undo, refresh: reload, patch: save, remove, reschedule,
  }))

  // Dateless work laid out in three boxes: no date and no sections travel with
  // a drop, and `columns` is what says this view has boxes at all even though
  // no section here does.
  const dnd = makeTaskDnd({
    tasks: backlogTasks, date: null, known: all, columns: true, undo, refresh: reload,
  })
  const inProgress = (doing.data || []).filter((t) => t.kind !== 'note' && (showRoutine || !t.hide_from_all_tasks))

  const active = activeChips(filters, { search, projectId, projects: projects.data, showNotes, showRoutine })

  /**
   * /api/tasks/reorder writes scheduled_date onto every id it is handed, so a
   * list is only safe to drag when every row in it provably shares one date.
   * Only the date grouping guarantees that; the others stay static.
   */
  const canReorder = groupBy === 'date'

  function reload() {
    tasks.reload()
    doing.reload()
  }

  // Through taskOps rather than a bare PATCH: that is what puts the change on
  // the undo stack and cascades a tick down to a task's children. Editing from
  // this list was silently outside both — Ctrl-Z did nothing after it, which
  // reads as undo being broken rather than as this page never recording.
  const ops = taskOps(undo, reload)

  async function save(id, patch) {
    const task = all.find((t) => t.id === id)
    if (task) await ops.patch(task, patch)
    else { await api.patch(`/tasks/${id}`, patch); reload() }
  }

  async function remove(id) {
    await api.del(`/tasks/${id}`)
    reload()
  }

  /**
   * Give a backlogged task a day, or put a copy of it on one. /move is the
   * server's job because the task's section has to be found or made on the far
   * day; a plain date patch drops it into that day's loose list instead.
   */
  async function reschedule(task, to, copy) {
    const before = { date: task.scheduled_date, section_id: task.section_id ?? null }
    const made = await api.post(`/tasks/${task.id}/move`, { date: to, copy })

    undo?.record?.({
      label: copy ? 'copy to a day' : 'move to a day',
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
    reload()
  }

  function clearAll() {
    setFilters(NO_FILTERS)
    setShowNotes(false)
    setShowRoutine(false)
    setQ('')
    setSearch('')
    setProjectId(null)
  }

  const toggle = (group, key) => setFilters((f) => toggleFilter(f, group, key))

  function clearChip(chip) {
    if (chip.group === 'search') { setQ(''); setSearch(''); return }
    if (chip.group === 'project') { setProjectId(null); return }
    if (chip.group === 'notes') { setShowNotes(false); return }
    if (chip.group === 'routine') { setShowRoutine(false); return }
    toggle(chip.group, chip.key)
  }

  async function addTask(e) {
    e.preventDefault()
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await api.post('/tasks', { title, project_id: draftProject, scheduled_date: null })
    reload()
  }

  async function drop(e, group) {
    e.preventDefault()
    const id = Number(e.dataTransfer.getData('text/task-id')) || drag
    const spot = overRef.current
    const at = spot && spot.key === group.key ? spot : null
    setDrag(null)
    hover(null)
    if (!id || !canReorder) return

    const ids = group.rows.map((row) => row.task.id)
    // Landing in another day is also a reschedule, and PATCH cascades the new
    // date onto subtasks where /reorder would strand them on the old one.
    if (!ids.includes(id)) await api.patch(`/tasks/${id}`, { scheduled_date: group.date })
    await api.post('/tasks/reorder', { ids: place(ids, id, at), scheduled_date: group.date })
    reload()
  }

  return (
    <>
      <header className="topbar">
        <h1>All tasks</h1>
        <span className="muted sub">
          {tasks.data ? (list.length === all.length ? list.length : `${list.length} of ${all.length}`) : ''}
        </span>
        <span className="spacer" />
        {filters.status.length === 0 && (
          <button className="btn ghost sm" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Hide closed' : 'Show closed'}
          </button>
        )}
        {/* This page has no day of its own, so a meeting booked here lands on
            today — the form's date field is where to move it. */}
        <button className="btn" onClick={() => setMeeting(true)}>
          <Icon name="clock" size={14} /> New meeting
        </button>
      </header>

      <div className="page col" style={{ gap: 16 }}>
        {inProgress.length > 0 && (
          <Panel
            className="at-inprog"
            bodyClass="at-body"
            title={
              <>
                <span className="at-live" aria-hidden="true" />
                In progress
                <span className="muted">({inProgress.length})</span>
                <span className="muted at-note">every unfinished task you have started, any day</span>
              </>
            }
          >
            {inProgress.map((task) => (
              <TaskLine
                key={task.id}
                task={task}
                onChange={(patch) => save(task.id, patch)}
                onDelete={() => remove(task.id)}
              />
            ))}
          </Panel>
        )}

        <Panel bodyClass="at-toolbar">
          <div className="at-filters">
            <label className="at-search">
              <span className="at-search-ico"><Icon name="search" size={14} /></span>
              <input
                className="input"
                placeholder="Search titles…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>

            <div className="at-filter" title="Filter by project">
              <ProjectSelect
                projects={projects.data || []}
                value={projectId}
                onChange={setProjectId}
              />
            </div>

            {!backlogView && (
              <select
                className="input select at-filter"
                title="Grouping"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                {GROUPINGS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}

            {/* The backlog is grouped by project by construction, so the
                grouping picker steps aside while it is showing. */}
            <button
              className={`btn ghost sm${backlogView ? ' is-on' : ''}`}
              title="Show only work that has never been given a day, grouped by project"
              aria-pressed={backlogView}
              onClick={() => setBacklogView(!backlogView)}
            >
              <Icon name="templates" size={12} /> Backlog
              {backlogTasks.length > 0 && <span className="muted"> {backlogTasks.length}</span>}
            </button>

            {backlogView && (
              <button
                className="btn ghost sm"
                title="Pick work out of a connected system and put it in the backlog"
                onClick={() => setImporting(true)}
              >
                <Icon name="link" size={12} /> Import
              </button>
            )}

            {backlogView && (
              <button
                className="btn ghost sm"
                title={board ? 'Show as a plain list' : 'Show in the day view\u2019s three columns'}
                onClick={() => setBoard(!board)}
              >
                <Icon name={board ? 'list' : 'columns'} size={12} />
                {board ? ' As a list' : ' As a board'}
              </button>
            )}

            <TaskFilter
              filters={filters}
              count={active.length}
              onToggle={toggle}
              onClear={clearAll}
              note={filters.status.length ? '' : 'Showing open work only — pick statuses to widen it.'}
              extras={
                <ChipGroup label="Include">
                  <Chip
                    on={showRoutine}
                    onClick={() => setShowRoutine(!showRoutine)}
                    title="Tasks created by a routine or a day template. Hidden by default."
                  >
                    Routine chores
                  </Chip>
                  <Chip on={showNotes} onClick={() => setShowNotes(!showNotes)} title="Prose notes written on a day">
                    Notes
                  </Chip>
                </ChipGroup>
              }
            />

            <span className="at-hint">
              {canReorder
                ? 'Drag a task to reorder it, or onto another day to move it.'
                : 'Reordering is off — group by scheduled date to drag tasks into order.'}
            </span>
          </div>

          <ActiveChips chips={active} onRemove={clearChip} onClear={clearAll} />

          {list.length > 0 && (
            <div className="at-summary">
              <Progress tasks={list} className="at-prog" />
              <span className="muted at-note">{countLabel(list)}</span>
            </div>
          )}

          <form className="quick-add" onSubmit={addTask}>
            <input
              className="input"
              placeholder="New task — starts unscheduled…"
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
            <button className="btn primary" type="submit"><Icon name="plus" size={14} /> New task</button>
          </form>
        </Panel>

        {tasks.error ? (
          <Panel><Empty>{tasks.error.message}</Empty></Panel>
        ) : backlogView ? (
          <BacklogBoards
            tasks={backlogTasks}
            projects={projects.data || []}
            labels={labelsFor(settings.data)}
            board={board}
            rowProps={(t) => ({
              task: t,
              subtasks: t.subtasks || [],
              showProject: false,
              onChange: (patch, id = t.id) => save(id, patch),
              onDelete: (id = t.id) => remove(id),
              onReschedule: reschedule,
              onDropTask: dnd.onDropTask,
            })}
            onMoveToColumn={(ids, col) => dnd.onMoveToColumn(ids, col)}
          />
        ) : groups.length === 0 ? (
          <Panel><Empty>{tasks.data ? 'Nothing matches these filters.' : 'Loading…'}</Empty></Panel>
        ) : (
          groups.map((g) => (
            <Panel
              key={g.key}
              className={groupBy === 'project' ? cls(g.color) : ''}
              bodyClass="at-body"
              title={
                <>
                  {groupBy === 'project' && <span className="dot" style={{ background: 'var(--c)' }} />}
                  {g.date ? <Link to={`/day/${g.date}`} style={{ color: 'inherit' }}>{g.label}</Link> : g.label}
                  <span className="muted">({g.rows.length})</span>
                  {g.note && <span className="muted at-note">{g.note}</span>}
                </>
              }
            >
              <div className="at-groupbar">
                <Progress
                  tasks={g.rows.map((row) => row.task)}
                  color={groupBy === 'project' ? g.color : undefined}
                  className="at-prog"
                />
              </div>

              <div
                className={`at-rows ${canReorder ? '' : 'at-static'} ${over?.key === g.key && !over.id ? 'at-drop-tail' : ''}`}
                onDragOver={canReorder ? (e) => { e.preventDefault(); hover({ key: g.key, id: null }) } : undefined}
                onDrop={canReorder ? (e) => drop(e, g) : undefined}
              >
                {g.rows.length === 0 ? (
                  <Empty>Nothing matches these filters.</Empty>
                ) : g.rows.map(({ task, depth }) => (
                  <TaskLine
                    key={task.id}
                    task={task}
                    depth={depth}
                    draggable={canReorder}
                    showProject={groupBy !== 'project'}
                    className={`${drag === task.id ? 'at-dragging' : ''} ${dropClass(over, g.key, task.id)}`}
                    onChange={(patch) => save(task.id, patch)}
                    onDelete={() => remove(task.id)}
                    dragProps={{
                      onDragStart: () => setDrag(task.id),
                      onDragEnd: () => { setDrag(null); hover(null) },
                      onDragOver: canReorder ? (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const box = e.currentTarget.getBoundingClientRect()
                        hover({ key: g.key, id: task.id, before: e.clientY < box.top + box.height / 2 })
                      } : undefined,
                    }}
                  />
                ))}
              </div>
            </Panel>
          ))
        )}
      </div>

      {meeting && (
        <QuickMeeting
          onClose={() => setMeeting(false)}
          onCreated={() => { setMeeting(false); reload() }}
        />
      )}

      {importing && (
        <ExternalPicker
          onClose={() => setImporting(false)}
          onLinked={() => reload()}
        />
      )}
    </>
  )
}

/** One task: the shared row, plus the date cell this page adds to it. */
function TaskLine({
  task, depth = 0, className = '', draggable = false, showProject = true,
  onChange, onDelete, dragProps = {},
}) {
  return (
    <div
      className={`at-row ${className}`}
      style={depth ? { marginLeft: depth * 22 } : undefined}
      {...dragProps}
    >
      <TaskRow
        task={task}
        draggable={draggable}
        showProject={showProject}
        onChange={onChange}
        onDelete={onDelete}
      />
      <WhenCell task={task} onChange={onChange} />
    </div>
  )
}

/**
 * The scheduled date is a link first and a field second: the common act is
 * "take me to that day", and only the pencil opens the picker. Clearing the
 * picker unschedules, which is the only way back to the backlog from here.
 */
function WhenCell({ task, onChange }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <input
        className="input at-when-input"
        type="date"
        autoFocus
        value={task.scheduled_date || ''}
        title="Scheduled date — clear it to unschedule"
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
        onChange={(e) => {
          onChange({ scheduled_date: e.target.value || null })
          setEditing(false)
        }}
      />
    )
  }

  return (
    <div className="at-when">
      {task.scheduled_date ? (
        <Link className="at-when-link" to={`/day/${task.scheduled_date}`} title={longDate(task.scheduled_date)}>
          {shortDate(task.scheduled_date)}
        </Link>
      ) : (
        <button className="at-when-link at-unset" onClick={() => setEditing(true)}>Unscheduled</button>
      )}

      {task.status === 'moved' && task.moved_to_date && (
        <Link className="at-moved" to={`/day/${task.moved_to_date}`} title="Moved to this day">
          <Icon name="arrowRight" size={11} /> {shortDate(task.moved_to_date)}
        </Link>
      )}

      <button
        className="at-when-edit"
        title={task.scheduled_date ? 'Change the scheduled date' : 'Give this a date'}
        aria-label="Edit scheduled date"
        onClick={() => setEditing(true)}
      >
        <Icon name="today" size={12} />
      </button>
    </div>
  )
}

/** Every live filter, flattened into removable chips. */
function activeChips(filters, { search, projectId, projects, showNotes, showRoutine }) {
  const chips = []
  if (search.trim()) chips.push({ group: 'search', key: 'q', scope: 'search', label: search.trim() })
  if (projectId) {
    const project = (projects || []).find((p) => p.id === projectId)
    chips.push({ group: 'project', key: String(projectId), scope: 'project', label: project?.name || `#${projectId}` })
  }
  chips.push(...filterChips(filters))
  if (showRoutine) chips.push({ group: 'routine', key: 'on', scope: 'include', label: 'Routine chores' })
  if (showNotes) chips.push({ group: 'notes', key: 'on', scope: 'include', label: 'Notes' })
  return chips
}

function countLabel(list) {
  const open = list.filter((t) => t.kind !== 'note' && OPEN.includes(t.status)).length
  const closed = list.filter((t) => t.kind !== 'note' && CLOSED.includes(t.status)).length
  const parts = []
  if (open) parts.push(`${open} open`)
  if (closed) parts.push(`${closed} closed`)
  return parts.join(' · ')
}

/** Insert `id` into `ids` at the hovered edge, or at the end when nothing is hovered. */
function place(ids, id, at) {
  const next = ids.filter((x) => x !== id)
  const index = at ? next.indexOf(at.id) : -1
  if (index < 0) next.push(id)
  else next.splice(index + (at.before ? 0 : 1), 0, id)
  return next
}

function dropClass(over, key, id) {
  if (!over || over.key !== key || over.id !== id) return ''
  return over.before ? 'at-drop-before' : 'at-drop-after'
}

/**
 * Groups are `{ key, date, label, rows }`, where a row is `{ task, depth }`.
 * `date` is what a reorder of that group would write, so it is only meaningful
 * for the date grouping. Grouped views stay flat because a member's parent can
 * sit in a different group entirely.
 */
function buildGroups(list, mode) {
  if (mode === 'project') {
    const groups = new Map()
    for (const t of list) {
      const id = t.project_id ?? 0
      if (!groups.has(id)) {
        groups.set(id, {
          key: `p${id}`,
          date: null,
          label: t.project_name || 'No project',
          color: t.project_color,
          unfiled: !t.project_id,
          rows: [],
        })
      }
      groups.get(id).rows.push({ task: t, depth: 0 })
    }
    return [...groups.values()].sort((a, b) => a.unfiled - b.unfiled || a.label.localeCompare(b.label))
  }

  if (mode === 'date') {
    const groups = new Map()
    for (const t of list) {
      const date = t.scheduled_date || null
      const key = date || 'unscheduled'
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          date,
          label: date ? longDate(date) : 'Unscheduled',
          note: date ? relative(date) : 'no date set',
          rows: [],
        })
      }
      groups.get(key).rows.push({ task: t, depth: 0 })
    }
    return [...groups.values()].sort((a, b) =>
      (a.date === null) - (b.date === null) || a.date.localeCompare(b.date))
  }

  return [{ key: 'all', date: null, label: 'All tasks', rows: nest(list) }]
}

/**
 * Children indented under their parent. A child whose parent was filtered out
 * stays at the top level, and the `seen` guard means a parent_id cycle — which
 * PATCH /tasks/:id does not reject, unlike /nest — degrades instead of hanging.
 */
function nest(list) {
  const present = new Set(list.map((t) => t.id))
  const children = new Map()
  for (const t of list) {
    const parent = t.parent_id && present.has(t.parent_id) ? t.parent_id : null
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(t)
  }

  const rows = []
  const seen = new Set()
  const walk = (parent, depth) => {
    for (const t of children.get(parent) || []) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      rows.push({ task: t, depth })
      walk(t.id, depth + 1)
    }
  }
  walk(null, 0)
  for (const t of list) if (!seen.has(t.id)) rows.push({ task: t, depth: 0 })
  return rows
}
