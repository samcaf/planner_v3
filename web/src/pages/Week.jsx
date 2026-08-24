import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useArrowNav } from '../lib/keys.js'
import Icon from '../components/Icon.jsx'
import Progress, { OPEN, tally } from '../components/Progress.jsx'
import QuickMeeting from '../components/QuickMeeting.jsx'
import { MiniTask, nestTasks } from '../components/TaskRow.jsx'
import { cls } from '../components/ui.jsx'
import { api, useApi } from '../lib/api.js'
import {
  DOW, addDays, dayNum, minutesLabel, parse, shortDate, startOfWeek, today, weekDays,
} from '../lib/dates.js'
import '../styles/calendar.css'

const GROUP_STORE = 'planner.week.groups'

/** Rank for the calendar sort. Anything unrecognised sorts as medium. */
const PRIORITY = { highest: 0, high: 1, medium: 2, low: 3, lowest: 4 }

/** Notes are never "finished" — they are prose, not work. */
const isOpen = (t) => t.kind === 'note' || OPEN.includes(t.status)

/** Only tasks carry time and count towards a total. */
const countable = (tasks) => tasks.filter((t) => t.kind !== 'note')

/**
 * Unfinished first, then priority. The server's ORDER BY still speaks the old
 * status/priority vocabulary, so the order that matters is settled here; the
 * sort is stable, which keeps the server's start_time/sort tie-break intact.
 */
function calendarSort(tasks) {
  return [...tasks].sort((a, b) =>
    (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1)
    || (PRIORITY[a.priority] ?? 2) - (PRIORITY[b.priority] ?? 2))
}

/**
 * `sections.color` defaults to gray, so a gray section means "never coloured"
 * rather than "deliberately gray" — the linked project's colour is the better
 * signal in that case.
 */
const sectionColor = (s) => (s.color && s.color !== 'gray' ? s.color : s.project_color || s.color)

/**
 * Section first, then project. A task with neither is loose and renders bare —
 * a group of one unrelated task is noise, not structure.
 */
function groupTasks(tasks, sections) {
  const groups = new Map()
  const loose = []

  // Seeded in section order so the bands read the same way they do on the day
  // page. Sections that end up empty are dropped below.
  for (const s of sections) {
    groups.set(`s${s.id}`, {
      key: `s${s.id}`,
      name: s.name || s.project_name || 'Other',
      color: sectionColor(s),
      tasks: [],
    })
  }

  for (const t of tasks) {
    const key = t.section_id != null ? `s${t.section_id}`
      : t.project_id != null ? `p${t.project_id}`
        : null
    if (!key) { loose.push(t); continue }
    // A section whose row hasn't arrived yet still gets its own group, so the
    // grouping doesn't reshuffle when the section fetch lands — only the name.
    if (!groups.has(key)) {
      groups.set(key, { key, name: t.project_name || 'Other', color: t.project_color, tasks: [] })
    }
    groups.get(key).tasks.push(t)
  }

  return { groups: [...groups.values()].filter((g) => g.tasks.length), loose }
}

/**
 * `/days/range` returns tasks but not sections, so they come a day at a time.
 * Keyed on the week rather than the task data, so editing a task doesn't
 * refetch seven days of sections.
 */
function useSections(weekStart) {
  const [byDay, setByDay] = useState({})

  useEffect(() => {
    let cancelled = false
    const days = weekDays(weekStart)
    Promise.all(days.map((d) => api.get(`/sections?date=${d}`).catch(() => [])))
      .then((lists) => {
        if (!cancelled) setByDay(Object.fromEntries(days.map((d, i) => [d, lists[i]])))
      })
    return () => { cancelled = true }
  }, [weekStart])

  return byDay
}

/** Which groups are open. Collapsed is the default, and the set outlives navigation. */
function useExpanded() {
  const [open, setOpen] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(GROUP_STORE)) || []) } catch { return new Set() }
  })

  const toggle = (key) => {
    const next = new Set(open)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setOpen(next)
    try { localStorage.setItem(GROUP_STORE, JSON.stringify([...next])) } catch { /* storage off */ }
  }

  return [open, toggle]
}

