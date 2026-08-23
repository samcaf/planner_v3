import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { RichEditor, RichLine } from '../lib/rich.jsx'
import { api, useApi } from '../lib/api.js'
import {
  DOW, addDays, addMonths, dayNum, isSameMonth, longDate, monthGrid, monthLabel,
  parse, shortDate, today, weekDays,
} from '../lib/dates.js'
import '../styles/notes.css'

const SCOPES = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']]

// The editor is the whole page in day scope but one column of seven in week
// scope, so the textarea has to shrink with it.
const ROWS = { day: 16, week: 4 }

const MAX_PREVIEW = 4

/** The dates a scope covers — the same spans Week.jsx and Month.jsx lay out. */
function spanFor(scope, date) {
  return scope === 'month' ? monthGrid(date) : weekDays(date)
}

/** First written line, without the markdown that would read as noise in a cell. */
function preview(text) {
  const line = (text || '').split('\n').map((s) => s.trim()).find(Boolean) || ''
  return line
    .replace(/^(?:[-*+>]|#{1,6}|\d+\.)\s*(?:\[[ xX]\]\s*)?/, '')
    // In a cell this narrow a link is worth only its label — the URL is noise.
    .replace(/\[\[(?:day:|project:|task:)?([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => label || target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`_[\]]/g, '')
}

/**
 * Every note the tasks table contributes, newest ordering left alone.
 * A `kind='note'` row is prose in its own right; any other task contributes
 * only what was written on it. Either is "attached" once it hangs off a task —
 * `label` is that task's title, and is null for a note that stands alone.
 */
function noteRows(tasks) {
  const titles = new Map(tasks.map((t) => [t.id, t.title]))
  return tasks
    .filter((t) => t.kind === 'note' || (t.notes || '').trim())
    .map((t) => ({
      task: t,
      label: t.kind === 'note'
        ? (t.parent_id != null ? titles.get(t.parent_id) || 'Task' : null)
        : (t.title || 'Task'),
    }))
}

export default function Notes() {
  const { date } = useParams()
  const navigate = useNavigate()
  const [scope, setScope] = useState('day')
  const [attached, setAttached] = useState(true)

  const span = useMemo(() => spanFor(scope, date), [scope, date])
  // /days/range is the only endpoint returning many `days` rows at once, so all
  // three scopes read the same rows from one request — never a per-scope copy.
  const range = useApi(`/days/range/${span[0]}/${span[span.length - 1]}`, [scope, date])

  if (range.error) return <div className="page"><p className="muted">{range.error.message}</p></div>
  if (!range.data) return <div className="page"><p className="muted">Loading…</p></div>

  const byDate = Object.fromEntries(range.data.days.map((r) => [r.date, r]))

  const rows = noteRows(range.data.tasks)
  const hiddenCount = rows.filter((r) => r.label).length
  const byDay = {}
  for (const row of rows) {
    if (!attached && row.label) continue
    ;(byDay[row.task.scheduled_date] ||= []).push(row)
  }

  // A row exists as soon as any view touches the date, so emptiness is decided
  // by the text rather than by the row.
  const hasNotes = (d) => !!(byDate[d]?.notes || '').trim() || !!byDay[d]?.length

  async function saveDay(d, patch) {
    await api.patch(`/days/${d}`, patch)
    range.reload()
  }

  async function saveNote(id, patch) {
    await api.patch(`/tasks/${id}`, patch)
    range.reload()
  }

  async function addNote(d) {
    // A note starts empty — its text is prose in `notes`, and a placeholder
    // title would just have to be deleted before writing anything.
    await api.post('/tasks', { title: '', kind: 'note', scheduled_date: d })
    range.reload()
  }

  async function removeNote(id) {
    await api.del(`/tasks/${id}`)
    range.reload()
  }

  const bodyProps = (d) => ({
    date: d,
    row: byDate[d],
    blocks: byDay[d] || [],
    onSaveDay: (patch) => saveDay(d, patch),
    onSaveNote: saveNote,
    onDelete: removeNote,
    onAdd: () => addNote(d),
  })

  /** Month cells and week headers open a date in day scope, not the task view. */
  const openDay = (d) => { setScope('day'); navigate(`/notes/${d}`) }

  const jump = (n) => (scope === 'month' ? addMonths(date, n) : addDays(date, scope === 'week' ? n * 7 : n))

  const heading = scope === 'month' ? monthLabel(date)
    : scope === 'week' ? `${shortDate(span[0])} – ${shortDate(span[6])}`
      : longDate(date)

  // The month grid runs over its edges into the neighbouring months, which
  // should not be counted as part of the month being read.
  const counted = scope === 'month' ? span.filter((d) => isSameMonth(d, date)) : span
  const filled = counted.filter(hasNotes).length

  return (
    <>
      <header className="topbar">
        <div className="daynav">
          <button className="btn ghost sm" onClick={() => navigate(`/notes/${jump(-1)}`)} aria-label={`Previous ${scope}`}>
            <Icon name="left" size={15} />
          </button>
          <button className="btn ghost sm" onClick={() => navigate(`/notes/${jump(1)}`)} aria-label={`Next ${scope}`}>
            <Icon name="right" size={15} />
          </button>
        </div>
        <h1>{heading}</h1>
        {date === today() && <span className="chip c-blue">Today</span>}
        <input
          className="input"
          type="date"
          style={{ width: 150 }}
          value={date}
          onChange={(e) => e.target.value && navigate(`/notes/${e.target.value}`)}
        />
        {date !== today() && (
          <button className="btn sm" onClick={() => navigate(`/notes/${today()}`)}>Today</button>
        )}
        <span className="spacer" />
        <label className="nt-toggle" title="Notes written on a task, or nested under one">
          <input type="checkbox" checked={attached} onChange={(e) => setAttached(e.target.checked)} />
          Show notes attached to tasks
          {hiddenCount > 0 && <span className="muted"> ({hiddenCount})</span>}
        </label>
        {filled > 0 && <span className="chip" title="Days with notes in the span below">{filled} with notes</span>}
      </header>

      <div className="page">
        <div className="tabs">
          {SCOPES.map(([key, label]) => (
            <button
              key={key}
              className={`tab ${scope === key ? 'active' : ''}`}
              onClick={() => setScope(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {scope === 'day' && (
          <>
            <div className="nt-rail">
              {span.map((d) => (
                <Link
                  key={d}
                  to={`/notes/${d}`}
                  className={`nt-rail-day ${d === date ? 'is-cur' : ''} ${d === today() ? 'is-today' : ''}`}
                  title={hasNotes(d) ? `${longDate(d)} — has notes` : `${longDate(d)} — empty`}
                >
                  <span className="nt-dow">{DOW[(parse(d).getDay() + 6) % 7]}</span>
                  <span className="nt-num">{dayNum(d)}</span>
                  <span className={`nt-mark ${hasNotes(d) ? 'on' : ''}`} />
                </Link>
              ))}
            </div>

            <section className="panel nt-day">
              <header className="nt-day-h">
                <Link to={`/day/${date}`} className="nt-date">{longDate(date)}</Link>
                {hasNotes(date) && <span className="nt-mark on" />}
                {date === today() && <span className="chip c-blue">Today</span>}
                <span className="nt-title">
                  <RichLine
                    value={byDate[date]?.title || ''}
                    onChange={(title) => saveDay(date, { title })}
                    placeholder="Add a heading…"
                  />
                </span>
              </header>
              <div className="nt-day-b">
                <DayBody {...bodyProps(date)} rows={ROWS.day} />
              </div>
            </section>
          </>
        )}

        {scope === 'week' && (
          <div className="week">
            {span.map((d) => {
              const count = (byDay[d] || []).length

              return (
                <section key={d} className={`panel wday ${d === today() ? 'today' : ''}`}>
                  <header className="wday-h">
                    <span className="dow">{DOW[(parse(d).getDay() + 6) % 7]}</span>
                    <Link
                      to={`/notes/${d}`}
                      className="dnum"
                      style={{ color: 'inherit' }}
                      onClick={() => setScope('day')}
                    >
                      {dayNum(d)}
                    </Link>
                    <span className="spacer" />
                    {count > 0 && <span className="muted" style={{ fontSize: 11 }}>{count}</span>}
                  </header>

                  <div className="wday-b nt-wday-b">
                    <DayBody {...bodyProps(d)} rows={ROWS.week} />
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {scope === 'month' && (
          <div className="month">
            {DOW.map((d) => <div key={d} className="month-dow">{d}</div>)}

            {span.map((d) => {
              const dayText = (byDate[d]?.notes || '').trim()
              const blocks = byDay[d] || []
              const items = [
                ...(dayText ? [{ key: 'day', text: dayText, label: null }] : []),
                ...blocks.map(({ task, label }) => ({
                  key: `t${task.id}`,
                  text: task.notes || task.title,
                  label,
                })),
              ]

              return (
                <div
                  key={d}
                  className={[
                    'mday',
                    isSameMonth(d, date) ? '' : 'other',
                    d === today() ? 'today' : '',
                  ].join(' ')}
                >
                  <div className="mday-h">
                    <Link to={`/day/${d}`} className="dnum" style={{ color: 'inherit' }}>{dayNum(d)}</Link>
                    {items.length > 0 && <span className="nt-mark on" />}
                    <button className="mday-add" title="Write on this day" onClick={() => openDay(d)}>
                      <Icon name="plus" size={12} />
                    </button>
                  </div>

                  {items.slice(0, MAX_PREVIEW).map((it) => (
                    <Link
                      key={it.key}
                      to={`/notes/${d}`}
                      onClick={() => setScope('day')}
                      className={`pill nt-preview ${it.label ? 'nt-preview-attached' : ''}`}
                      title={it.label ? `On “${it.label}”` : preview(it.text)}
                    >
                      {preview(it.text) || '—'}
                    </Link>
                  ))}

                  {items.length > MAX_PREVIEW && (
                    <Link to={`/notes/${d}`} onClick={() => setScope('day')} className="more">
                      +{items.length - MAX_PREVIEW} more
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          One note per date, plus the loose notes sitting between that day's tasks.
          Type <code>[[</code> to link a day, project or task.
        </p>
      </div>
    </>
  )
}

/**
 * The notes on one date: the day's own note, then every note block on it.
 * Shared by the day panel and the week columns, which differ only in size.
 */
function DayBody({ blocks, row, rows, onSaveDay, onSaveNote, onDelete, onAdd }) {
  return (
    <>
      <RichEditor
        value={row?.notes || ''}
        onChange={(notes) => onSaveDay({ notes })}
        rows={rows}
        placeholder="Plan, thinking, anything. Markdown, [[links]] and $math$ all work."
      />

      {blocks.map(({ task, label }) => (
        <NoteBlock
          key={task.id}
          task={task}
          label={label}
          rows={rows}
          onSave={(patch) => onSaveNote(task.id, patch)}
          // Only a loose note belongs to this page; deleting an attached one
          // would delete the task it was written on.
          onDelete={label ? null : () => onDelete(task.id)}
        />
      ))}

      <span className="spacer" />
      <button className="btn ghost sm nt-add-note" onClick={onAdd}>
        <Icon name="plus" size={12} /> Note
      </button>
    </>
  )
}

/** One note block: a loose `kind='note'` row, or the prose written on a task. */
function NoteBlock({ task, label, rows, onSave, onDelete }) {
  return (
    <div className={`nt-block ${label ? 'is-attached' : ''}`}>
      <header className="nt-block-h">
        {label ? (
          <Link to={`/day/${task.scheduled_date}`} className="nt-attached" title="Open the task this is written on">
            <Icon name="subtask" size={11} /> {label}
          </Link>
        ) : (
          <span className="nt-block-title">
            <RichLine
              value={task.title || ''}
              onChange={(title) => onSave({ title })}
              placeholder="Summary…"
            />
          </span>
        )}
        <span className="spacer" />
        {onDelete && (
          <button className="btn ghost sm" title="Delete this note" onClick={onDelete}>
            <Icon name="trash" size={12} />
          </button>
        )}
      </header>

      <RichEditor
        value={task.notes || ''}
        onChange={(notes) => onSave({ notes })}
        rows={rows}
        placeholder="Write here…"
      />
    </div>
  )
}
