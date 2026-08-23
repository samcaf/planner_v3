import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { PriorityIcon } from '../components/Priority.jsx'
import { Empty, Panel, cls } from '../components/ui.jsx'
import { useApi } from '../lib/api.js'
import { longDate, minutesLabel, relative, shortDate, today } from '../lib/dates.js'
import '../styles/dashboard.css'

/** Whole days between a stored timestamp and now. */
function ageInDays(stamp) {
  if (!stamp) return 0
  const then = new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`)
  if (Number.isNaN(then.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000))
}

export default function Dashboard() {
  const dash = useApi('/dashboard')

  if (dash.error) return <div className="page"><p className="muted">{dash.error.message}</p></div>
  if (!dash.data) return <div className="page"><p className="muted">Loading…</p></div>

  const d = dash.data
  const peak = Math.max(60, ...d.deep.map((x) => Math.max(x.done, x.planned)))

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
            title="Started, not finished"
            hint="Measured from when the task was created — there is no status history yet, so treat the age as a floor."
            icon="clock"
            tasks={d.stuck}
            meta={(t) => {
              const days = ageInDays(t.created_at)
              return days > 0 ? `${days}d` : 'today'
            }}
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
        </div>
      </div>
    </>
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
          <span className="db-row-title">{t.title}</span>
          <span className={`db-row-meta ${tone === 'red' ? 'is-red' : ''}`}>{meta(t)}</span>
        </Link>
      ))}
    </Panel>
  )
}