export default function Week() {
  const { date } = useParams()
  const navigate = useNavigate()
  useArrowNav(useCallback((by) => navigate(`/week/${addDays(date, by * 7)}`), [date, navigate]))
  const days = weekDays(date)
  const range = useApi(`/days/range/${days[0]}/${days[6]}`, [date])
  const sections = useSections(days[0])
  const [expanded, toggleGroup] = useExpanded()
  const [dragOver, setDragOver] = useState(null)
  const [nestOver, setNestOver] = useState(null)
  const [adding, setAdding] = useState(null)
  const [draft, setDraft] = useState('')
  // The day a new meeting would land on, and the fact that the form is open.
  const [meetingOn, setMeetingOn] = useState(null)

  if (!range.data) return <div className="page"><p className="muted">Loading…</p></div>

  const { tasks, milestones } = range.data
  // Meetings are meeting-kind tasks; the schedule pills are a lens on the same
  // rows, so they are filtered out of the task lists below to avoid doubling.
  const events = tasks.filter((t) => t.kind === 'meeting')
  const byDay = (list, key = 'scheduled_date') =>
    Object.fromEntries(days.map((d) => [d, list.filter((x) => x[key] === d)]))

  const tasksByDay = byDay(tasks.filter((t) => t.kind !== 'meeting'))
  const eventsByDay = byDay(events)
  const milesByDay = byDay(milestones, 'due_date')

  async function moveTask(id, to) {
    await api.patch(`/tasks/${id}`, { scheduled_date: to })
    range.reload()
  }

  async function nest(childId, parentId) {
    await api.post(`/tasks/${childId}/nest`, { parent_id: parentId })
    range.reload()
  }

  async function toggleTask(t) {
    await api.patch(`/tasks/${t.id}`, { status: t.status === 'done' ? 'todo' : 'done' })
    range.reload()
  }

  async function addTask(e, day) {
    e.preventDefault()
    const title = draft.trim()
    if (!title) return
    setDraft('')
    setAdding(null)
    await api.post('/tasks', { title, scheduled_date: day })
    range.reload()
  }

  const week = tally(tasks)

  const taskProps = { nestOver, setNestOver, onNest: nest, onToggle: toggleTask }

  return (
    <>
      <header className="topbar">
        <div className="daynav">
          <button className="btn ghost sm" onClick={() => navigate(`/week/${addDays(date, -7)}`)} aria-label="Previous week">
            <Icon name="left" size={15} />
          </button>
          <button className="btn ghost sm" onClick={() => navigate(`/week/${addDays(date, 7)}`)} aria-label="Next week">
            <Icon name="right" size={15} />
          </button>
        </div>
        <h1>{shortDate(days[0])} – {shortDate(days[6])}</h1>
        {startOfWeek(today()) === days[0] && <span className="chip c-blue">This week</span>}
        <button className="btn sm" onClick={() => navigate(`/week/${today()}`)}>Today</button>
        <span className="spacer" />
        {week.total > 0 && (
          <span className="chip" title={`${week.doneCount} of ${week.doneCount + week.openCount} tasks done`}>
            <Icon name="clock" size={11} /> {minutesLabel(week.done) || '0m'} / {minutesLabel(week.total)} planned
          </span>
        )}
      </header>

      <div className="page">
        <div className="week">
          {days.map((d) => {
            const isToday = d === today()
            const dayTasks = calendarSort(tasksByDay[d])
            const open = countable(dayTasks).filter(isOpen)
            const { groups, loose } = groupTasks(dayTasks, sections[d] || [])

            return (
              <section
                key={d}
                className={`panel wday ${isToday ? 'today' : ''} ${dragOver === d ? 'drop-target' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(d) }}
                onDragLeave={() => setDragOver((cur) => (cur === d ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(null)
                  const id = e.dataTransfer.getData('text/task-id')
                  if (id) moveTask(id, d)
                }}
              >
                <header className="wday-h cal-wday-h">
                  <span className="dow">{DOW[(parse(d).getDay() + 6) % 7]}</span>
                  <Link to={`/day/${d}`} className="dnum" style={{ color: 'inherit' }}>{dayNum(d)}</Link>
                  <span className="spacer" />
                  {open.length > 0 && <span className="muted" style={{ fontSize: 11 }}>{open.length}</span>}
                  <Progress tasks={dayTasks} className="cal-prog" />
                </header>

                <div className="wday-b">
                  {milesByDay[d].map((m) => (
                    <Link key={`m${m.id}`} to={`/projects/${m.project_id}`} className={`pill ${cls(m.project_color)}`}>
                      ⚑ {m.title}
                    </Link>
                  ))}

                  {eventsByDay[d].map((e) => (
                    <Link key={`e${e.id}`} to={`/day/${d}`} className={`pill ${cls(e.project_color)}`}>
                      {e.start_time ? `${e.start_time} ` : ''}{e.title}
                    </Link>
                  ))}

                  {groups.length > 0 && (
                    <div className="cal-groups">
                      {groups.map((g) => (
                        <Group
                          key={g.key}
                          group={g}
                          open={expanded.has(`${d}|${g.key}`)}
                          onToggle={() => toggleGroup(`${d}|${g.key}`)}
                          taskProps={taskProps}
                        />
                      ))}
                    </div>
                  )}

                  {nestTasks(loose).map((t) => (
                    <WeekTask key={t.id} task={t} {...taskProps} />
                  ))}

                  <span className="spacer" />

                  <div className="pe-day-add">
                    {adding === d ? (
                      <form onSubmit={(e) => addTask(e, d)} style={{ flex: 1 }}>
                        <input
                          className="input"
                          autoFocus
                          style={{ fontSize: 12, padding: '3px 6px', width: '100%' }}
                          placeholder="Task…"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          // Clicking away saves what was typed. Discarding it here
                          // silently loses the task unless Enter was pressed.
                          onBlur={(e) => { draft.trim() ? addTask(e, d) : setAdding(null) }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { setDraft(''); setAdding(null) }
                          }}
                        />
                      </form>
                    ) : (
                      <button
                        className="btn ghost sm"
                        style={{ justifyContent: 'flex-start', flex: 1 }}
                        onClick={() => { setAdding(d); setDraft('') }}
                      >
                        <Icon name="plus" size={12} /> Add
                      </button>
                    )}
                    {/* A meeting needs a time, a link and attendees, so it gets
                        the full form rather than the one-line title box. */}
                    <button
                      className="btn ghost sm"
                      title={`New meeting on ${shortDate(d)}`}
                      aria-label={`New meeting on ${shortDate(d)}`}
                      onClick={() => setMeetingOn(d)}
                    >
                      <Icon name="clock" size={12} />
                    </button>
                  </div>
                </div>
              </section>
            )
          })}
        </div>

        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Drag a task between days to reschedule it. Click a date to open the full day.
        </p>
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
 * One section or project band inside a day column. The bar and the count stay
 * visible while collapsed — that is the whole point of collapsing it.
 */
function Group({ group, open, onToggle, taskProps }) {
  const items = countable(group.tasks)

  return (
    <div className={`cal-group ${cls(group.color)}`}>
      <button className="cal-group-h" onClick={onToggle} aria-expanded={open} title={group.name}>
        <span className="cal-chev"><Icon name={open ? 'chevronDown' : 'right'} size={11} /></span>
        <span className="dot" />
        <span className="cal-group-name">{group.name}</span>
      </button>

      {/* The count rides with the bar rather than the name: a week column is
          too narrow to hold both without truncating the name. */}
      <div className="cal-group-sum">
        <Progress tasks={group.tasks} color={group.color} compact className="cal-prog" />
        <span className="cal-group-n">{items.filter(isOpen).length}/{items.length}</span>
      </div>

      {open && (
        <div className="cal-group-b">
          {nestTasks(group.tasks).map((t) => <WeekTask key={t.id} task={t} {...taskProps} />)}
        </div>
      )}
    </div>
  )
}

/** A root task and its children, wrapped in the drop-to-nest target. */
function WeekTask({ task, nestOver, setNestOver, onNest, onToggle }) {
  return (
    <div
      // Dropping onto a task nests it; the day column behind
      // handles rescheduling, hence stopPropagation.
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setNestOver(task.id) }}
      onDragLeave={() => setNestOver((cur) => (cur === task.id ? null : cur))}
      onDrop={(e) => {
        const id = Number(e.dataTransfer.getData('text/task-id'))
        setNestOver(null)
        if (!id || id === task.id) return
        e.preventDefault()
        e.stopPropagation()
        onNest(id, task.id)
      }}
      className={nestOver === task.id ? 'mini-nest' : undefined}
    >
      <MiniTask task={task} childCount={task.subtasks.length} onToggle={() => onToggle(task)} />
      {task.subtasks.map((child) => (
        <div key={child.id} style={{ marginLeft: 14 }}>
          <MiniTask task={child} onToggle={() => onToggle(child)} />
        </div>
      ))}
    </div>
  )
}
