import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import TaskRow, { nestTasks } from '../components/TaskRow.jsx'
import { PriorityIcon } from '../components/Priority.jsx'
import { useToast } from '../components/Toast.jsx'
import { Panel, cls } from '../components/ui.jsx'
import { api, useApi } from '../lib/api.js'
import { taskOps, useUndo } from '../lib/undo.jsx'
import { longDate, minutesLabel, relative, shortDate, today } from '../lib/dates.js'
import '../styles/dashboard.css'
import { Rich, plainTitle } from '../lib/rich.jsx'
import { usePageTitle } from '../lib/title.js'

/** Whole days between a stored timestamp and now. */
function ageInDays(stamp) {
  if (!stamp) return 0
  const then = new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`)
  if (Number.isNaN(then.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000))
}

export default function Dashboard() {
  usePageTitle('Dashboard')
  const dash = useApi('/dashboard')
  const undo = useUndo()
  const toast = useToast()

  if (dash.error) return <div className="page"><p className="muted">{dash.error.message}</p></div>
  if (!dash.data) return <div className="page"><p className="muted">Loading…</p></div>

  const d = dash.data
  const peak = Math.max(60, ...d.deep.map((x) => Math.max(x.done, x.planned)))

  // Every write here goes through the same ops the day page uses, so a tick in
  // this panel lands on the same undo stack as a tick anywhere else and Ctrl-Z
  // means the same thing on every screen.
  const ops = taskOps(undo, dash.reload)
  const units = d.inProgress || []

  const patchTask = async (id, patch) => {
    const task = units.find((t) => t.id === id)
    if (task) await ops.patch(task, patch)
    else { await api.patch(`/tasks/${id}`, patch); dash.reload() }
  }

  const removeTask = async (id) => {
    const task = units.find((t) => t.id === id)
    if (!task) return
    const restore = await ops.remove(task)
    toast({
      // The whole title. It was cut at forty characters to stop it running out
      // of the box; the box wraps and is bounded now, so the cut only hid which
      // task the Undo beside it referred to.
      message: `Deleted "${plainTitle(task.title) || 'note'}"`,
      action: { label: 'Undo', onClick: async () => { await restore(); dash.reload() } },
    })
  }

  /** A subtask inherits where its parent lives, so it lands on the same day. */
  const addChild = async (parent) => {
    const created = await api.post('/tasks', {
      title: 'New subtask',
      scheduled_date: parent.scheduled_date,
      project_id: parent.project_id,
      section_id: parent.section_id,
    })
    await api.post(`/tasks/${created.id}/nest`, { parent_id: parent.id })
    dash.reload()
  }

  const rowProps = (task) => ({
    task,
    subtasks: task.subtasks || [],
    onChange: (patch, id = task.id) => patchTask(id, patch),
    onDelete: (id = task.id) => removeTask(id),
    onAddChild: addChild,
    // Nothing on the dashboard accepts a drop, so a draggable row would be a
    // gesture that can only ever be abandoned. Reordering belongs on the day.
    draggable: false,
  })

  return (
    <>
      <header className="topbar">
        <h1>{longDate(d.date)}</h1>
        <span className="muted sub">
          {d.counts.today_open} open today · {d.counts.backlog} in the backlog · {d.counts.projects} projects
        </span>
        <span className="spacer" />
        <Link className="btn" to={`/day/${today()}`}>Open today <Icon name="arrowRight" size={13} /></Link>
      </header>

      <div className="page db-page">
        {/* The one thing. Atlassian's own calendar experiment found naming a
            single daily priority beat merely restructuring time — so this is
            deliberately one task, never a ranked list. */}
        <section className={`panel db-focus ${cls(d.focus?.project_color)}`}>
          <span className="db-eyebrow">If you only do one thing</span>
          {d.focus ? (
            <>
              <Link to={`/day/${d.focus.scheduled_date}`} className="db-focus-title">
                {d.focus.title}
              </Link>
              <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
                <PriorityIcon level={d.focus.priority} size={14} />
                {d.focus.intensity === 'deep' && <span className="chip is-deep">deep</span>}
                {d.focus.project_name && (
                  <span className={`chip ${cls(d.focus.project_color)}`}>{d.focus.project_name}</span>
                )}
                {d.focus.estimate_min && <span className="chip">{minutesLabel(d.focus.estimate_min)}</span>}
                {d.focus.start_time && <span className="chip c-blue">{d.focus.start_time}</span>}
              </div>
            </>
          ) : (
            <p className="db-focus-title muted">
              Nothing committed today. That is either a clear day or an unplanned one.
            </p>
          )}
        </section>

        <InProgress tasks={units} rowProps={rowProps} />

        <div className="db-grid">
          <DeepChart days={d.deep} peak={peak} />

          <TaskPanel
            title="Slipping"
            hint="Pushed off a day. Worth asking whether these are real."
            icon="arrowRight"
            tasks={d.slipping}
            meta={(t) => t.moved_to_date && `→ ${shortDate(t.moved_to_date)}`}
          />

          <TaskPanel
            title="Overdue"
            hint="Past their due date and still open."
            icon="flag"
            tasks={d.overdue}
            tone="red"
            meta={(t) => relative(t.due_date)}
          />

          <TaskPanel
            title="Recently touched"
            hint="Where you left off."
            icon="check"
            tasks={d.recent}
            meta={(t) => (t.status === 'done' ? 'done' : t.status)}
          />

          <Elsewhere />
        </div>
      </div>
    </>
  )
}

/**
 * The two directories, which used to sit in the rail.
 *
 * Neither is somewhere you go to plan a day — they are places you look
 * something up — so they were taking two of the rail's dozen slots to be the
 * two things nobody navigates to mid-morning. Here they are one panel among
 * the digests, reachable in a click from the mark at the foot of the rail.
 */
function Elsewhere() {
  const people = useApi('/people')
  const uploads = useApi('/uploads')
  const notebook = useApi('/notebook')
  const count = (r) => (Array.isArray(r.data) ? r.data.length : null)

  const LINKS = [
    { to: '/notebook', icon: 'templates', label: 'Notebook', n: count(notebook),
      hint: 'Notes that belong to no day and no project' },
    { to: '/people', icon: 'people', label: 'People', n: count(people),
      hint: 'Who you meet, and when you last did' },
    { to: '/uploads', icon: 'paperclip', label: 'Uploads', n: count(uploads),
      hint: 'Every file, and what refers to it' },
  ]

  return (
    <Panel title={<><Icon name="search" size={14} /> Elsewhere</>} bodyClass="db-progress-b">
      <div className="db-elsewhere">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="db-row db-else-row">
            <Icon name={l.icon} size={14} />
            <span className="db-row-title">
              {l.label}
              <span className="db-hint db-else-hint">{l.hint}</span>
            </span>
            {l.n !== null && <span className="db-row-meta">{l.n}</span>}
          </Link>
        ))}
      </div>
    </Panel>
  )
}

/**
 * What you are in the middle of, second only to the one thing. It is drawn as a
 * day page rather than as a digest because a link and a coloured dot cannot be
 * worked from: the whole point of seeing this here is to be able to tick a part
 * of it off without first navigating to the day it happens to live on.
 *
 * The server sends each started task together with its descendants whatever
 * their own status, so what appears is the unit of work rather than the one row
 * that happens to be flagged — the two subtasks you have not begun are exactly
 * what tells you how far from finished the thing is.
 */
function InProgress({ tasks, rowProps }) {
  if (!tasks.length) return null

  const tree = nestTasks(tasks)
  // The count is of things you actually marked as started, not of rows on
  // screen: most of the rows here are children that came along for the ride.
  const started = tasks.filter((t) => t.status === 'doing').length
  const oldest = Math.max(...tasks.filter((t) => t.status === 'doing').map((t) => ageInDays(t.created_at)))

  return (
    <Panel
      className="db-progress"
      title={<><Icon name="clock" size={14} /> In progress <span className="muted">({started})</span></>}
      actions={<span className="muted db-hint">oldest {oldest > 0 ? `${oldest}d` : '<1d'}</span>}
      bodyClass="db-progress-b"
    >
      <p className="db-hint">
        The whole unit of work, subtasks and all — including the parts you have not
        started. Age is measured from when the task was created, because there is
        still no status history, so treat it as a floor.
      </p>
      <div className="db-progress-list">
        {tree.map((t) => <TaskRow key={t.id} {...rowProps(t)} />)}
      </div>
    </Panel>
  )
}

/** Deep minutes a day for a fortnight — done solid, merely planned faint. */
function DeepChart({ days, peak }) {
  const total = days.reduce((s, x) => s + x.done, 0)
  if (total === 0 && days.every((x) => x.planned === 0)) return null

  return (
    <Panel
      className="db-wide"
      title={<><Icon name="clock" size={14} /> Deep work, last 14 days</>}
      actions={<span className="muted db-hint">{minutesLabel(total) || '0m'} done</span>}
    >
      <div className="db-chart">
        {days.map((x) => (
          <div key={x.date} className="db-bar" title={`${x.date}: ${minutesLabel(x.done) || '0m'} done of ${minutesLabel(x.planned) || '0m'} planned`}>
            <i className="db-bar-planned" style={{ height: `${(x.planned / peak) * 100}%` }} />
            <i className="db-bar-done" style={{ height: `${(x.done / peak) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="db-chart-axis">
        <span>{shortDate(days[0].date)}</span>
        <span className="spacer" />
        <span>today</span>
      </div>
    </Panel>
  )
}

/**
 * A panel renders nothing at all when it has nothing to say — an empty section
 * in a digest is pure noise, and the whole point is that what appears matters.
 */
function TaskPanel({ title, hint, icon, tasks, meta, tone }) {
  if (!tasks || tasks.length === 0) return null

  return (
    <Panel
      title={<><Icon name={icon} size={14} /> {title} <span className="muted">({tasks.length})</span></>}
      bodyClass="db-list"
    >
      <p className="db-hint">{hint}</p>
      {tasks.map((t) => (
        <Link
          key={t.id}
          to={t.scheduled_date ? `/day/${t.scheduled_date}` : '/tasks'}
          className="db-row"
        >
          <span className="dot" style={{ background: `var(--${t.project_color || 'gray'})` }} />
          <span className="db-row-title"><Rich text={t.title} inline /></span>
          <span className={`db-row-meta ${tone === 'red' ? 'is-red' : ''}`}>{meta(t)}</span>
        </Link>
      ))}
    </Panel>
  )
}
