import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import TaskRow, { branchMinutes, nestTasks, spanMinutes, visibleIds } from '../components/TaskRow.jsx'
import QuickMeeting from '../components/QuickMeeting.jsx'
import {
  SelectionBar, SelectionProvider, bulkPatch, draggedIds, isSectionDrag, isTaskDrag,
} from '../components/Selection.jsx'
import { Empty, Panel, ProjectSelect, cls } from '../components/ui.jsx'
import Progress, { tally } from '../components/Progress.jsx'
import DeepBar from '../components/DeepBar.jsx'
import { PRIORITIES, PriorityChip, PriorityIcon } from '../components/Priority.jsx'
import { useToast } from '../components/Toast.jsx'
import { RichEditor } from '../lib/rich.jsx'
import { taskOps, useUndo } from '../lib/undo.jsx'
import { api, useApi } from '../lib/api.js'
import { BACKLOG_QUERY, isBacklogTask } from '../lib/backlog.js'
import { addDays, longDate, minutesLabel, shortDate, today } from '../lib/dates.js'

const UNSECTIONED = 'loose'

/** Rank for sorting; anything unrecognised sits with medium. */
const PRI_RANK = { highest: 0, high: 1, medium: 2, low: 3, lowest: 4 }
const byPriority = (a, b) =>
  (PRI_RANK[a.priority] ?? 2) - (PRI_RANK[b.priority] ?? 2) || a.sort - b.sort || a.id - b.id

/**
 * Which of the three boxes a task belongs in. An explicit col_index wins;
 * otherwise it falls out of the duration, so tasks land somewhere sensible
 * without the user placing every one by hand.
 */
function columnByMinutes(m) {
  if (!m) return 0
  if (m <= 10) return 0
  if (m <= 30) return 1
  return 2
}

/** A task's own time: an explicit estimate, else the span between its clock times. */
const ownMinutes = (t) => t.estimate_min || spanMinutes(t.start_time, t.end_time) || 0

/**
 * Which of the three boxes a task belongs in. An explicit col_index wins;
 * otherwise it falls out of the duration, so tasks land somewhere sensible
 * without the user placing every one by hand.
 *
 * A parent is sized by its whole subtree, not by its own estimate. A ten-minute
 * task carrying two hours of children is a two-hour commitment, and filing it
 * under "quick" misrepresents the day.
 */
function columnFor(task) {
  if (task.col_index != null) return Math.min(2, Math.max(0, task.col_index))
  return columnByMinutes(ownMinutes(task) + branchMinutes(task.subtasks || []))
}

