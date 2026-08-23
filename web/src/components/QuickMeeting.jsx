import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { Field, Modal, ProjectSelect, cls, initials } from './ui.jsx'
import { api, useApi } from '../lib/api.js'
import { parseTime } from './TaskRow.jsx'
import { minutesLabel, today } from '../lib/dates.js'
import '../styles/people.css'

/** Minutes between two HH:MM times, or null when the span is empty or inverted. */
function spanMinutes(start, end) {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = eh * 60 + em - (sh * 60 + sm)
  return mins > 0 ? mins : null
}

function plusMinutes(time, n) {
  const [h, m] = time.split(':').map(Number)
  const total = (h * 60 + m + n) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Book a meeting in one pass. A meeting is a task with `kind = 'meeting'`, so
 * everything here writes ordinary task columns — the form exists because the
 * fields a meeting needs (who, when, what link) are scattered across the task
 * row's own controls, not because meetings are a separate kind of thing.
 *
 *   date      the day it lands on, defaulting to today
 *   person    an attendee to start with, e.g. the person whose page opened this
 *   project   the project to file it under, e.g. the project page that opened this
 *   onCreated called with the created task row
 */
export default function QuickMeeting({
  date = today(), person = null, project = null, section = null, onClose, onCreated,
}) {
  const [title, setTitle] = useState('')
  const [on, setOn] = useState(date)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [attendees, setAttendees] = useState(person ? [person] : [])
  const [url, setUrl] = useState('')
  const [urlEdited, setUrlEdited] = useState(false)
  const [projectId, setProjectId] = useState(project?.id ?? null)
  // Intensity always travels in the body, so the server's own project-inheritance
  // never fires here — seeding from the project is what keeps a deep project's
  // meetings deep without anyone having to remember.
  const [deep, setDeep] = useState(project?.default_intensity === 'deep')
  const [pickedGroup, setPickedGroup] = useState(null)
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  const projects = useApi('/projects')
  const groups = useApi('/people/groups')
  const found = useApi(`/people?q=${encodeURIComponent(q.trim())}`, [q])

  const span = spanMinutes(start, end)

  const matches = (found.data || []).filter((p) => !attendees.some((a) => a.id === p.id))

  const groupLinkFor = (person) =>
    (groups.data || []).find((g) => g.id === person?.group_id)?.meeting_url || null

  /**
   * Where a join link would come from. Picking a group outright is the most
   * specific statement of intent, so that group's own room wins; otherwise it
   * is the first attendee's own link, falling back to their group's. It stays a
   * suggestion rather than a value, so typing over it wins and removing the
   * attendee it came from takes it away again.
   */
  const suggested = useMemo(() => {
    if (pickedGroup?.meeting_url) {
      return { url: pickedGroup.meeting_url, from: `${pickedGroup.name}'s group link` }
    }
    const first = attendees[0]
    if (!first) return null
    if (first.meeting_url) return { url: first.meeting_url, from: `${first.name}'s own link` }
    const group = (groups.data || []).find((g) => g.id === first.group_id)
    if (group?.meeting_url) return { url: group.meeting_url, from: `${group.name}'s group link` }
    return null
  }, [pickedGroup, attendees, groups.data])

  // With nothing typed the list is a directory to pick from; with a query it
  // narrows. Either way it is the same list, so there is no mode to learn.
  const groupMatches = (groups.data || []).filter(
    (g) => q.trim() && g.name.toLowerCase().includes(q.trim().toLowerCase()) && g.people_count > 0
  )
  const shownGroups = q.trim()
    ? groupMatches.slice(0, 3)
    : (groups.data || []).filter((g) => g.people_count > 0).slice(0, 4)
  const shownPeople = (q.trim() ? matches : matches.slice(0, 8))
    .slice(0, q.trim() ? 6 : 8)

  const joinUrl = urlEdited ? url : (suggested?.url || '')

  const add = (p) => {
    setAttendees((list) => [...list, p])
    setQ('')
  }

  /**
   * Groups you meet as a unit — a standup, a review board — are the usual case
   * for a recurring meeting, so picking the group adds its members rather than
   * asking for each name. Anyone already listed is skipped instead of doubled.
   */
  async function addGroup(group) {
    setPickedGroup(group)
    const members = await api.get(`/people?group_id=${group.id}`)
    setAttendees((list) => {
      const have = new Set(list.map((a) => a.id))
      return [...list, ...members.filter((m) => !have.has(m.id))]
    })
    setQ('')
  }

  /** The search finding nobody is the usual way a new contact gets added. */
  async function createAndAdd() {
    const created = await api.post('/people', { name: q.trim() })
    add(created)
  }

  async function create() {
    setSaving(true)
    try {
      const created = await api.post('/tasks', {
        title: title.trim(),
        kind: 'meeting',
        scheduled_date: on,
        start_time: start || null,
        end_time: end || null,
        // The span is the estimate: a meeting occupies its slot, so the day's
        // totals need no separate duration to be typed in.
        estimate_min: span,
        url: joinUrl.trim(),
        location: location.trim(),
        section_id: section ?? null,
        project_id: projectId,
        intensity: deep ? 'deep' : 'light',
        notes,
        people: attendees.map((p) => p.id),
      })
      onCreated?.(created)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="New meeting"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim() || saving} onClick={create}>
            <Icon name="plus" size={14} /> Add meeting
          </button>
        </>
      }
    >
      <Field label="Title">
        <input
          className="input"
          autoFocus
          placeholder="Weekly sync, intro call, review…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <div className="pe-times">
        <Field label="Date">
          <input className="input" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
        <Field label="Start">
          {/* Same shorthand as the task row: "9" is nine o'clock. */}
          <input
            className="input"
            placeholder="9 or 9:30"
            defaultValue={start}
            onBlur={(e) => {
              const v = parseTime(e.target.value)
              e.target.value = v || ''
              setStart(v || '')
              // Half an hour is the modal meeting; typing an end time overrides
              // it, and this only fires while the end is still blank.
              if (v && !end) setEnd(plusMinutes(v, 30))
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
          />
        </Field>
        <Field label="End">
          <input
            className="input"
            placeholder="—"
            key={end}
            defaultValue={end}
            onBlur={(e) => {
              const v = parseTime(e.target.value)
              e.target.value = v || ''
              setEnd(v || '')
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
          />
        </Field>
        <span className="pe-hint">
          {span
            ? `${minutesLabel(span)} — counted in the day's load like any task`
            : 'Add times and the duration follows'}
        </span>
      </div>

      <Field label="Attendees">
        <div className="pe-attendees">
          {attendees.length > 0 && (
            <div className="pe-chosen">
              {attendees.map((p) => (
                <span key={p.id} className={`chip ${cls(p.color)}`}>
                  {p.name}
                  <button
                    className="pe-chip-x"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => setAttendees((list) => list.filter((a) => a.id !== p.id))}
                  >
                    <Icon name="x" size={10} strokeWidth={2.4} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <input
            className="input"
            placeholder="Search, or just pick from the list below"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !q.trim()) return
              e.preventDefault()
              if (matches.length) add(matches[0])
              else createAndAdd()
            }}
          />

          {/* The list is always here, not only once you have typed something.
              Booking a recurring meeting with a group or a person you already
              have means picking them, and requiring a search first hid every
              contact behind a guess at their own name. */}
          <div className="pe-results">
            {shownGroups.map((g) => (
              <button key={`g${g.id}`} className="pe-result" onClick={() => addGroup(g)}>
                <span className="avatar is-group"><Icon name="building" size={12} /></span>
                <span className="pe-result-name">{g.name}</span>
                <span className="muted">
                  whole group · {g.people_count} {g.people_count === 1 ? 'person' : 'people'}
                </span>
                {g.meeting_url && <span className="chip c-blue"><Icon name="link" size={10} /> link</span>}
              </button>
            ))}

            {shownPeople.map((p) => (
              <button key={p.id} className="pe-result" onClick={() => add(p)}>
                <span className={`avatar ${cls(p.color)}`}>{initials(p.name)}</span>
                <span className="pe-result-name">{p.name}</span>
                {p.role && <span className="muted">{p.role}</span>}
                {p.group_name && <span className="chip">{p.group_name}</span>}
                {(p.meeting_url || groupLinkFor(p)) && (
                  <span className="chip c-blue"><Icon name="link" size={10} /> link</span>
                )}
              </button>
            ))}

            {/* Nobody by that name is the common case for a first meeting, so
                the empty result is itself the way to add them. */}
            {q.trim() && matches.length === 0 && groupMatches.length === 0 && (
              <button className="pe-result pe-create" onClick={createAndAdd}>
                <Icon name="plus" size={13} />
                Nobody called “{q.trim()}” yet — add them as a new person
              </button>
            )}

            {!q.trim() && shownPeople.length === 0 && shownGroups.length === 0 && (
              <span className="pe-hint" style={{ padding: '6px 8px' }}>
                No people yet — type a name to add one.
              </span>
            )}
          </div>
          )}
        </div>
      </Field>

      <Field label="Meeting link">
        <input
          className="input"
          placeholder="https://…"
          value={joinUrl}
          onChange={(e) => { setUrlEdited(true); setUrl(e.target.value) }}
        />
        {suggested && !urlEdited && (
          <span className="pe-hint">
            <Icon name="link" size={11} /> from {suggested.from} — edit to use another
          </span>
        )}
      </Field>

      <Field label="Where">
        <input
          className="input"
          placeholder="Room, building, or address — optional"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </Field>

      <div className="grid-2">
        <Field label="Project">
          <ProjectSelect projects={projects.data || []} value={projectId} onChange={setProjectId} />
        </Field>
        <Field label="Intensity">
          {/* Most meetings are not thinking time, so light is the default and
              deep is the deliberate claim on the day's deep budget. */}
          <div className="row">
            <button className={`btn sm ${deep ? '' : 'primary'}`} aria-pressed={!deep} onClick={() => setDeep(false)}>
              Light
            </button>
            <button className={`btn sm ${deep ? 'primary' : ''}`} aria-pressed={deep} onClick={() => setDeep(true)}>
              Deep
            </button>
          </div>
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          className="input"
          rows={3}
          placeholder="Agenda, what to ask, what you owe them. Markdown and $math$ work."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </Modal>
  )
}
