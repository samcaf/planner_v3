import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import TaskComments from './TaskComments.jsx'
import AiSwitches from './AiSwitches.jsx'
import AiPrompt from './AiPrompt.jsx'
import Popover from './Popover.jsx'
import TaskTimer from './TaskTimer.jsx'
import TimeGlyph from './TimeGlyph.jsx'
import { isSectionDrag, useSelection } from './Selection.jsx'
import { PriorityChip } from './Priority.jsx'
import { isDialogue } from '../lib/columns.js'
import { flashTask } from '../lib/threads.js'
import { Rich, RichEditor, RichLine, plainTitle } from '../lib/rich.jsx'
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

const DURATIONS = [5, 15, 30, 45, 60, 90, 180]

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

function StatusBox({ status, optional, meeting, onClick, onToggleOptional, onDrop }) {
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
      title={[
        STATUS_LABEL[status],
        `right-click to make it ${optional ? 'committed' : 'optional'}`,
        `shift-click to ${status === 'dropped' ? 'undrop' : 'drop'} it`,
      ].join(' · ')}
      // Three answers to "am I doing this", on one control. A plain click is
      // done/not-done, right-click is optional, and shift-click drops — which
      // used to be four levels down an overflow menu, so the quickest way to
      // abandon something was slower than doing it.
      onClick={(e) => {
        if (e.shiftKey) { e.preventDefault(); onDrop?.(); return }
        onClick?.(e)
      }}
      // The checkbox is where the commit/optional decision belongs: it is the
      // same control that answers "am I doing this", and it stays hittable when
      // the title is in an editor.
      onContextMenu={(e) => { e.preventDefault(); onToggleOptional?.() }}
    >
      {glyph}
    </button>
  )
}

/** What each kind of row in an exchange is, said in words when hovered. */
const AI_ROLE_HINT = {
  brief: 'what you asked for',
  question: 'a question the AI needs answered before it can go on',
  answer: 'what the AI did',
  step: 'a step the AI raised for itself',
  followup: 'something the AI suggests doing next',
  check: 'something the AI wants you to look at yourself',
}

