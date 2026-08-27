import { useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import Progress, { CLOSED, tally } from '../components/Progress.jsx'
import TaskFilter, {
  ActiveChips, emptyFilters, filterChips, taskFilter, toggleFilter,
} from '../components/TaskFilter.jsx'
import QuickMeeting from '../components/QuickMeeting.jsx'
import TaskRow, { nestTasks, visibleIds } from '../components/TaskRow.jsx'
import {
  SelectionBar, SelectionProvider, bulkPatch, draggedIds, isTaskDrag,
} from '../components/Selection.jsx'
import { useToast } from '../components/Toast.jsx'
import { ColorPicker, Empty, Field, Panel, cls, initials } from '../components/ui.jsx'
import { Rich, RichEditor, RichLine } from '../lib/rich.jsx'
import { api, useApi } from '../lib/api.js'
import { BACKLOG_QUERY, isBacklogTask } from '../lib/backlog.js'
import ColumnBoard from '../components/ColumnBoard.jsx'
import { columnLabels as labelsFor } from '../lib/columns.js'
import { makeTaskDnd } from '../lib/taskDnd.js'
import { taskOps, useUndo } from '../lib/undo.jsx'
import { relative, shortDate } from '../lib/dates.js'
import '../styles/projects.css'
// The Light/Deep control below is the one the Routines page already uses for the
// same setting — same markup, same classes. Imported rather than copied so the
// two cannot drift into two slightly different looks for one idea.
import '../styles/routines.css'
import { usePageTitle } from '../lib/title.js'
import { useVimActions } from '../lib/vim.jsx'
import { makeVimActions } from '../lib/vimActions.js'

const STATUSES = ['active', 'planned', 'done', 'archived']

// Every task here is already this project's, and a project spans days rather
// than sitting on one, so the project and date groups have nothing to say.
const NO_FILTERS = emptyFilters(['priority', 'status', 'time', 'due'])

/**
 * The order GET /projects/:id already returns its tasks in, reapplied once the
 * project's meetings are merged into the same list.
 */
const byPlan = (a, b) =>
  (a.status === 'done') - (b.status === 'done')
  || (a.scheduled_date == null) - (b.scheduled_date == null)
  || String(a.scheduled_date).localeCompare(String(b.scheduled_date))
  || a.sort - b.sort

/** What the colour swatch means, given that a type can be driving it. */
function colourHint(project, type) {
  if (!type) return 'No type, so this colour is yours to set.'
  if (project.color !== type.color) return `Set by hand — overriding the ${type.name} colour.`
  return `Follows the ${type.name} type. Pick a colour to override it.`
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const project = useApi(`/projects/${id}`, [id])
  const types = useApi('/projects/types')
  // GET /projects/:id returns only kind='task' rows, so a meeting filed under
  // this project is invisible in that response — including the one this page's
  // own button just created. Meetings are work that occupies the day like any
  // other task, so they are fetched here and merged into the same list.
  const filed = useApi(`/tasks?project_id=${id}`, [id])
  // Asked of the server rather than sieved out of the response above, so this
  // panel and the day view's backlog are answering the same question of the
  // same table — see lib/backlog.js.
  const backlog = useApi(`/tasks?${BACKLOG_QUERY}&project_id=${id}`, [id])
  // In the URL, not in state: a refresh on the Notes tab used to come back on
  // Tasks, and a link to a project's backlog needs somewhere to point.
  const [params, setParams] = useSearchParams()
  const TABS = ['tasks', 'backlog', 'milestones', 'notes']
  const wanted = params.get('tab')
  const tab = TABS.includes(wanted) ? wanted : 'tasks'
  const setTab = (t) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (t === 'tasks') next.delete('tab')
    else next.set('tab', t)
    return next
  }, { replace: true })
  const settings = useApi('/settings')
  // The board is the point of the tab, so it is what you get first; the list is
  // there for when you want to read titles rather than weigh them.
  const [board, setBoard] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [noteDrag, setNoteDrag] = useState(null)
  const [noteOver, setNoteOver] = useState(null)
  const [draft, setDraft] = useState('')
  const [mDraft, setMDraft] = useState('')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [over, setOver] = useState(false)
  const [meeting, setMeeting] = useState(false)
  const undo = useUndo()
  const toast = useToast()

  // Above the early returns. A hook after one runs on some renders and not
  // others, and the count changing between them is a hard React error — which
  // is exactly how this page would have white-screened the moment it loaded.
  usePageTitle(project.data?.name)

  // Held in a ref so the block below — which runs before `reschedule` is
  // declared — reaches whatever the latest render defined. Declared HERE, above
  // the early returns: a hook after one runs on some renders and not others,
  // which is a hard React error and white-screened this page outright.
  const rescheduleRef = useRef(null)

  // The same handlers the buttons use, lent to the keyboard. Read from
  // project.data when called rather than closed over, because this runs on
  // renders that have no data yet.
  useVimActions(makeVimActions({
    tasks: project.data?.tasks || [],
    date: null,
    undo,
    refresh: () => { project.reload(); filed.reload(); backlog.reload() },
    patch: (id, body) => api.patch(`/tasks/${id}`, body).then(() => project.reload()),
    remove: (id) => api.del(`/tasks/${id}`).then(() => project.reload()),
    reschedule: (task, to, copy) => rescheduleRef.current?.(task, to, copy),
  }))

  if (project.error) return <div className="page"><p className="muted">{project.error.message}</p></div>
  if (!project.data) return <div className="page"><p className="muted">Loading…</p></div>

  const p = project.data
  const reload = () => { project.reload(); filed.reload(); backlog.reload() }
  const patch = async (body) => { await api.patch(`/projects/${p.id}`, body); project.reload() }

  // GET /api/projects/:id carries type_id but neither the type's name nor its
  // colour, so the type list is what turns the id into something to show.
  const typeList = types.data || []
  const type = typeList.find((t) => t.id === p.type_id) || null
  const isDeep = p.default_intensity === 'deep'

  // Notes are prose filed against the project — no status to close, no time to
  // estimate, nothing to tick off — so they belong on the Notes tab rather than
  // in the task list. Splitting by kind here as well as on the server means an
  // older response still lands every row in the right place.
  const tasks = [
    ...p.tasks.filter((t) => t.kind === 'task'),
    ...(filed.data || []).filter((t) => t.kind === 'meeting'),
  ].sort(byPlan)
  const notes = p.notes || p.tasks.filter((t) => t.kind === 'note')

  // A note with no day is one of this project's own sections; a dated one was
  // written on that day and merely tagged with the project.
  const allSections = notes.filter((n) => !n.scheduled_date)
  const sections = allSections.filter((n) => showArchived || !n.archived)
  const archivedCount = allSections.filter((n) => n.archived).length
  const captured = notes.filter((n) => n.scheduled_date)
  // What the tab badge counts. An archived section is put away, so counting it
  // would mean the number never went down when you filed one.
  const liveNotes = notes.filter((n) => !n.archived)

  const shown = tasks.filter(taskFilter(filters))
  const chips = filterChips(filters)
  const toggle = (group, key) => setFilters((f) => toggleFilter(f, group, key))
  const clearFilters = () => setFilters(NO_FILTERS)

  const counts = tally(tasks)
  const backlogTasks = (backlog.data || []).filter(isBacklogTask)

  // Through taskOps, for the same reason as the all-tasks list: a bare PATCH
  // records nothing, so Ctrl-Z after editing here did nothing at all.
  const ops = taskOps(undo, reload)
  const saveTask = async (taskId, body) => {
    const task = (project.data?.tasks || []).find((t) => t.id === taskId)
    if (task) await ops.patch(task, body)
    else { await api.patch(`/tasks/${taskId}`, body); reload() }
  }
  const removeTask = async (taskId) => { await api.del(`/tasks/${taskId}`); reload() }

  const rowProps = (t) => ({
    task: t,
    subtasks: t.subtasks || [],
    showProject: false,
    onChange: (body, taskId = t.id) => saveTask(taskId, body),
    onDelete: (taskId = t.id) => removeTask(taskId),
    onReschedule: reschedule,
    // The same row-level drop the day view has. Without it a backlog board was
    // a three-column view you could not nest or reorder in — only drop into a
    // column — which is the difference the two views used to have.
    onDropTask: dnd.onDropTask,
  })

  // Dateless work, so no date and no sections travel with a drop; `columns`
  // says this view lays work out in three boxes even though no section does.
  const dnd = makeTaskDnd({
    tasks: backlogTasks, date: null, known: [...tasks, ...backlogTasks],
    columns: true, undo, refresh: reload,
  })

  /**
   * Give a dateless task a day, or put a copy of it on one. The server does the
   * work: either way the task's section has to be found or made on the far day,
   * and a plain date patch would drop it into that day's loose list.
   */
  rescheduleRef.current = reschedule

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

  /**
   * Dropping on the heading files tasks here. The day they are scheduled on is
   * left alone — filing work under a project is not a reason to unschedule it.
   */
  async function fileHere(ids) {
    if (!ids.length) return
    await bulkPatch(ids, { project_id: p.id }, { known: tasks, label: `file ${ids.length} tasks`, undo })
    reload()
    toast({ message: `Filed ${ids.length} task${ids.length === 1 ? '' : 's'} under ${p.name}` })
  }

  /**
   * Move one note section above or below another.
   *
   * The whole run is renumbered from the order it is drawn in, rather than
   * nudging one row's `sort`: the sections already come back ordered by `sort`,
   * so writing positions for all of them is what makes the new order the one
   * that survives a reload.
   */
  async function reorderNotes(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return
    // Every section, not just the visible ones. The drag can only be between
    // two that are on screen, but renumbering the visible ones alone would
    // leave the archived ones holding stale positions among them — and they
    // would surface somewhere arbitrary the moment they were brought back.
    const ids = allSections.map((n) => n.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    // ids alone: /tasks/reorder only writes date/section/parent when it is
    // given them, so this cannot move a note off the project by accident.
    await api.post('/tasks/reorder', { ids })
    reload()
  }

  async function addTask(e) {
    e.preventDefault()
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await api.post('/tasks', { title, project_id: p.id })
    reload()
  }

  async function addMilestone(e) {
    e.preventDefault()
    const title = mDraft.trim()
    if (!title) return
    setMDraft('')
    await api.post(`/projects/${p.id}/milestones`, { title })
    project.reload()
  }

  /**
   * A note section is a `kind='note'` row with no day. That reuses the note
   * machinery whole — search, backlinks, images — for the price of one row, and
   * having no day is exactly what makes it the project's rather than a day's.
   */
  async function addNoteSection() {
    await api.post('/tasks', {
      title: 'New section',
      kind: 'note',
      project_id: p.id,
      scheduled_date: null,
    })
    project.reload()
  }

  return (
    <SelectionProvider>
      <header className="topbar">
        <Link to="/projects" className="btn ghost sm"><Icon name="left" size={14} /> Projects</Link>
        <span className="dot" style={{ background: `var(--${p.color})` }} />
        <h1
          className={`pj-title ${over ? 'sel-drop-on' : ''}`}
          title="Drop tasks here to file them under this project"
          onDragOver={(e) => { if (!isTaskDrag(e)) return; e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { setOver(false); fileHere(draggedIds(e)) }}
        >
          <RichLine value={p.name} onChange={(name) => name.trim() && patch({ name })} />
        </h1>
        {type && <span className={`chip ${cls(type.color)}`}>{type.name}</span>}
        <span className="spacer" />
        <select className="input select" style={{ width: 120 }} value={p.status} onChange={(e) => patch({ status: e.target.value })}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </header>

      <div className="page detail-grid">
        <div className="col" style={{ gap: 16 }}>
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
                {t === 'tasks' && counts.openCount > 0 && <span className="muted"> {counts.openCount}</span>}
                {t === 'backlog' && backlogTasks.length > 0 && (
                  <span className="muted"> {backlogTasks.length}</span>
                )}
                {t === 'notes' && liveNotes.length > 0 && (
                  <span className="muted"> {liveNotes.length}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'tasks' && (
            <Panel bodyClass="">
              <div className="pj-toolbar">
                <TaskFilter
                  filters={filters}
                  count={chips.length}
                  onToggle={toggle}
                  onClear={clearFilters}
                />
                <span className="muted at-note">
                  {shown.length === tasks.length
                    ? `${tasks.length} tasks`
                    : `${shown.length} of ${tasks.length} tasks`}
                </span>
                <span className="spacer" />
                {/* Filed under this project from the start — a meeting about the
                    work is part of the work, and counts in the same totals. */}
                <button className="btn ghost sm" onClick={() => setMeeting(true)}>
                  <Icon name="clock" size={12} /> New meeting
                </button>
                <Progress tasks={shown} color={p.color} className="pj-prog" />
              </div>

              <ActiveChips chips={chips} onRemove={(c) => toggle(c.group, c.key)} onClear={clearFilters} />

              <div className="pj-tasks">
                {tasks.length === 0 ? (
                  <Empty>No tasks in this project yet.</Empty>
                ) : shown.length === 0 ? (
                  <Empty>Nothing matches these filters.</Empty>
                ) : (
                  <TaskList tasks={shown} rowProps={rowProps} />
                )}
              </div>

              <form className="quick-add" onSubmit={addTask}>
                <input
                  className="input"
                  placeholder="Add a task to this project…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button className="btn primary" type="submit"><Icon name="plus" size={14} /> Add</button>
              </form>
            </Panel>
          )}

          {tab === 'backlog' && (
            <Panel bodyClass="">
              <div className="pj-toolbar">
                <span className="muted at-note">
                  {backlogTasks.length === 0
                    ? 'Nothing waiting'
                    : `${backlogTasks.length} task${backlogTasks.length === 1 ? '' : 's'} without a day`}
                </span>
                <span className="spacer" />
                <button className="btn ghost sm" onClick={() => setBoard(!board)}>
                  <Icon name={board ? 'list' : 'columns'} size={12} />
                  {board ? ' As a list' : ' As a board'}
                </button>
              </div>

              <div className="pj-tasks">
                {backlogTasks.length === 0 ? (
                  <Empty>Nothing waiting. Every open task here has a day.</Empty>
                ) : board ? (
                  <ColumnBoard
                    tasks={backlogTasks}
                    labels={labelsFor(settings.data)}
                    rowProps={rowProps}
                    onMoveToColumn={(ids, col) => dnd.onMoveToColumn(ids, col)}
                  />
                ) : (
                  <TaskList tasks={backlogTasks} rowProps={rowProps} />
                )}
              </div>

              {/* The same add as the Tasks tab: a new task is created without
                  a date, so it is already a backlog task. */}
              <form className="quick-add" onSubmit={addTask}>
                <input
                  className="input"
                  placeholder="Add a task with no day yet…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button className="btn primary" type="submit"><Icon name="plus" size={14} /> Add</button>
              </form>
            </Panel>
          )}

          {tab === 'milestones' && (
            <Panel bodyClass="">
              <div style={{ padding: '6px 14px' }}>
                {p.milestones.length === 0 && <Empty>No milestones. Add dated checkpoints to see them on the calendar.</Empty>}
                {p.milestones.map((m) => (
                  <div key={m.id} className="row" style={{ padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
                    <button
                      className="task-check"
                      style={{ marginTop: 0, background: m.done ? 'var(--green)' : undefined, borderColor: m.done ? 'var(--green)' : undefined, color: m.done ? '#fff' : 'transparent' }}
                      onClick={async () => {
                        await api.patch(`/projects/milestones/${m.id}`, { done: m.done ? 0 : 1 })
                        project.reload()
                      }}
                    >
                      <Icon name="check" size={11} strokeWidth={3} />
                    </button>
                    <span style={{ flex: 1, textDecoration: m.done ? 'line-through' : undefined, color: m.done ? 'var(--ink-3)' : undefined }}>
                      <RichLine
                        value={m.title}
                        onChange={async (title) => {
                          if (!title.trim()) return
                          await api.patch(`/projects/milestones/${m.id}`, { title })
                          project.reload()
                        }}
                      />
                    </span>
                    {m.due_date && !m.done && <span className="muted" style={{ fontSize: 12 }}>{relative(m.due_date)}</span>}
                    <input
                      className="input"
                      type="date"
                      style={{ width: 140 }}
                      value={m.due_date || ''}
                      onChange={async (e) => {
                        await api.patch(`/projects/milestones/${m.id}`, { due_date: e.target.value || null })
                        project.reload()
                      }}
                    />
                    <button
                      className="btn ghost sm danger"
                      onClick={async () => { await api.del(`/projects/milestones/${m.id}`); project.reload() }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <form className="quick-add" onSubmit={addMilestone}>
                <input
                  className="input"
                  placeholder="Add a milestone…"
                  value={mDraft}
                  onChange={(e) => setMDraft(e.target.value)}
                />
                <button className="btn primary" type="submit"><Icon name="plus" size={14} /> Add</button>
              </form>
            </Panel>
          )}

          {tab === 'notes' && (
            <>
              <Panel title="Overview">
                <RichEditor
                  value={p.description}
                  onChange={(description) => patch({ description })}
                  placeholder="Scope, decisions, references. Markdown + LaTeX supported."
                  rows={10}
                  draftKey={`project:${p.id}`}
                />
              </Panel>

              {sections.map((note) => (
                <NoteSection
                  key={note.id}
                  note={note}
                  dragging={noteDrag === note.id}
                  over={noteOver === note.id}
                  onDragStart={() => setNoteDrag(note.id)}
                  onDragEnd={() => { setNoteDrag(null); setNoteOver(null) }}
                  onDragOver={() => setNoteOver(note.id)}
                  // The id comes off the dataTransfer, not off `noteDrag`.
                  // dragstart only *asks* React to store the id; if the drop
                  // lands before that render commits, the state read here is
                  // still null and the reorder is silently dropped. The
                  // dataTransfer is written synchronously and always has it.
                  onDropOn={(from) => {
                    setNoteDrag(null)
                    setNoteOver(null)
                    reorderNotes(from ?? noteDrag, note.id)
                  }}
                  onChange={(body) => saveTask(note.id, body)}
                  onDelete={async () => {
                    if (!confirm(`Delete the section "${note.title || 'Untitled'}" and its notes?`)) return
                    await removeTask(note.id)
                  }}
                />
              ))}

              <div className="row" style={{ gap: 'var(--space-4)' }}>
                <button className="btn ghost" onClick={addNoteSection}>
                  <Icon name="plus" size={14} /> Add a note section
                </button>
                {/* Only when there is something to show. A switch for an empty
                    archive is a control that does nothing. */}
                {archivedCount > 0 && (
                  <button
                    className={`btn ghost sm ${showArchived ? 'is-on' : ''}`}
                    aria-pressed={showArchived}
                    title={showArchived
                      ? 'Hide archived sections'
                      : 'Show archived sections as well'}
                    onClick={() => setShowArchived(!showArchived)}
                  >
                    <Icon name="templates" size={13} /> Archived
                    <span className="muted"> {archivedCount}</span>
                  </button>
                )}
              </div>

              {captured.length > 0 && (
                <Panel
                  title={<>Written on a day <span className="muted">{captured.length}</span></>}
                >
                  {/* Read-only on purpose: a note's one-line `title` summary is
                      kept in step with its body by the row that owns it, so
                      editing belongs on the day rather than here. */}
                  <p className="pj-hint pj-captured-note">
                    Notes filed against this project from a day. They still belong to that
                    day — the date opens it.
                  </p>
                  <div className="col" style={{ gap: 10 }}>
                    {captured.map((note) => (
                      <article key={note.id} className="pj-captured">
                        <Link to={`/day/${note.scheduled_date}`} className="chip">
                          {shortDate(note.scheduled_date)}
                        </Link>
                        <Rich className="pj-captured-body" text={note.notes || note.title} />
                      </article>
                    ))}
                  </div>
                </Panel>
              )}
            </>
          )}
        </div>

        <aside className="col" style={{ gap: 16 }}>
          <Panel title="Progress">
            <Progress tasks={tasks} color={p.color} />
            <p className="pj-hint">
              {counts.doneCount} of {counts.doneCount + counts.openCount} tasks done
              {counts.total > 0 ? ', by estimated time' : ' — no estimates yet, so this counts tasks'}
            </p>
          </Panel>

          <BacklogPanel tasks={backlogTasks} rowProps={rowProps} />

          <Panel title="Details">
            <div className="col" style={{ gap: 10 }}>
              <Field label="Type">
                <select
                  className="input select"
                  value={p.type_id ?? ''}
                  onChange={(e) => patch({ type_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">No type</option>
                  {typeList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Colour">
                <ColorPicker value={p.color} onChange={(color) => patch({ color })} />
                <div className="pj-colour">
                  <span className="pj-hint">{colourHint(p, type)}</span>
                  {/* Re-sending type_id is what makes the server re-adopt the
                      type's colour — there is no separate reset to call. */}
                  {type && p.color !== type.color && (
                    <button className="btn ghost sm" onClick={() => patch({ type_id: type.id })}>
                      Use the {type.name} colour
                    </button>
                  )}
                </div>
              </Field>
              {/*
                * What a new task in this project costs in attention, set once
                * here instead of on every task — tagging each one by hand is what
                * kills these systems. POST /api/tasks reads it whenever a task is
                * created with a project and no intensity of its own.
                *
                * Changing it deliberately does NOT rewrite the tasks that already
                * exist. A created task is an independent instance from the moment
                * it is written — the same rule that stops renaming a routine item
                * from renaming yesterday's chore — and the dashboard totals deep
                * minutes over the last fourteen days. Restating this default
                * would silently rewrite that history, so the record of how much
                * deep work was actually done would change to match a decision
                * made today. Existing tasks keep their own chip, which is still
                * one click each on the row.
                */}
              <Field label="New tasks">
                <div className="rt-seg" role="group" aria-label="Default intensity">
                  <button
                    className={`btn ghost sm ${isDeep ? '' : 'is-on'}`}
                    aria-pressed={!isDeep}
                    title="Light — chores and admin, which never draw on the thinking budget"
                    onClick={() => patch({ default_intensity: 'light' })}
                  >
                    Light
                  </button>
                  <button
                    className={`btn ghost sm ${isDeep ? 'is-deep-on' : ''}`}
                    aria-pressed={isDeep}
                    title="Deep — a new task here counts toward the day's thinking budget"
                    onClick={() => patch({ default_intensity: 'deep' })}
                  >
                    Deep
                  </button>
                </div>
                <span className="pj-hint">
                  {isDeep
                    ? 'New tasks here start as deep work. Tasks that already exist keep what they have.'
                    : 'New tasks here start light. Mark the deep ones from the task row.'}
                </span>
              </Field>
              <Field label="Start">
                <input className="input" type="date" value={p.start_date || ''}
                  onChange={(e) => patch({ start_date: e.target.value || null })} />
              </Field>
              <Field label="Target date">
                <input className="input" type="date" value={p.due_date || ''}
                  onChange={(e) => patch({ due_date: e.target.value || null })} />
              </Field>
            </div>
          </Panel>

          {p.people.length > 0 && (
            <Panel title="People">
              <div className="col" style={{ gap: 6 }}>
                {p.people.map((person) => (
                  <Link key={person.id} to={`/people/${person.id}`} className="row" style={{ color: 'inherit' }}>
                    <span className={`avatar ${cls(person.color)}`} style={{ width: 24, height: 24, flexBasis: 24, fontSize: 10 }}>
                      {initials(person.name)}
                    </span>
                    {person.name}
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          <button
            className="btn danger"
            onClick={async () => {
              // Ask the server what would actually go, so the warning is specific.
              const impact = await api.get(`/projects/${p.id}/impact`)
              const parts = [
                impact.tasks ? `${impact.tasks} task${impact.tasks === 1 ? '' : 's'}` : null,
                impact.notes ? `${impact.notes} note${impact.notes === 1 ? '' : 's'}` : null,
                impact.milestones ? `${impact.milestones} milestone${impact.milestones === 1 ? '' : 's'}` : null,
              ].filter(Boolean)
              const what = parts.length ? ` This also deletes ${parts.join(', ')}.` : ''
              if (!confirm(`Delete "${p.name}"?${what} This cannot be undone.`)) return
              await api.del(`/projects/${p.id}`)
              navigate('/projects')
            }}
          >
            <Icon name="trash" size={14} /> Delete project
          </button>
        </aside>
      </div>

      <SelectionBar tasks={tasks} onDone={reload} />

      {meeting && (
        <QuickMeeting
          project={p}
          onClose={() => setMeeting(false)}
          onCreated={() => { setMeeting(false); reload() }}
        />
      )}
    </SelectionProvider>
  )
}

/**
 * The unscheduled half of a project: open work that has never been given a day.
 * The Tasks tab does list these too, at the bottom where the undated sort, but
 * that is exactly where a long project buries them — a panel of their own is
 * the only place they are the subject rather than the remainder.
 *
 * Rows are the ordinary TaskRow, so giving one a date from here is the same
 * gesture as anywhere else and the row simply leaves the list afterwards.
 */
function BacklogPanel({ tasks, rowProps }) {
  const tree = nestTasks(tasks)
  const ids = visibleIds(tree)

  return (
    <Panel
      title={<>Backlog <span className="muted">({tasks.length})</span></>}
      bodyClass="pj-tasks"
    >
      {tasks.length === 0
        ? <Empty>Nothing waiting. Every open task here has a day.</Empty>
        : tree.map((t) => <TaskRow key={t.id} {...rowProps(t)} listIds={ids} />)}
    </Panel>
  )
}

/**
 * One note section: an editable heading over a body, backed by a single
 * `kind='note'` row — `title` is the heading and `notes` the prose, the same
 * two columns every other note in the app uses.
 */
function NoteSection({
  note, onChange, onDelete,
  dragging, over, onDragStart, onDragEnd, onDragOver, onDropOn,
}) {
  // Draggable only while the grip is held. The body is a text editor, and a
  // panel that is draggable everywhere cannot have its prose selected.
  const [armed, setArmed] = useState(false)

  return (
    <Panel
      className={[
        'pj-note-sec',
        dragging ? 'is-dragging' : '',
        over ? 'is-over' : '',
        note.archived ? 'is-archived' : '',
      ].filter(Boolean).join(' ')}
      draggable={armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/note-section-id', String(note.id))
        onDragStart?.()
      }}
      onDragEnd={() => { setArmed(false); onDragEnd?.() }}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.() }}
      onDrop={(e) => {
        e.preventDefault()
        onDropOn?.(Number(e.dataTransfer.getData('text/note-section-id')) || null)
      }}
      title={
        <span className="pj-title pj-section-title">
          <span
            className="pj-note-grip"
            title="Drag to reorder this section"
            onMouseDown={() => setArmed(true)}
            onMouseUp={() => setArmed(false)}
          >
            <Icon name="grip" size={13} />
          </span>
          <RichLine
            value={note.title}
            onChange={(title) => onChange({ title })}
            placeholder="Section title"
          />
        </span>
      }
      actions={
        <>
          {/* Before delete, and beside it: a section stops being current long
              before it stops being worth keeping, and deleting one takes its
              prose with it. */}
          <button
            className={`btn ghost sm ${note.archived ? 'is-on' : ''}`}
            aria-pressed={!!note.archived}
            title={note.archived ? 'Bring this section back out of the archive' : 'Archive this section'}
            onClick={() => onChange({ archived: note.archived ? 0 : 1 })}
          >
            <Icon name="templates" size={13} />
          </button>
          <button className="btn ghost sm danger" title="Delete this section" onClick={onDelete}>
            <Icon name="trash" size={13} />
          </button>
        </>
      }
    >
      <RichEditor
        value={note.notes}
        onChange={(notes) => onChange({ notes })}
        placeholder="Markdown, images, links and $math$ all work. [[ links a day or project."
        rows={8}
        draftKey={`task:${note.id}`}
      />
    </Panel>
  )
}

/**
 * Unfinished work first, finished behind a disclosure — the same split the day
 * view uses, so a long-lived project opens on what is left rather than on a
 * wall of ticks.
 */
function TaskList({ tasks, rowProps }) {
  const [showDone, setShowDone] = useState(false)
  const tree = nestTasks(tasks)
  const open = tree.filter((t) => !CLOSED.includes(t.status))
  const closed = tree.filter((t) => CLOSED.includes(t.status))

  // Hidden rows are outside any range a shift-click could mean.
  const ids = [...visibleIds(open), ...(showDone ? visibleIds(closed) : [])]

  return (
    <>
      {open.map((t) => <TaskRow key={t.id} {...rowProps(t)} listIds={ids} />)}
      {closed.length > 0 && (
        <>
          <div className="hr" />
          <button className="done-toggle" onClick={() => setShowDone(!showDone)}>
            <Icon name={showDone ? 'chevronDown' : 'right'} size={12} />
            {closed.length} done
          </button>
          {showDone && closed.map((t) => <TaskRow key={t.id} {...rowProps(t)} listIds={ids} />)}
        </>
      )}
    </>
  )
}