export default function Day() {
  const { date } = useParams()
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
  const [backlogBy, setBacklogBy] = useState(() => localStorage.getItem('backlog_by') || 'priority')
  const undo = useUndo()
  const toast = useToast()

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

  const columnLabels = (() => {
    try {
      const parsed = JSON.parse(settings.data?.column_labels || '[]')
      return parsed.length === 3 ? parsed : ['Quick', 'Focused', 'Deep']
    } catch { return ['Quick', 'Focused', 'Deep'] }
  })()

  function refresh() {
    day.reload()
    backlog.reload()
    doing.reload()
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
  const dropTasks = async (ids, patch, label) => {
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
    if (rest.length) await bulkPatch(rest, patch, { known, label, undo })
    refresh()
  }

  /** Deleting is undoable both by Ctrl-Z and by the toast it leaves behind. */
  const removeTask = async (id) => {
    const task = d.tasks.find((t) => t.id === id)
    if (!task) return
    const restore = await ops.remove(task)
    toast({
      message: `Deleted "${(task.title || 'note').slice(0, 40)}"`,
      action: { label: 'Undo', onClick: async () => { await restore(); refresh() } },
    })
  }

  /**
   * One gesture, two outcomes: a drop across the middle of a row nests, a drop
   * near either edge reorders within that row's own sibling group.
   */
  /**
   * Everything a move can disturb, captured so it can be put back. A drag
   * rewrites `sort` across a whole sibling group and may change the parent,
   * section and column of the row that moved — none of which a PATCH-based
   * snapshot would cover, which is why moves used to be absent from the undo
   * stack entirely and Ctrl-Z after a drag reversed some earlier, unrelated
   * edit instead.
   */
  function snapshot(ids) {
    return ids
      .map((id) => d.tasks.find((t) => t.id === id))
      .filter(Boolean)
      .map((t) => ({
        id: t.id,
        sort: t.sort,
        parent_id: t.parent_id ?? null,
        section_id: t.section_id ?? null,
        col_index: t.col_index ?? null,
        scheduled_date: t.scheduled_date ?? null,
      }))
  }

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

  async function onDropTask(draggedId, target, zone) {
    if (zone === 'nest') {
      const before = snapshot([draggedId])
      const nest = async () => { await api.post(`/tasks/${draggedId}/nest`, { parent_id: target.id }) }
      await nest()
      undo?.record?.({ label: 'nest', undo: restoreAll(before), redo: nest })
      refresh()
      return
    }

    const siblings = d.tasks
      .filter((t) => (t.parent_id ?? null) === (target.parent_id ?? null)
        && (t.section_id ?? null) === (target.section_id ?? null))
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((t) => t.id)
      .filter((id) => id !== draggedId)

    const at = siblings.indexOf(target.id)
    siblings.splice(zone === 'before' ? at : at + 1, 0, draggedId)

    // Land in the target's column too, when the section has columns at all.
    // Dropping onto a row is the *only* way into a column that is full to the
    // bottom of its section — there is no empty space left below the last row
    // to hit the column's own drop zone — so without this the commonest drop in
    // a busy day silently put the task back where it came from.
    const section = d.sections.find((s) => s.id === target.section_id)
    const intoColumns = section?.layout === 'columns'

    const before = snapshot([draggedId, ...siblings])
    const move = async () => {
      await api.post('/tasks/reorder', {
        ids: siblings,
        scheduled_date: date,
        section_id: target.section_id ?? null,
        parent_id: target.parent_id ?? null,
        // Named, so the server applies the column to this one row rather than
        // to every sibling in the list.
        ...(intoColumns ? { col_index: columnFor(target), moved_id: draggedId } : {}),
      })
    }
    await move()
    undo?.record?.({ label: 'move', undo: restoreAll(before), redo: move })
    refresh()
  }

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
    autoEdit: task.id === justAdded,
  })

  async function addChild(parent) {
    const created = await api.post('/tasks', {
      title: 'New subtask',
      scheduled_date: date,
      project_id: parent.project_id,
      section_id: parent.section_id,
    })
    await api.post(`/tasks/${created.id}/nest`, { parent_id: parent.id })
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

  const backlogTasks = (backlog.data || []).filter(isBacklogTask).sort(
    backlogBy === 'project'
      ? (a, b) => (a.project_name || '~').localeCompare(b.project_name || '~') || byPriority(a, b)
      : byPriority
  )
  const load = d.tasks
    .filter((t) => t.kind !== 'note' && (t.status === 'todo' || t.status === 'doing'))
    .reduce((sum, t) => sum + (t.estimate_min || 0), 0)
  const openCount = d.tasks.filter((t) => t.kind !== 'note' && (t.status === 'todo' || t.status === 'doing')).length

  return (
    <SelectionProvider>
    <div className="day-shell">
      <header className="topbar">
        <div className="daynav">
          <button className="btn ghost sm" onClick={() => navigate(`/day/${addDays(date, -1)}`)} aria-label="Previous day">
            <Icon name="left" size={15} />
          </button>
          <button className="btn ghost sm" onClick={() => navigate(`/day/${addDays(date, 1)}`)} aria-label="Next day">
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

      <div className="day-wrap">
        <div className="day-col">
          {scheduled.length > 0 && (
            <Panel title={<><Icon name="clock" size={14} /> Schedule</>}>
              {scheduled.map((e) => (
                <div key={e.id} className={`event ${cls(e.project_color)}`}>
                  <span className="time">{e.start_time || '—'}</span>
                  <div style={{ flex: 1 }}>
                    <div className="etitle">{e.title}</div>
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
              onDelete={async () => { await api.del(`/sections/${section.id}`); refresh() }}
              onDropLoose={(ids) =>
                dropTasks(ids, { section_id: section.id, scheduled_date: date }, `move to ${section.name}`)}
              onMoveToColumn={(ids, col) => dropTasks(
                ids,
                { col_index: col, section_id: section.id, scheduled_date: date },
                `move to ${columnLabels[col]}`,
              )}
            />
          ))}

          <Panel
            title={
              <>
                Tasks <span className="muted">({openCount})</span>
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

        <aside className="day-aside">
          {d.routines.length > 0 && (
            <Panel title={<><Icon name="today" size={14} /> Routines</>}>
              <div className="col" style={{ gap: 6 }}>
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
            title={<>Backlog <span className="muted">({backlogTasks.length})</span></>}
            bodyClass=""
            actions={
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
                <Link className="btn ghost sm" to="/tasks">All</Link>
              </>
            }
          >
            <div
              style={{ padding: 6, minHeight: 60 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                const ids = draggedIds(e)
                if (!ids.length) return
                for (const id of ids) await api.post(`/tasks/${id}/backlog`, {})
                refresh()
              }}
            >
              {backlogTasks.length === 0 ? (
                <Empty>Empty. Drag a task here to unschedule it.</Empty>
              ) : (
                backlogTasks.map((t) => (
                  <div key={t.id} className="task" draggable
                    onDragStart={(ev) => ev.dataTransfer.setData('text/task-id', String(t.id))}
                  >
                    <div className="task-body">
                      <div className="task-title">{t.title}</div>
                      <div className="task-meta">
                        <PriorityChip
                          level={t.priority}
                          onChange={(pri) => patchTask(t.id, { priority: pri })}
                        />
                        {t.project_name && (
                          <span className={`chip ${cls(t.project_color)}`}>{t.project_name}</span>
                        )}
                      </div>
                    </div>
                    <div className="task-actions">
                      <button
                        className="btn ghost sm"
                        title="Schedule on this day"
                        onClick={() => patchTask(t.id, { scheduled_date: date })}
                      >
                        <Icon name="arrowRight" size={13} />
                      </button>
                    </div>
                  </div>
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
 * A top-level task promoted to a heading for the work under it. The parent sits
 * in the column matching its OWN time — it is the heading, and grading it by the
 * subtree it already visibly contains would say the same thing twice — while its
 * immediate children each grade by their own total, exactly as they would out in
 * the grid. Rules above, between and below make the band read as one unit.
 */
function SubSection({ task, columnLabels, rowProps }) {
  const children = task.subtasks || []
  const head = [[], [], []]
  head[columnByMinutes(ownMinutes(task))].push(task)

  const kids = [[], [], []]
  for (const c of children) kids[columnFor(c)].push(c)

  const row = (groups, opts = {}) => (
    <div className="box-cols">
      {groups.map((group, i) => (
        <div className="box-col" key={i}>
          {group.map((t) => (
            <TaskRow
              key={t.id}
              {...rowProps(t)}
              // The band already states the grouping, so repeating the parent's
              // subtasks beneath it would show every child twice.
              subtasks={opts.flat ? [] : (t.subtasks || [])}
              showProject={false}
              listIds={group.map((x) => x.id)}
            />
          ))}
        </div>
      ))}
    </div>
  )

  return (
    <div className="subsec">
      <div className="subsec-rule" />
      {row(head, { flat: true })}
      <div className="subsec-rule" />
      {children.length > 0
        ? row(kids, { flat: true })
        : <p className="subsec-empty">Nothing under this yet — add a subtask.</p>}
      <div className="subsec-rule" />
    </div>
  )
}

function SectionPanel({
  section, tasks, projects, columnLabels, rowProps,
  onAdd, onAddMeeting, onPatch, onDelete, onDropLoose, onMoveToColumn,
  dragging, dropAt, onDragSection, onDragSectionEnd, onDragOverSection, onDropSection,
}) {
  const [renaming, setRenaming] = useState(false)
  const [over, setOver] = useState(false)
  const tree = nestTasks(tasks)
  const isColumns = section.layout === 'columns'

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
  const banded = new Set(bands.map((t) => t.id))

  const cols = [[], [], []]
  if (isColumns) {
    for (const t of tree) {
      if (t.kind === 'note' || banded.has(t.id)) continue
      cols[columnFor(t)].push(t)
    }
  }

  // Each column is its own list, so a range never jumps between them.
  const noteIds = visibleIds(notes)
  const colIds = cols.map(visibleIds)

  return (
    <section
      className={[
        'panel section', cls(section.color),
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
          aria-expanded={!section.collapsed}
          onClick={() => onPatch({ collapsed: section.collapsed ? 0 : 1 })}
        >
          <Icon name={section.collapsed ? 'right' : 'chevronDown'} size={12} />
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
        <Progress tasks={tasks} color={section.color} className="section-prog" />
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
        <button className="btn ghost sm danger" title="Remove section (keeps its tasks)" onClick={onDelete}>
          <Icon name="trash" size={13} />
        </button>
      </header>

      {section.collapsed ? null : (
      <div {...dropZone}>
        {isColumns ? (
          <>
          {notes.length > 0 && (
            <div className="section-notes">
              {notes.map((t) => (
                <TaskRow key={t.id} {...rowProps(t)} showProject={false} listIds={noteIds} />
              ))}
            </div>
          )}
          {bands.map((band) => (
            <SubSection
              key={band.id}
              task={band}
              columnLabels={columnLabels}
              rowProps={rowProps}
            />
          ))}

          <div className="box-cols">
            {cols.map((colTasks, i) => (
              <div
                key={i}
                className="box-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const ids = draggedIds(e)
                  if (!ids.length) return
                  e.stopPropagation()
                  setOver(false)
                  onMoveToColumn(ids, i)
                }}
              >
                <div className="box-col-h">{columnLabels[i]}</div>
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