export default function TaskRow({
  task,
  subtasks = [],
  onChange,
  onDelete,
  onNest,
  onDropTask,
  onAddChild,
  // Move or copy this task to another day. The server does it, because either
  // way the task's section has to be found or made on the far side.
  onReschedule,
  // The section this row is drawn in, when it is drawn in one. Only a dialogue
  // section changes anything: its rows carry the AI's terms instead of a
  // duration, and say who wrote them.
  section = null,
  // Which exchange this row belongs to, and whether that exchange is currently
  // being pointed at. See lib/threads.js — the board separates a brief from
  // its follow-ups on purpose, so something has to say they are one thing.
  thread = null,
  threadLit = false,
  onThread,
  // What this row's terms fall back to: the conversation's, and under that
  // your defaults from Settings. Resolved by the section, which is the only
  // thing that knows both.
  aiInherited = null,
  // The instruction layers above this task — the conversation's and yours —
  // shown alongside its own so it is clear they all apply rather than
  // competing. Resolved by the section, which is the only thing that knows.
  aiPromptAbove = [],
  showProject = true,
  // Whether the subtree is drawn here. A sub-section band already lays its
  // children out beneath the heading, so the heading itself must not repeat
  // them — but it still needs them, because its time and its column are the
  // sum of the whole branch.
  renderChildren = true,
  draggable = true,
  depth = 0,
  listIds = [],
  // The id of the row that was just created, if any. One value handed down the
  // whole tree, rather than a boolean that only ever reached the top level —
  // which is why a new SUBTASK never opened ready to type.
  autoEditId = null,
  // A routine item is a template: it has no day of its own, so every entry
  // that schedules something is hidden rather than left to fail quietly.
  dateless = false,
  // Controls only one caller needs — a routine item's project override and
  // its shelve toggle — rendered into the action bar without this component
  // having to learn what a routine is.
  rowExtras = null,
}) {
  const [details, setDetails] = useState(false)
  // Set only when the panel was opened by Tab, so the time box grabs the caret
  // then and not when the panel is opened by clicking the clock — a click has
  // already said where the user wants to be.
  const [tabbed, setTabbed] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [zone, setZone] = useState(null)
  // True while a title or the notes box in this row has focus. A `draggable`
  // ancestor swallows the mousedown that would place a caret, so clicking
  // into the middle of text did nothing and the field stayed fully selected.
  // Dropping draggable for the duration also stops a text selection that runs
  // past the edge of the row from turning into a drag.
  const [texting, setTexting] = useState(false)
  // True from the moment the bar below a task is clicked until that note is
  // committed. Clicking "add a note" should land you in the text, not in a
  // preview of the single space that opening it wrote.
  const [openingNote, setOpeningNote] = useState(false)
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
      if (!rowRef.current?.contains(e.target)) { setDetails(false); setTabbed(false) }
    }
    // mousedown, not click: a click that starts inside and ends outside (a
    // drag, or a select that runs past the edge) should not count as leaving.
    //
    // Capture phase, so this runs BEFORE the button that was pressed. Pressing
    // another row's clock used to close this panel and stop there — the close
    // re-rendered the list, the press never reached its own handler, and it
    // took two clicks to move between two tasks' time panels.
    document.addEventListener('mousedown', away, true)
    return () => document.removeEventListener('mousedown', away, true)
  }, [details])

  /**
   * A drop marker has to be cleared by the END of the drag, not only by leaving
   * the row. `dragleave` is missed whenever the pointer goes straight from a
   * row onto one of its own children, or the drag is abandoned with Escape, or
   * it ends over something that never handles it — and the line then sits there
   * pointing at a move that is not going to happen.
   *
   * `dragend` and `drop` both bubble to the document, so one pair of listeners
   * catches every ending, and they are only attached while a marker is up.
   */
  useEffect(() => {
    if (!zone) return
    const clear = () => setZone(null)
    document.addEventListener('dragend', clear)
    document.addEventListener('drop', clear)
    return () => {
      document.removeEventListener('dragend', clear)
      document.removeEventListener('drop', clear)
    }
  }, [zone])

  const picked = !!sel?.has(task.id)
  const isNote = task.kind === 'note'
  const isMeeting = task.kind === 'meeting'
  const dialogue = isDialogue(section)
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
  const isParent = subtasks.length > 0

  function zoneFor(e) {
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    if (y < 0.28) return 'before'
    if (y > 0.72) return 'after'
    return 'nest'
  }

  // Hoisted so the same controls can hang in either place: beside the text on
  // an ordinary row, and beneath it on a parent — whose title is the one most
  // likely to be long, and which can least afford to lose the width.
  const actions = (
    <div className="task-actions">
      {rowExtras?.(task)}
      {!isNote && (
        <button
          className={`btn ghost sm ${details ? 'is-on' : ''}`}
          title="Time and duration"
          onClick={() => { setTabbed(false); setDetails(!details) }}
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
        dateless={dateless}
        onChange={onChange}
        onNest={onNest}
        onDelete={onDelete}
        onAddChild={onAddChild}
        onReschedule={onReschedule}
        notesShown={notesShown}
        /* Whatever the bar dropped for want of room reappears in here, so
           nothing becomes unreachable on a nested row. */
        overflow={!roomy}
      />
    </div>
  )

  return (
    <>
      <div
        ref={rowRef}
        // Keyboard control finds its cursor by reading these off the page, so
        // every view that draws tasks gets it without knowing that it has.
        data-task-id={task.id}
        data-answers={task.answers_id ?? undefined}
        // Read by the vim layer, so moving the cursor onto a row lights the
        // rest of its exchange the way pointing at it does. An attribute
        // rather than shared state: the two layers do not otherwise know
        // about each other, and this is the whole of what they need to.
        data-thread={thread?.size > 1 ? thread.key : undefined}
        className={[
          'task', task.status, isNote ? 'is-note' : '', isMeeting ? 'is-meeting' : '',
          task.optional ? 'is-optional' : '', zone ? `drop-${zone}` : '',
          picked ? 'sel-on' : '', sel?.size ? 'sel-armed' : '',
          dialogue ? 'is-ai' : '',
          // Only an exchange with more than one row is worth marking; a lone
          // task would carry a rule that pointed at nothing.
          dialogue && thread?.size > 1 ? `in-thread thread-${thread.tint}` : '',
          threadLit ? 'thread-lit' : '',
          dialogue && task.origin === 'ai' ? 'by-ai' : '',
          dialogue && task.ai_role ? `role-${task.ai_role}` : '',
          dialogue && !task.seen ? 'is-unread' : '',
        ].filter(Boolean).join(' ')}
        style={depth ? { marginLeft: depth * 22 } : undefined}
        // Pointing at any row in an exchange lights the rest of it, wherever on
        // the board they happen to have been dealt.
        onMouseEnter={thread?.size > 1 ? () => onThread?.(thread.key) : undefined}
        onMouseLeave={thread?.size > 1 ? () => onThread?.(null) : undefined}
        draggable={draggable && !texting}
        // Releasing the drag on focus is too late to select text with the
        // mouse: the gesture that selects begins with the mousedown, and by
        // then the row is still draggable, so the browser starts carrying the
        // task instead of sweeping a selection. Catching the press on the way
        // down — before the drag can begin — is what makes dragging across a
        // notes box or an open title select the words in it.
        //
        // Only real editing surfaces count. The title's rendered text is left
        // draggable on purpose, because that is how a row is picked up.
        onMouseDownCapture={(e) => {
          if (e.target.closest('input, textarea, [contenteditable], .rich-view')) setTexting(true)
        }}
        onDragStart={(e) => {
          e.stopPropagation()
          e.dataTransfer.setData('text/task-id', String(task.id))
          // Dragging a selected row carries the whole selection; the single id
          // stays for targets that only ever understood one.
          if (picked) e.dataTransfer.setData('text/task-ids', JSON.stringify([...sel.ids]))
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          // A section being carried is not a task and must not be offered a
          // place among them: without this every row lit up its own drop zones
          // and the section tried to nest itself into one, which is why moving
          // a section around felt like it was latching on to things.
          if (!accepts || isSectionDrag(e)) return
          e.preventDefault()
          e.stopPropagation()
          setZone(zoneFor(e))
        }}
        onDragLeave={() => setZone(null)}
        onDrop={(e) => {
          if (!accepts || isSectionDrag(e)) return
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
        {/* The old plain checkbox is gone: this both says how long the task is
            and is what selects it, so the row spends no width on a control that
            only did the latter. */}
        {sel && !isNote && (
          <TimeGlyph
            minutes={own + childMinutes}
            selected={picked}
            label={task.title}
            onSelect={(e) => {
              e.stopPropagation()
              if (e.shiftKey) sel.selectRange(task.id, listIds)
              else sel.toggle(task.id)
            }}
          />
        )}
        {sel && isNote && <span className="time-glyph" aria-hidden="true" />}

        {isNote ? (
          <>
            <span className="task-note-mark" aria-hidden="true" />
            <time className="task-note-time">{createdClock(task.created_at)}</time>
          </>
        ) : (
          <span className="task-box">
            <StatusBox
              status={task.status}
              optional={task.optional}
              meeting={isMeeting}
              onClick={() => onChange({ status: CHECK_CYCLE[task.status] })}
              onToggleOptional={() => onChange({ optional: task.optional ? 0 : 1 })}
              onDrop={() => onChange({ status: task.status === 'dropped' ? 'todo' : 'dropped' })}
            />
            {/* Under the box, not beside it. To the left it pushed the checkbox
                out of line with every childless row in the same column, and
                whether a task happened to have children became a difference
                in the wrong place. */}
            {/* Only where this row is the one drawing the children. A
                sub-section heading counts its branch but does not draw it — the
                band below does — so a twist here toggled a list nothing was
                rendering from. It sat inches from the band's own twist, looked
                identical, and did nothing at all when clicked. */}
            {subtasks.length > 0 && renderChildren && (
              <button
                className="task-twist"
                title={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                <Icon name={expanded ? 'chevronDown' : 'right'} size={12} />
              </button>
            )}
          </span>
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
              // Tab out of the title goes to the timing panel rather than to
              // whatever control the DOM happens to have next. Naming a task
              // and saying how long it takes is one thought, and this is the
              // keystroke that already means "next field".
              onKeyDown={(e) => {
                if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
                e.preventDefault()
                e.stopPropagation()
                setTabbed(true)
                setDetails(true)
              }}
              title={task.optional ? 'Right-click to make it committed' : 'Right-click to make it optional'}
            >
              <RichLine
                value={task.title}
                onChange={(title) => title.trim() && onChange({ title })}
                placeholder="Task"
                autoEdit={autoEditId === task.id}
                onEditing={setTexting}
              />
            </div>
          )}

          <div className="task-meta" hidden={isNote}>
            {/* Who wrote this, but only where it could be either of you. */}
            {dialogue && task.origin === 'ai' && (
              <span className="chip ai-badge" title="Written by the AI">
                <Icon name="sparkle" size={11} />
                AI
              </span>
            )}
            {/* The concrete half of the association: where this came from, and
                what came of it. A tint says "these belong together"; this says
                which one, and takes you there. */}
            {dialogue && thread?.answers && (
              <button
                className="chip thread-link"
                title={`Answers “${plainTitle(thread.answers.title)}” — click to go to it`}
                onClick={(e) => { e.stopPropagation(); flashTask(thread.answers.id) }}
              >
                <Icon name="subtask" size={11} />
                {plainTitle(thread.answers.title).slice(0, 28) || 'the brief'}
              </button>
            )}
            {dialogue && thread?.replies > 0 && (
              <button
                className="chip thread-link"
                title={`${thread.replies} ${thread.replies === 1 ? 'reply' : 'replies'} — click to go to the first`}
                onClick={(e) => {
                  e.stopPropagation()
                  const reply = document.querySelector(`.task[data-answers="${task.id}"]`)
                  if (reply) flashTask(Number(reply.dataset.taskId))
                }}
              >
                <Icon name="arrowRight" size={11} />
                {thread.replies} {thread.replies === 1 ? 'reply' : 'replies'}
              </button>
            )}
            {dialogue && task.ai_role && (
              <span className="chip ai-role" title={`This is ${AI_ROLE_HINT[task.ai_role] || 'part of the exchange'}`}>
                {task.ai_role}
              </span>
            )}
            {/* Terms in place of a clock. A conversational task has no
                duration to speak of; what matters is how it should be worked. */}
            {dialogue && (
              <AiPrompt
                value={task.ai_prompt}
                onChange={(ai_prompt) => onChange({ ai_prompt })}
                label="Instructions for the AI, on this task"
                placeholder="How to go about it — what to prefer, what not to touch."
                inherited={aiPromptAbove}
              />
            )}
            {dialogue && (
              <AiSwitches
                label="How the AI should work this task"
                value={task.ai_switches}
                inherited={aiInherited || {}}
                onChange={(ai_switches) => onChange({ ai_switches })}
              />
            )}
            {!dialogue && timed && (
              <span className="chip c-blue">
                <Icon name="clock" size={11} />
                {task.start_time || '—'}{task.end_time ? `–${task.end_time}` : ''}
              </span>
            )}
            {/* Always shown, next to the clock: priority is set from here now,
                so hiding the common case would hide the control too. */}
            <PriorityChip level={task.priority} onChange={(p) => onChange({ priority: p })} />
            {/* Shown only when set. Unlike deep/light, most tasks are not code
                tasks, so an always-present toggle would be clutter on every
                row to serve a few. */}
            {!!task.is_code && (
              <button
                className="chip c-purple"
                title="A code task — click to unmark"
                onClick={() => onChange({ is_code: 0 })}
              >
                <Icon name="code" size={11} />
                code
              </button>
            )}
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
            {/* Keyed on the date alone, not on the status. Where a task came
                from is a fact about it that ticking it off does not undo — and
                losing the trail the moment you complete something is exactly
                when you most want to see that it had been pushed on. */}
            {task.moved_to_date && (
              <span className="chip c-blue" title={`Pushed on to ${task.moved_to_date}`}>
                → {shortDate(task.moved_to_date)}
              </span>
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
              {/* Both are references, not labels. A meeting names people and
                  a group; going from the meeting to whoever it is with was a
                  trip through the People page and a search. */}
              {task.group_name && (
                <Link
                  className="task-sub-link"
                  to={`/people?group=${task.group_id}`}
                  onClick={(e) => e.stopPropagation()}
                  title={`Everyone in ${task.group_name}`}
                >
                  <Icon name="building" size={11} /> {task.group_name}
                </Link>
              )}
              {attendees.length > 0 && (
                <span className="task-sub-item">
                  <Icon name="people" size={11} />
                  {attendees.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ', '}
                      <Link
                        className="task-sub-person"
                        to={`/people/${p.id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.name}
                      </Link>
                    </span>
                  ))}
                </span>
              )}
            </div>
          )}

          {details && (
            <TaskDetails
              task={task}
              derived={derived}
              onChange={onChange}
              onDone={() => { setDetails(false); setTabbed(false) }}
              focusTime={tabbed}
            />
          )}

          {/* Notes are visible by default — hiding is the deliberate act, and
              the menu is where you do it. */}
          {!isNote && notesShown && (
            <div className="task-notes">
              <RichEditor
                value={task.notes}
                onChange={(notes) => onChange({ notes })}
                placeholder="Notes — markdown, links, images, $math$"
                rows={3}
                draftKey={`task:${task.id}`}
                autoFocus={openingNote}
                onEditing={(on) => { setTexting(on); if (!on) setOpeningNote(false) }}
              />
            </div>
          )}

          {/* What happened to this task, kept apart from what you think about
              it. Below the notes because it is a record rather than a
              thought — and because most tasks have none, it shows nothing at
              all until there is something to show. */}
          {!isNote && (
            <TaskComments taskId={task.id} count={task.comment_count || 0} />
          )}

          {/* A task with nothing written keeps a sliver of reserved space rather
              than nothing at all: somewhere to aim at, and a standing invitation
              to write. It is deliberately shorter than a line of text, so a list
              of empty tasks does not read as double-spaced. Hiding notes from
              the menu takes even this away. */}
          {!isNote && !notesShown && !task.notes_hidden && (
            <button
              type="button"
              className="task-notes-stub"
              title="Add a note"
              onClick={() => { setOpeningNote(true); onChange({ notes: ' ', notes_hidden: 0 }) }}
            >
              <span />
            </button>
          )}

          {isParent && actions}
        </div>

        {!isParent && actions}
      </div>

      {renderChildren && expanded && subtasks.map((child) => (
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
          onReschedule={onReschedule}
          showProject={showProject}
          // A child is in the same conversation and the same exchange as its
          // parent — it is drawn from inside this row rather than from the
          // section, so it has no other way to learn either.
          section={section}
          aiInherited={aiInherited}
          aiPromptAbove={aiPromptAbove}
          thread={thread}
          threadLit={threadLit}
          onThread={onThread}
          autoEditId={autoEditId}
          // Forwarded, not defaulted: a list that does not accept drops turns
          // dragging off, and a child left draggable there is an affordance
          // that leads nowhere.
          draggable={draggable}
          dateless={dateless}
          rowExtras={rowExtras}
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
function CommittedField({
  value, onCommit, onDone, className = '', parse = (v) => v || null,
  selectOnMount = false, ...rest
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [editing, setEditing] = useState(false)
  const ref = useRef(null)

  // Focus AND select, not just focus: arriving here by Tab means the next thing
  // typed is the new time, so whatever is already in the box should be replaced
  // rather than appended to. Done with a ref rather than `autoFocus` because
  // autoFocus does not select, and only fires on the very first mount.
  useEffect(() => {
    if (!selectOnMount) return
    ref.current?.focus()
    ref.current?.select()
  }, [selectOnMount])

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
      ref={ref}
      className={`input ${className}`.trim()}
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
/**
 * A duration written the way it is spoken: "2h", "2h30m", "90", "45m", "1h5".
 * A bare number is minutes, since that is what the box is for; anything with an
 * `h` in it splits there. Nonsense clears the field rather than guessing.
 */
export function parseDuration(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null

  const hm = s.match(/^(\d+)h(?:(\d+)m?)?$/)
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0)

  const m = s.match(/^(\d+)m?$/)
  if (m) return Number(m[1])

  return null
}

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

function TaskDetails({ task, derived, onChange, onDone, focusTime = false }) {
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
          type="text" inputMode="numeric" placeholder="9 or 9:30" className="td-time"
          value={task.start_time}
          parse={parseTime}
          onCommit={(start_time) => reflow({ start_time })}
          onDone={onDone}
          selectOnMount={focusTime}
        />
      </label>
      <label>
        <span>End</span>
        <CommittedField
          type="text" inputMode="numeric" placeholder="—" className="td-time"
          value={task.end_time}
          parse={parseTime}
          onCommit={(end_time) => reflow({ end_time })}
          onDone={onDone}
        />
      </label>

      {/* Only for work whose length is a fact. A countdown against an estimate
          would be counting down to an opinion. */}
      <label className="td-fixed">
        <input
          type="checkbox"
          checked={!!task.fixed_time}
          onChange={(e) => onChange({ fixed_time: e.target.checked ? 1 : 0 })}
        />
        <span>Fixed length</span>
      </label>

      {/* Work that happens in a repository. Marked here rather than guessed
          from the wording, because what makes a task a code task is that you
          intend to sit down and write code for it — not that its title
          mentions a file. What reads it is the MCP server: an agent asking
          what today's code work is gets these, with the project's repo. */}
      <label className="td-fixed">
        <input
          type="checkbox"
          checked={!!task.is_code}
          onChange={(e) => onChange({ is_code: e.target.checked ? 1 : 0 })}
        />
        <span>Code task</span>
      </label>

      {!!task.fixed_time && <TaskTimer task={task} onChange={onChange} />}

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
            type="text" inputMode="text" className="td-mins" placeholder="90 or 2h30m"
            value={task.estimate_min}
            parse={parseDuration}
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

function Menu({
  task, isNote, onChange, onNest, onDelete, onAddChild, onReschedule,
  notesShown, overflow, dateless,
}) {
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
          dateless={dateless}
          onChange={onChange}
          onNest={onNest}
          onDelete={onDelete}
          onAddChild={onAddChild}
          onReschedule={onReschedule}
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
  task, isNote, onChange, onNest, onDelete, onAddChild, onReschedule,
  notesShown, overflow, dateless, close,
}) {
  // Which of the two date pickers is open, if either.
  const [sub, setSub] = useState(null)

  const item = (label, fn) => (
    <button className="menu-item" onClick={() => { fn(); close() }}>{label}</button>
  )

  return (
    <>
      {/* The notes toggle is here on every row, not only on the narrow ones
          that lost their hover bar: it is the way to put the stub away as well
          as the editor, and hunting for a hover-only control to do that is not
          a thing anyone should have to do. */}
      {!isNote && item(notesShown || !task.notes_hidden ? 'Hide notes' : 'Show notes', () => onChange({
        notes_hidden: notesShown || !task.notes_hidden ? 1 : 0,
        ...(task.notes ? {} : { notes: ' ' }),
      }))}

      {overflow && (
        <>
          {!isNote && onAddChild && item('Add subtask', () => onAddChild(task))}
          {item('Delete', () => onDelete())}
        </>
      )}
      <div className="menu-sep" />
      {/* Only a task with no parent of its own: a sub-section is a heading band
          across the whole width, and a nested one has nowhere to span. */}
      {!isNote && !dateless && !task.parent_id && (
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

      {!dateless && (
        <>
      {/* One entry that opens onto the two ways of naming a day, rather than
          two entries saying the same verb. Copy sits beside it, because "put
          this on tomorrow as well" is the same decision with a different answer
          to "and take it off today?". */}
      {['move', 'copy'].map((how) => {
        const open = sub === how
        // The server does both: either way the task's section has to be found
        // or made on the far day, and a plain date patch would drop it into
        // that day's loose list and lose the band it belonged to.
        const go = (date) => { onReschedule?.(task, date, how === 'copy'); close() }

        return (
          <div key={how} className="menu-sub">
            <button
              className={`menu-item ${open ? 'is-open' : ''}`}
              aria-expanded={open}
              onClick={() => setSub(open ? null : how)}
            >
              {how === 'move' ? 'Move to' : 'Copy to'}…
              <Icon name={open ? 'chevronDown' : 'right'} size={11} />
            </button>

            {open && (
              <div className="menu-sub-body">
                <button
                  className="menu-item"
                  onClick={() => go(addDays(task.scheduled_date || today(), 1))}
                >
                  Tomorrow
                </button>
                <div className="menu-move">
                  <input
                    className="input"
                    type="date"
                    autoFocus
                    defaultValue={task.scheduled_date || today()}
                    onChange={(e) => { if (e.target.value) go(e.target.value) }}
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}

      {task.scheduled_date
        ? item('Send to backlog', () => onChange({ scheduled_date: null, status: 'todo', moved_to_date: null }))
        : item('Schedule today', () => onChange({ scheduled_date: today() }))}
        </>
      )}

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
      {/* Through Rich like every other title: a week cell used to show the
          markdown source, so a task with a link in it read as brackets and a
          URL and the link could not be followed from here at all. */}
      <span className="mtitle" title={task.title}><Rich text={task.title} inline /></span>
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
