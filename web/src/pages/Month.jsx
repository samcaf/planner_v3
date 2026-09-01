import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useArrowNav } from '../lib/keys.js'
import Icon from '../components/Icon.jsx'
import Progress, { OPEN, tally } from '../components/Progress.jsx'
import QuickMeeting from '../components/QuickMeeting.jsx'
import { cls } from '../components/ui.jsx'
import { api, useApi } from '../lib/api.js'
import {
  DOW, addMonths, dayNum, isSameMonth, longDate, minutesLabel, monthGrid, monthLabel, shortDate,
  today,
} from '../lib/dates.js'
import { useMobile } from '../lib/mobile.js'
import '../styles/calendar.css'
import '../styles/people.css'
import { Rich } from '../lib/rich.jsx'
import { usePageTitle } from '../lib/title.js'

const MAX_PILLS = 3

/** Rank for the calendar sort. Anything unrecognised sorts as medium. */
const PRIORITY = { highest: 0, high: 1, medium: 2, low: 3, lowest: 4 }

const isOpen = (t) => t.kind === 'note' || OPEN.includes(t.status)

export default function Month() {
  const { date } = useParams()
  const navigate = useNavigate()
  const phone = useMobile()
  useArrowNav(useCallback((by) => navigate(`/month/${addMonths(date, by)}`), [date, navigate]))
  usePageTitle(monthLabel(date))
  const grid = monthGrid(date)
  const range = useApi(`/days/range/${grid[0]}/${grid[41]}`, [date])
  const [dragOver, setDragOver] = useState(null)
  const [adding, setAdding] = useState(null)
  const [draft, setDraft] = useState('')
  const [nestOver, setNestOver] = useState(null)
  // The day a new meeting would land on, and the fact that the form is open.
  const [meetingOn, setMeetingOn] = useState(null)

  if (!range.data) return <div className="page"><p className="muted">Loading…</p></div>

  const { tasks, milestones } = range.data
  const events = tasks.filter((t) => t.kind === 'meeting')

  async function addTask(e, day) {
    e.preventDefault()
    const title = draft.trim()
    if (!title) return
    setDraft('')
    setAdding(null)
    await api.post('/tasks', { title, scheduled_date: day })
    range.reload()
  }

  async function nest(childId, parentId) {
    await api.post(`/tasks/${childId}/nest`, { parent_id: parentId })
    range.reload()
  }

  // Unfinished first, then priority: the server's ORDER BY still speaks the old
  // status/priority vocabulary, so with only three pills per cell the order that
  // decides what is visible is settled here. A stable sort keeps its tie-break.
  const sorted = [...tasks].sort((a, b) =>
    (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1)
    || (PRIORITY[a.priority] ?? 2) - (PRIORITY[b.priority] ?? 2))

  // One pass into a per-date bucket beats filtering the arrays 42 times.
  const bucket = {}
  const dayTasks = {}
  const push = (d, item) => { (bucket[d] ||= []).push(item) }
  milestones.forEach((m) => push(m.due_date, { ...m, _type: 'milestone' }))
  events.forEach((e) => push(e.scheduled_date, { ...e, _type: 'event' }))
  sorted.forEach((t) => {
    push(t.scheduled_date, { ...t, _type: 'task' })
    ;(dayTasks[t.scheduled_date] ||= []).push(t)
  })

  return (
    <>
      <header className="topbar">
        <div className="daynav">
          <button className="btn ghost sm" onClick={() => navigate(`/month/${addMonths(date, -1)}`)} aria-label="Previous month">
            <Icon name="left" size={15} />
          </button>
          <button className="btn ghost sm" onClick={() => navigate(`/month/${addMonths(date, 1)}`)} aria-label="Next month">
            <Icon name="right" size={15} />
          </button>
        </div>
        <h1>{monthLabel(date)}</h1>
        <button className="btn sm" onClick={() => navigate(`/month/${today()}`)}>Today</button>
        <span className="spacer" />
        {!phone && (
          <span className="muted" style={{ fontSize: 12 }}>Drag tasks between days to reschedule</span>
        )}
      </header>

      <div className="page">
        {phone ? (
          <MonthPhone
            date={date}
            grid={grid}
            bucket={bucket}
            dayTasks={dayTasks}
            onMeeting={setMeetingOn}
            onChanged={range.reload}
          />
        ) : (
          <div className="month">
            {DOW.map((d) => <div key={d} className="month-dow">{d}</div>)}

            {grid.map((d) => {
              const items = bucket[d] || []
              const shown = items.slice(0, MAX_PILLS)
              const day = dayTasks[d] || []
              const load = tally(day)

              return (
                <div
                  key={d}
                  className={[
                    'mday',
                    isSameMonth(d, date) ? '' : 'other',
                    d === today() ? 'today' : '',
                    dragOver === d ? 'drop-target' : '',
                  ].join(' ')}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(d) }}
                  onDragLeave={() => setDragOver((cur) => (cur === d ? null : cur))}
                  onDrop={async (e) => {
                    e.preventDefault()
                    setDragOver(null)
                    const id = e.dataTransfer.getData('text/task-id')
                    if (!id) return
                    await api.patch(`/tasks/${id}`, { scheduled_date: d })
                    range.reload()
                  }}
                >
                  <div className="mday-h">
                    <Link to={`/day/${d}`} className="dnum" style={{ color: 'inherit' }}>{dayNum(d)}</Link>
                    {load.total > 0 && (
                      // The cell is too narrow for the full "30m / 5h", so the
                      // remaining half of it lives in the tooltip.
                      <span
                        className="cal-mday-load"
                        title={`${minutesLabel(load.done) || '0m'} / ${minutesLabel(load.total)} · ${load.pct}%`}
                      >
                        {minutesLabel(load.total)}
                      </span>
                    )}
                    <button
                      className="mday-add"
                      title="Add a task on this day"
                      onClick={() => { setAdding(d); setDraft('') }}
                    >
                      <Icon name="plus" size={12} />
                    </button>
                    {/* Rides with the + rather than under it: `mday-add` pushes
                        itself right, so a second one would sit at the other end. */}
                    <button
                      className="mday-add pe-mday-meet"
                      title={`New meeting on ${shortDate(d)}`}
                      aria-label={`New meeting on ${shortDate(d)}`}
                      onClick={() => setMeetingOn(d)}
                    >
                      <Icon name="clock" size={12} />
                    </button>
                  </div>

                  <Progress tasks={day} compact className="cal-prog cal-mday-prog" />

                  {shown.map((it) => (
                    <div
                      key={`${it._type}${it.id}`}
                      className={[
                        'pill',
                        cls(it.project_color),
                        it._type === 'task' && !isOpen(it) ? 'done' : '',
                        nestOver === `${it._type}${it.id}` ? 'nest-over' : '',
                      ].join(' ')}
                      title={it._type === 'task' ? `${it.title} — drop a task here to nest it` : it.title}
                      draggable={it._type === 'task'}
                      onDragStart={(e) => {
                        e.stopPropagation()
                        e.dataTransfer.setData('text/task-id', String(it.id))
                      }}
                      // Tasks accept a drop to become the parent; the day cell
                      // behind them handles rescheduling, so stop propagation.
                      onDragOver={it._type === 'task'
                        ? (e) => { e.preventDefault(); e.stopPropagation(); setNestOver(`${it._type}${it.id}`) }
                        : undefined}
                      onDragLeave={it._type === 'task' ? () => setNestOver(null) : undefined}
                      onDrop={it._type === 'task'
                        ? (e) => {
                            const id = Number(e.dataTransfer.getData('text/task-id'))
                            setNestOver(null)
                            if (!id || id === it.id) return
                            e.preventDefault()
                            e.stopPropagation()
                            nest(id, it.id)
                          }
                        : undefined}
                      onClick={() => navigate(it._type === 'milestone' ? `/projects/${it.project_id}` : `/day/${d}`)}
                    >
                      {it._type === 'milestone' ? '⚑ ' : ''}
                      {it._type === 'event' && it.start_time ? `${it.start_time} ` : ''}
                      <Rich text={it.title} inline />
                    </div>
                  ))}

                  {adding === d && (
                    <form onSubmit={(e) => addTask(e, d)}>
                      <input
                        className="input"
                        autoFocus
                        style={{ fontSize: 11, padding: '2px 5px' }}
                        placeholder="Task…"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        // Clicking away saves rather than discarding what was typed.
                        onBlur={(e) => { draft.trim() ? addTask(e, d) : setAdding(null) }}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(''); setAdding(null) } }}
                      />
                    </form>
                  )}

                  {items.length > MAX_PILLS && (
                    <Link to={`/day/${d}`} className="more">+{items.length - MAX_PILLS} more</Link>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {meetingOn && (
        <QuickMeeting
          date={meetingOn}
          onClose={() => setMeetingOn(null)}
          onCreated={() => { setMeetingOn(null); range.reload() }}
        />
      )}
    </>
  )
}

/**
 * The month on a phone.
 *
 * A 375px screen gives each day about fifty pixels, and three words of pill
 * text in fifty pixels is nine lines of one letter — the grid was a page and a
 * half tall before it said anything you could read. So the grid stops trying to
 * say WHAT is on a day and says only HOW MUCH: a dot per item, up to four, in
 * the project's colour. Tapping a day opens it as a list underneath, where
 * there is a whole screen's width to write a title in.
 *
 * Which is what a phone calendar does, for this reason. The day view already
 * draws the real thing, so every row here links into it rather than trying to
 * be it: no dragging, no nesting, no inline editing beyond adding a title.
 */
function MonthPhone({ date, grid, bucket, dayTasks, onMeeting, onChanged }) {
  const navigate = useNavigate()
  const [chosen, setChosen] = useState(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  // Derived rather than stored, so paging to another month cannot leave the
  // list showing a day the grid no longer draws.
  const fallback = grid.includes(today()) ? today() : grid.find((d) => isSameMonth(d, date))
  const day = chosen && grid.includes(chosen) ? chosen : fallback
  const items = bucket[day] || []
  const load = tally(dayTasks[day] || [])

  async function addTask(e) {
    e.preventDefault()
    const title = draft.trim()
    setDraft('')
    setAdding(false)
    if (!title) return
    await api.post('/tasks', { title, scheduled_date: day })
    onChanged()
  }

  return (
    <>
      <div className="mgrid">
        {DOW.map((d) => <div key={d} className="mgrid-dow">{d[0]}</div>)}

        {grid.map((d) => (
          <button
            key={d}
            type="button"
            className={[
              'mgrid-day',
              isSameMonth(d, date) ? '' : 'other',
              d === today() ? 'today' : '',
              d === day ? 'is-on' : '',
            ].join(' ')}
            aria-pressed={d === day}
            aria-label={longDate(d)}
            onClick={() => setChosen(d)}
          >
            <span className="mgrid-num">{dayNum(d)}</span>
            <span className="mgrid-dots">
              {(bucket[d] || []).slice(0, 4).map((it) => (
                <i key={`${it._type}${it.id}`} className={`mgrid-dot ${cls(it.project_color)}`} />
              ))}
            </span>
          </button>
        ))}
      </div>

      <section className="panel magenda">
        <header className="magenda-h">
          <Link to={`/day/${day}`} className="magenda-date">{longDate(day)}</Link>
          {load.total > 0 && <span className="chip">{minutesLabel(load.total)}</span>}
          <span className="spacer" />
          <button
            className="btn ghost sm"
            aria-label={`Add a task on ${shortDate(day)}`}
            onClick={() => { setAdding(true); setDraft('') }}
          >
            <Icon name="plus" size={14} />
          </button>
          <button
            className="btn ghost sm"
            aria-label={`New meeting on ${shortDate(day)}`}
            onClick={() => onMeeting(day)}
          >
            <Icon name="clock" size={14} />
          </button>
        </header>

        {adding && (
          <form onSubmit={addTask} className="magenda-add">
            <input
              className="input"
              autoFocus
              placeholder="Task…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={addTask}
              onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(''); setAdding(false) } }}
            />
          </form>
        )}

        {items.length === 0 && !adding && <p className="magenda-none">Nothing on this day.</p>}

        {items.map((it) => (
          <button
            key={`${it._type}${it.id}`}
            type="button"
            className="magenda-row"
            onClick={() => navigate(it._type === 'milestone' ? `/projects/${it.project_id}` : `/day/${day}`)}
          >
            <i className={`mgrid-dot ${cls(it.project_color)}`} />
            <span className="magenda-when">
              {it._type === 'milestone' ? '⚑' : ''}
              {it._type === 'event' && it.start_time ? it.start_time : ''}
            </span>
            <span className={`magenda-title${it._type === 'task' && !isOpen(it) ? ' done' : ''}`}>
              <Rich text={it.title} inline />
            </span>
          </button>
        ))}
      </section>
    </>
  )
}
