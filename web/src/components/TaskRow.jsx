import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import Popover from './Popover.jsx'
import { useSelection } from './Selection.jsx'
import { PriorityChip } from './Priority.jsx'
import { RichEditor, RichLine } from '../lib/rich.jsx'
import { cls } from './ui.jsx'
import { addDays, minutesLabel, shortDate, today } from '../lib/dates.js'

/**
 * Clicking the box walks the three states you set by hand. `moved` follows from
 * moving a task, and `doing`/`dropped` are deliberate choices from the menu —
 * none of them belong in a cycle you might hit by accident.
 */
const CHECK_CYCLE = { todo: 'done', done: 'todo', doing: 'done', dropped: 'todo', moved: 'todo' }

const STATUS_LABEL = {
  todo: 'Not done', doing: 'In progress', done: 'Done',
  maybe: 'Might do', moved: 'Moved', dropped: 'Dropped',
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240]

const FINISHED = ['done', 'dropped', 'moved']

/** Notes keep a one-line summary in `title` so lists and search have something to show. */
function firstLine(text = '') {
  const line = text.split('\n').find((l) => l.trim()) || 'Note'
  return line.replace(/^#+\s*/, '').slice(0, 120)
}

/**
 * `created_at` is written by SQLite's datetime('now'), which is UTC — so it has
 * to be read as UTC and rendered in local time, or every note is hours off.
 */
function createdClock(created) {
  if (!created) return ''
  const d = new Date(`${created.replace(' ', 'T')}Z`)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** A URL shown as its service, not as 80 characters of query string. */
function linkLabel(url = '') {
  try {
    const { hostname, pathname } = new URL(url)
    const host = hostname.replace(/^www\./, '')
    const known = {
      'meet.google.com': 'Google Meet',
      'zoom.us': 'Zoom',
      'teams.microsoft.com': 'Teams',
      'calendar.google.com': 'Calendar',
    }
    return known[host] || known[host.split('.').slice(-2).join('.')]
      || host + (pathname.length > 1 ? pathname.slice(0, 18) : '')
  } catch {
    return url.slice(0, 32)
  }
}

export function spanMinutes(start, end) {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = eh * 60 + em - (sh * 60 + sm)
  return mins > 0 ? mins : null
}

/**
 * Minutes in a branch of subtasks, all the way down. A task's time is its own
 * estimate, or the span between its start and end when it has one — the same
 * rule the day's totals use, so a parent's chip and the day bar never disagree.
 * Work that is dropped or moved away is not time you are going to spend.
 */
export function branchMinutes(tasks = []) {
  return tasks.reduce((sum, t) => {
    if (t.kind === 'note' || FINISHED.slice(1).includes(t.status)) return sum
    const own = t.estimate_min || spanMinutes(t.start_time, t.end_time) || 0
    return sum + own + branchMinutes(t.subtasks || [])
  }, 0)
}

function StatusBox({ status, optional, meeting, onClick, onToggleOptional }) {
  const glyph = {
    done: <Icon name="check" size={11} strokeWidth={3} />,
    moved: <Icon name="arrowRight" size={10} strokeWidth={3} />,
    dropped: <Icon name="x" size={10} strokeWidth={3} />,
    doing: <span className="glyph-dot" />,
  }[status]

  return (
    <button
      className={[
        'task-check', `st-${status}`,
        optional ? 'is-optional' : '',
        // A meeting is an appointment, not a to-do: rounding the box marks it
        // as something that happens at a time rather than something you finish.
        meeting ? 'is-meeting' : '',
      ].filter(Boolean).join(' ')}
      title={`${STATUS_LABEL[status]} · right-click to make it ${optional ? 'committed' : 'optional'}`}
      onClick={onClick}
      // The checkbox is where the commit/optional decision belongs: it is the
      // same control that answers "am I doing this", and it stays hittable when
      // the title is in an editor.
      onContextMenu={(e) => { e.preventDefault(); onToggleOptional?.() }}
    >
      {glyph}
    </button>
  )
}

export default function TaskRow({
  task,
  subtasks = [],
  onChange,
  onDelete,
  onNest,
  onDropTask,
  onAddChild,
  showProject = true,
  draggable = true,
  depth = 0,
  listIds = [],
  autoEdit = false,
}) {
  const [details, setDetails] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [zone, setZone] = useState(null)
  // True while a title or the notes box in this row has focus. A `draggable`
  // ancestor swallows the mousedown that would place a caret, so clicking
  // into the middle of text did nothing and the field stayed fully selected.
  // Dropping draggable for the duration also stops a text selection that runs
  // past the edge of the row from turning into a drag.
  const [texting, setTexting] = useState(false)
  const sel = useSelection()
  const rowRef = useRef(null)

  /**
   * Clicking away puts the time panel away. It is a menu, not a part of the
   * row, and leaving it open on every task you had ever inspected turned the
   * list into a wall of open drawers. Notes are deliberately not covered by
   * this: their visibility is a saved property of the task (`notes_hidden`),
   * so they are content rather than a transient menu and stay put.
   */
  useEffect(() => {
    if (!details) return
    function away(e) {
      if (!rowRef.current?.contains(e.target)) setDetails(false)
    }
    // mousedown, not click: a click that starts inside and ends outside (a
    // drag, or a select that runs past the edge) should not count as leaving.
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [details])

  const picked = !!sel?.has(task.id)
  const isNote = task.kind === 'note'
  const isMeeting = task.kind === 'meeting'
  const attendees = task.people || []
  const accepts = !!(onDropTask || onNest)
  const notesShown = !!task.notes && !task.notes_hidden

  const overdue = task.due_date && task.due_date < today() && !FINISHED.includes(task.status)
  const timed = task.start_time || task.end_time
  const derived = spanMinutes(task.start_time, task.end_time)
  const own = task.estimate_min || derived || 0
  const childMinutes = branchMinutes(subtasks)

  // Indented rows are narrower, so the full hover bar can cover the title it is
  // meant to sit beside — and then there is nothing left to click to edit the
  // text. Past the first level the bar keeps only the two controls used while
  // reading a list, and everything else moves into the overflow menu.
  const roomy = depth === 0

  function zoneFor(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    if (y < 0.28) return 'before'
    if (y > 0.72) return 'after'
    return 'nest'
  }

  return (
    <>
      <div
        ref={rowRef}
        className={[
          'task', task.status, isNote ? 'is-note' : '', isMeeting ? 'is-meeting' : '',
          task.optional ? 'is-optional' : '', zone ? `drop-${zone}` : '',
          picked ? 'sel-on' : '', sel?.size ? 'sel-armed' : '',
        ].join(' ')}
        style={depth ? { marginLeft: depth * 22 } : undefined}
        draggable={draggable && !texting}
        onDragStart={(e) => {
          e.stopPropagation()
          e.dataTransfer.setData('text/task-id', String(task.id))
          // Dragging a selected row carries the whole selection; the single id
          // stays for targets that only ever understood one.
          if (picked) e.dataTransfer.setData('text/task-ids', JSON.stringify([...sel.ids]))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          if (!accepts) return
          e.preventDefault()
          e.stopPropagation()
          setZone(zoneFor(e))
        }}
        onDragLeave={() => setZone(null)}
        onDrop={(e) => {
          if (!accepts) return
          const id = Number(e.dataTransfer.getData('text/task-id'))
          const dropped = zone || zoneFor(e)
          setZone(null)
          if (!id || id === task.id) return
          e.preventDefault()
          e.stopPropagation()
          if (onDropTask) onDropTask(id, task, dropped)
          else if (dropped === 'nest') onNest(id, task.id)
        }}
      >
        {sel && (
          <button
            className={`sel-check ${picked ? 'is-on' : ''}`}
            role="checkbox"
            aria-checked={picked}
            title={picked ? 'Deselect' : 'Select — shift-click for a range'}
            onClick={(e) => {
              e.stopPropagation()
              if (e.shiftKey) sel.selectRange(task.id, listIds)
              else sel.toggle(task.id)
            }}
          >
            <Icon name="check" size={10} strokeWidth={3} />
          </button>
        )}

        {subtasks.length > 0 ? (
          <button
            className="task-twist"
            title={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
            onClick={() => setExpanded(!expanded)}
          >
            <Icon name={expanded ? 'chevronDown' : 'right'} size={12} />
          </button>
        ) : (
          // The spacer is rendered at every depth, not just inside a subtree.
          // Without it a parent's twist pushed its checkbox right while a
          // childless task beside it kept the original position, so the boxes
          // in one column no longer lined up — and whether a row happened to
          // have children became a visual difference in the wrong place.
          <span className="task-twist" aria-hidden="true" />
        )}

        {isNote ? (
          <>
            <span className="task-note-mark" aria-hidden="true" />
            <time className="task-note-time">{createdClock(task.created_at)}</time>
          </>
        ) : (
          <StatusBox
            status={task.status}
            optional={task.optional}
            meeting={isMeeting}
            onClick={() => onChange({ status: CHECK_CYCLE[task.status] })}
            onToggleOptional={() => onChange({ optional: task.optional ? 0 : 1 })}
          />
        )}

        <div className="task-body">
          {isNote ? (
            <RichEditor
              value={task.notes || task.title}
              onChange={(notes) => onChange({ notes, title: firstLine(notes) })}
              placeholder="Write a note…"
              rows={3}
              draftKey={`task:${task.id}`}
            />
          ) : (
            <div
              className="task-title"
              // Right-click is free here: the browser menu offers nothing useful
              // on a task title, and marking something optional is the call you
              // make most often while planning a day.
              onContextMenu={(e) => {
                e.preventDefault()
                onChange({ optional: task.optional ? 0 : 1 })
              }}
              title={task.optional ? 'Right-click to make it committed' : 'Right-click to make it optional'}
            >
              <RichLine
                value={task.title}
                onChange={(title) => title.trim() && onChange({ title })}
                placeholder="Task"
                autoEdit={autoEdit}
                onEditing={setTexting}
              />
            </div>
          )}

          <div className="task-meta" hidden={isNote}>
            {timed && (
              <span className="chip c-blue">
                <Icon name="clock" size={11} />
                {task.start_time || '—'}{task.end_time ? `–${task.end_time}` : ''}
              </span>
            )}
            {/* Always shown, next to the clock: priority is set from here now,
                so hiding the common case would hide the control too. */}
            <PriorityChip level={task.priority} onChange={(p) => onChange({ priority: p })} />
            {/* One click, because tagging every task by hand is what kills these
                systems — the default arrives by inheritance. */}
            <button
              className={`chip ${task.intensity === 'deep' ? 'is-deep' : ''}`}
              title={task.intensity === 'deep'
                ? 'Deep work — counts toward the thinking budget'
                : 'Mark as deep work'}
              onClick={() => onChange({ intensity: task.intensity === 'deep' ? 'light' : 'deep' })}
            >
              {task.intensity === 'deep' ? 'deep' : 'light'}
            </button>
            {showProject && task.project_name && (
              <span className={`chip ${cls(task.project_color)}`}>{task.project_name}</span>
            )}
            {/* A parent shows its own time and its children's separately. The
                sum alone would hide the fact that the parent carries time of its
                own, and the parent's alone understates what the branch costs. */}
            {/* `> 0`, not a bare truthiness test: with neither an estimate nor
                timed children, `own || childMinutes` is the NUMBER zero, and
                React renders a literal "0" into the row rather than nothing. */}
            {(own || childMinutes) > 0 && (
              <span
                className="chip"
                title={childMinutes
                  ? `${minutesLabel(own) || '0m'} here, ${minutesLabel(childMinutes)} in subtasks — ${minutesLabel(own + childMinutes)} in all`
                  : undefined}
              >
                {own ? minutesLabel(own) : ''}
                {own && childMinutes ? ' + ' : ''}
                {childMinutes ? minutesLabel(childMinutes) : ''}
              </span>
            )}
            {task.optional === 1 && <span className="chip is-optional">optional</span>}
            {task.status === 'moved' && task.moved_to_date && (
              <span className="chip c-blue">→ {shortDate(task.moved_to_date)}</span>
            )}
            {task.due_date && (
              <span
                className="chip"
                style={overdue ? { background: 'var(--red-soft)', color: 'var(--red)' } : undefined}
              >
                due {shortDate(task.due_date)}
              </span>
            )}
            {subtasks.length > 0 && (
              <span className="chip">
                {subtasks.filter((s) => s.status === 'done').length}/{subtasks.length} subtasks
              </span>
            )}
          </div>

          {/* A meeting's join link and its people are the two things you reach
              for in the moment, so they sit under the title as their own line
              rather than as one more chip in the row above. */}
          {isMeeting && (task.url || attendees.length > 0 || task.location) && (
            <div className="task-sub">
              {task.url && (
                <a
                  className="task-sub-link"
                  href={task.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Icon name="link" size={11} /> {linkLabel(task.url)}
                </a>
              )}
              {task.location && (
                <span className="task-sub-item"><Icon name="building" size={11} /> {task.location}</span>
              )}
              {attendees.length > 0 && (
                <span className="task-sub-item">
                  <Icon name="people" size={11} />
                  {attendees.map((p) => p.name).join(', ')}
                </span>
              )}
            </div>
          )}

          {details && (
            <TaskDetails
              task={task}
              derived={derived}
              onChange={onChange}
              onDone={() => setDetails(false)}
            />
          )}

          {/* Notes are visible by default — hiding is the deliberate act. */}
          {!isNote && notesShown && (
            <div className="task-notes">
              <RichEditor
                value={task.notes}
                onChange={(notes) => onChange({ notes })}
                placeholder="Notes — markdown, links, images, $math$"
                rows={3}
                draftKey={`task:${task.id}`}
                onEditing={setTexting}
              />
            </div>
          )}
        </div>

        <div className="task-actions">
          {!isNote && (
            <button
              className={`btn ghost sm ${details ? 'is-on' : ''}`}
              title="Time and duration"
              onClick={() => setDetails(!details)}
            >
              <Icon name="clock" size={13} />
            </button>
          )}
          {!isNote && roomy && (
            <button
              className={`btn ghost sm ${notesShown ? 'is-on' : ''}`}
              title={notesShown ? 'Hide notes' : 'Show notes'}
              onClick={() => onChange({
                notes_hidden: notesShown ? 1 : 0,
                ...(task.notes ? {} : { notes: ' ' }),
              })}
            >
              <Icon name="templates" size={13} />
            </button>
          )}
          {onAddChild && !isNote && roomy && (
            <button className="btn ghost sm" title="Add subtask" onClick={() => onAddChild(task)}>
              <Icon name="subtask" size={13} />
            </button>
          )}
          {roomy && (
            <button className="btn ghost sm danger" title="Delete" onClick={() => onDelete()}>
              <Icon name="trash" size={13} />
            </button>
          )}
          <Menu
            task={task}
            isNote={isNote}
            onChange={onChange}
            onNest={onNest}
            onDelete={onDelete}
            onAddChild={onAddChild}
            notesShown={notesShown}
            /* Whatever the bar dropped for want of room reappears in here, so
               nothing becomes unreachable on a nested row. */
            overflow={!roomy}
          />
        </div>
      </div>

      {expanded && subtasks.map((child) => (
        <TaskRow
          key={child.id}
          task={child}
          subtasks={child.subtasks || []}
          // The id must be forwarded, not closed over: at depth 2+ the child's
          // own handler would otherwise swallow the grandchild's id and act on
          // itself — deleting A.1 would delete A.
          onChange={(patch, id = child.id) => onChange(patch, id)}
          onDelete={(id = child.id) => onDelete(id)}
          onNest={onNest}
          onDropTask={onDropTask}
          onAddChild={onAddChild}
          showProject={showProject}
          // Forwarded, not defaulted: a list that does not accept drops turns
          // dragging off, and a child left draggable there is an affordance
          // that leads nowhere.
          draggable={draggable}
          depth={depth + 1}
          listIds={listIds}
        />
      ))}
    </>
  )
}

/**
 * A field that is typed into locally and only reported when the edit is over.
 *
 * This exists because the obvious version is broken. `<input type="time">` is
 * segmented: while you are partway through typing, the hour is set but the
 * minute is not, and the browser reports `value === ''` for the whole control.
 * Saving on every keystroke therefore wrote null, the save refreshed the day,
 * the refresh pushed `value=''` back into a *controlled* input, and that wiped
 * the digits already typed — so the field emptied itself as you used it and no
 * time could ever be entered. The same trap applies to the minutes box, where
 * typing "90" would otherwise commit "9" first.
 *
 * Editing is local until blur or Enter; the value from the server is only
 * adopted while the field is not being edited.
 */
function CommittedField({ value, onCommit, onDone, parse = (v) => v || null, ...rest }) {
  const [draft, setDraft] = useState(value ?? '')
  const [editing, setEditing] = useState(false)

  // Follow the task while idle, but never yank the field out from under a
  // half-finished entry.
  useEffect(() => { if (!editing) setDraft(value ?? '') }, [value, editing])

  const commit = () => {
    setEditing(false)
    const next = parse(draft)
    // Show the normalised form ("9" becomes 09:00) rather than leaving the
    // shorthand sitting in the box as though it had not been understood.
    setDraft(next ?? '')
    if (next !== (value ?? null)) onCommit(next)
    return next
  }

  return (
    <input
      className="input"
      value={draft}
      onChange={(e) => { setEditing(true); setDraft(e.target.value) }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); onDone?.() }
        if (e.key === 'Escape') { setEditing(false); setDraft(value ?? '') }
      }}
      {...rest}
    />
  )
}

/**
 * Read a time the way a person writes one, so the common case costs one
 * keystroke instead of four. The minute defaults to :00 because a bare hour is
 * what you almost always mean.
 *
 *   9      → 09:00        930   → 09:30
 *   9:3    → 09:30        0930  → 09:30
 *   9p     → 21:00        14    → 14:00
 *
 * Anything that is not a time at all clears the field rather than guessing.
 */
export function parseTime(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null

  const m = s.match(/^(\d{1,4})(?::(\d{1,2}))?\s*(am?|pm?)?$/)
  if (!m) return null

  const digits = m[1]
  let hour
  let min

  if (m[2] !== undefined) {
    hour = Number(digits)
    // "9:3" is half past nine, not nine oh-three.
    min = Number(m[2].length === 1 ? `${m[2]}0` : m[2])
  } else if (digits.length <= 2) {
    hour = Number(digits)
    min = 0
  } else {
    // "930" and "1430" run the hour and minute together. Splitting from the
    // right is what makes both a 3- and a 4-digit form work.
    hour = Number(digits.slice(0, -2))
    min = Number(digits.slice(-2))
  }

  const suffix = m[3]?.[0]
  if (suffix === 'p' && hour < 12) hour += 12
  if (suffix === 'a' && hour === 12) hour = 0

  if (hour > 23 || min > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function TaskDetails({ task, derived, onChange, onDone }) {
  // Changing how long something takes should move it to the column for that
  // length. A drag pins a task with an explicit col_index, which would other-
  // wise outrank the new duration forever and leave a 90-minute task sitting in
  // the ten-minute box; re-stating the duration releases that pin.
  const reflow = (patch) => onChange({ ...patch, col_index: null })

  return (
    <div className="task-details">
      <label>
        <span>Start</span>
        {/* A text box rather than <input type="time">: the native control has
            no notion of "9 means nine o'clock", and forces four keystrokes and
            a segment jump for every entry. */}
        <CommittedField
          type="text" inputMode="numeric" placeholder="9 or 9:30" style={{ width: 92 }}
          value={task.start_time}
          parse={parseTime}
          onCommit={(start_time) => reflow({ start_time })}
          onDone={onDone}
        />
      </label>
      <label>
        <span>End</span>
        <CommittedField
          type="text" inputMode="numeric" placeholder="—" style={{ width: 92 }}
          value={task.end_time}
          parse={parseTime}
          onCommit={(end_time) => reflow({ end_time })}
          onDone={onDone}
        />
      </label>

      <div className="task-durations">
        <span>Duration</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          {DURATIONS.map((m) => (
            <button
              key={m}
              className={`btn sm ${task.estimate_min === m ? 'primary' : ''}`}
              onClick={() => reflow({ estimate_min: task.estimate_min === m ? null : m })}
            >
              {minutesLabel(m)}
            </button>
          ))}
          <CommittedField
            type="number" min="0" step="5" style={{ width: 78 }} placeholder="min"
            value={task.estimate_min}
            parse={(v) => (v === '' ? null : Number(v))}
            onCommit={(estimate_min) => reflow({ estimate_min })}
            onDone={onDone}
          />
          {derived && !task.estimate_min && (
            <span className="muted" style={{ fontSize: 11.5 }}>
              {minutesLabel(derived)} from the times above
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function Menu({ task, isNote, onChange, onNest, onDelete, onAddChild, notesShown, overflow }) {
  return (
    <Popover
      label="Task actions"
      className="menu"
      trigger={(p) => (
        <button {...p} className="btn ghost sm" title="More">
          <Icon name="dots" size={13} />
        </button>
      )}
    >
      {(close) => (
        <MenuItems
          task={task}
          isNote={isNote}
          onChange={onChange}
          onNest={onNest}
          onDelete={onDelete}
          onAddChild={onAddChild}
          notesShown={notesShown}
          overflow={overflow}
          close={close}
        />
      )}
    </Popover>
  )
}

/**
 * Split out so "Move to…" starts collapsed every time: the popover only mounts
 * its content while open, so this state resets itself.
 */
function MenuItems({
  task, isNote, onChange, onNest, onDelete, onAddChild, notesShown, overflow, close,
}) {
  const [moving, setMoving] = useState(false)

  const item = (label, fn) => (
    <button className="menu-item" onClick={() => { fn(); close() }}>{label}</button>
  )

  /** Moving records where the task went, so the old day can still show the trail. */
  const moveTo = (date) => onChange({ scheduled_date: date, status: 'moved', moved_to_date: date })

  return (
    <>
      {overflow && (
        <>
          {!isNote && item(notesShown ? 'Hide notes' : 'Show notes', () => onChange({
            notes_hidden: notesShown ? 1 : 0,
            ...(task.notes ? {} : { notes: ' ' }),
          }))}
          {!isNote && onAddChild && item('Add subtask', () => onAddChild(task))}
          {item('Delete', () => onDelete())}
          <div className="menu-sep" />
        </>
      )}
      {/* Only a task with no parent of its own: a sub-section is a heading band
          across the whole width, and a nested one has nowhere to span. */}
      {!isNote && !task.parent_id && (
        <>
          {task.subsection
            ? item('Back to an ordinary task', () => onChange({ subsection: 0 }))
            : item('Make a sub-section', () => onChange({ subsection: 1 }))}
          <div className="menu-sep" />
        </>
      )}
      {!isNote && (
        <>
          {task.status === 'doing'
            ? item('Not in progress', () => onChange({ status: 'todo' }))
            : item('Mark in progress', () => onChange({ status: 'doing' }))}
          {task.status === 'dropped'
            ? item('Undrop', () => onChange({ status: 'todo' }))
            : item('Drop', () => onChange({ status: 'dropped' }))}
          <div className="menu-sep" />
        </>
      )}

      {task.scheduled_date && item('Move to tomorrow', () => moveTo(addDays(task.scheduled_date, 1)))}

      {moving ? (
        <div className="menu-move">
          <input
            className="input"
            type="date"
            autoFocus
            defaultValue={task.scheduled_date || today()}
            onChange={(e) => {
              if (!e.target.value) return
              moveTo(e.target.value)
              close()
            }}
          />
        </div>
      ) : (
        <button className="menu-item" onClick={() => setMoving(true)}>Move to…</button>
      )}

      {task.scheduled_date
        ? item('Send to backlog', () => onChange({ scheduled_date: null, status: 'todo', moved_to_date: null }))
        : item('Schedule today', () => onChange({ scheduled_date: today() }))}

      {task.parent_id && onNest && item('Move out of parent', () => onNest(task.id, null))}
    </>
  )
}

/** Compact one-line form used by the week and month grids. */
export function MiniTask({ task, onToggle, childCount = 0 }) {
  return (
    <div className={`mini ${task.status}`} draggable
      onDragStart={(e) => {
        e.stopPropagation()
        e.dataTransfer.setData('text/task-id', String(task.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <StatusBox status={task.status} onClick={onToggle} />
      <span className="dot"
        style={{ background: `var(--${task.project_color || 'gray'})`, width: 6, height: 6, flexBasis: 6 }} />
      <span className="mtitle" title={task.title}>{task.title}</span>
      {task.start_time && <span className="mtime">{task.start_time}</span>}
      {childCount > 0 && <span className="mtime">{childCount}</span>}
    </div>
  )
}

/** A nested list flattened into render order — what a shift-click range spans. */
export function visibleIds(tree = []) {
  const out = []
  const walk = (rows) => {
    for (const t of rows) { out.push(t.id); walk(t.subtasks || []) }
  }
  walk(tree)
  return out
}

/**
 * Flat task rows -> a parent/child forest. Children whose parent is missing
 * from the current view are promoted to the top level so nothing disappears.
 */
export function nestTasks(tasks = []) {
  const byId = new Map(tasks.map((t) => [t.id, { ...t, subtasks: [] }]))
  const roots = []
  for (const task of byId.values()) {
    const parent = task.parent_id != null ? byId.get(task.parent_id) : null
    if (parent) parent.subtasks.push(task)
    else roots.push(task)
  }
  return roots
}
