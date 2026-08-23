import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import QuickMeeting from '../components/QuickMeeting.jsx'
import TaskRow from '../components/TaskRow.jsx'
import { ColorPicker, Empty, Panel, cls, initials } from '../components/ui.jsx'
import { RichEditor, RichLine } from '../lib/rich.jsx'
import { taskOps, useUndo } from '../lib/undo.jsx'
import { api, useApi } from '../lib/api.js'
import { relative, shortDate, today } from '../lib/dates.js'
import { InlineText, tagList } from './People.jsx'
import '../styles/people.css'

export default function PersonDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const person = useApi(`/people/${id}`, [id])
  const groups = useApi('/people/groups')
  const [meeting, setMeeting] = useState(false)
  const undo = useUndo()

  if (person.error) {
    return (
      <div className="page">
        <p className="muted">{person.error.message} <Link to="/people">Back to people</Link></p>
      </div>
    )
  }
  if (!person.data) return <div className="page"><p className="muted">Loading…</p></div>

  const p = person.data
  const ops = taskOps(undo, person.reload)
  const group = (groups.data || []).find((g) => g.id === p.group_id)

  async function save(patch) {
    await api.patch(`/people/${id}`, patch)
    person.reload()
  }

  async function remove() {
    if (!window.confirm(`Delete ${p.name}? Past meetings stay, but stop listing them.`)) return
    await api.del(`/people/${id}`)
    navigate('/people')
  }

  return (
    <>
      <header className="topbar">
        <button className="btn ghost sm" onClick={() => navigate('/people')} aria-label="Back to people">
          <Icon name="left" size={15} />
        </button>
        <h1>{p.name}</h1>
        <span className="spacer" />
        <button className="btn" onClick={() => setMeeting(true)}>
          <Icon name="clock" size={14} /> New meeting
        </button>
        <button className="btn sm danger" onClick={remove}>
          <Icon name="trash" size={13} /> Delete
        </button>
      </header>

      <div className="page">
        <div className="row" style={{ gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
          <span className={`avatar lg ${cls(p.color)}`}>{initials(p.name)}</span>

          <div className="col" style={{ gap: 3, flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 650 }}>
              <RichLine value={p.name} onChange={(name) => name.trim() && save({ name })} placeholder="Name" />
            </div>
            <div className="row muted" style={{ gap: 7 }}>
              <RichLine value={p.role} onChange={(role) => save({ role })} placeholder="Add a role" />
              {p.group_name && (
                <>
                  ·
                  <Link to={`/people?group=${p.group_id}`}>
                    <Icon name="building" size={12} /> {p.group_name}
                  </Link>
                </>
              )}
            </div>
            {tagList(p.tags).length > 0 && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                {tagList(p.tags).map((t) => <span key={t} className={`chip ${cls(p.color)}`}>{t}</span>)}
              </div>
            )}
          </div>

          <ColorPicker value={p.color} onChange={(color) => save({ color })} />
        </div>

        <div className="detail-grid">
          <div className="col" style={{ gap: 16 }}>
            <Panel title="Notes">
              <RichEditor
                value={p.notes}
                onChange={(notes) => save({ notes })}
                placeholder="Who they are, what you owe them, what to ask next time. Markdown + LaTeX: $\sigma_\theta$"
                rows={8}
                draftKey={`person:${p.id}`}
              />
            </Panel>

            <Panel
              title={<><Icon name="clock" size={14} /> Meetings <span className="muted">({p.meetings.length})</span></>}
              bodyClass=""
              actions={
                <button className="btn ghost sm" onClick={() => setMeeting(true)}>
                  <Icon name="plus" size={12} /> Meeting
                </button>
              }
            >
              <div style={{ padding: 6 }}>
                {p.meetings.length === 0 ? (
                  <Empty>No meetings with {p.name} yet. Book one and it shows up here.</Empty>
                ) : (
                  p.meetings.map((m) => (
                    <MeetingRow
                      key={m.id}
                      meeting={m}
                      onChange={(patch) => ops.patch(m, patch)}
                      onDelete={() => ops.remove(m)}
                    />
                  ))
                )}
              </div>
            </Panel>
          </div>

          <aside className="col" style={{ gap: 16 }}>
            <Panel title="Details">
              {/* Every row here is a plain input rather than a RichLine. These
                  are structured values, not prose, and rendering them through
                  markdown turned an email or a URL into a link that swallowed
                  the click that was supposed to open the editor. The link is
                  still worth having, so it sits beside the field instead. */}
              <dl className="kv">
                <dt>Email</dt>
                <dd>
                  <div className="pe-field">
                    <InlineText
                      type="email"
                      value={p.email}
                      placeholder="name@example.com"
                      onSave={(email) => save({ email })}
                    />
                    {p.email && (
                      <a className="chip" href={`mailto:${p.email}`} title={`Email ${p.name}`}>
                        <Icon name="mail" size={11} /> mail
                      </a>
                    )}
                  </div>
                </dd>

                <dt>Phone</dt>
                <dd>
                  <div className="pe-field">
                    <InlineText value={p.phone} placeholder="—" onSave={(phone) => save({ phone })} />
                    {p.phone && <a className="chip" href={`tel:${p.phone.replace(/\s+/g, '')}`}>call</a>}
                  </div>
                </dd>

                <dt>Location</dt>
                <dd>
                  <InlineText value={p.location} placeholder="—" onSave={(location) => save({ location })} />
                </dd>

                <dt>Group</dt>
                <dd className="col" style={{ gap: 4 }}>
                  <select
                    className="select input"
                    value={p.group_id ?? ''}
                    onChange={(e) => save({ group_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">No group</option>
                    {(groups.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  {group && (
                    <Link className="pe-hint" to={`/people?group=${group.id}`}>
                      <Icon name="building" size={11} /> Open {group.name} — {group.people_count}{' '}
                      {group.people_count === 1 ? 'person' : 'people'}
                    </Link>
                  )}
                </dd>

                <dt>Meeting link</dt>
                <dd className="col" style={{ gap: 4 }}>
                  <div className="pe-field">
                    <InlineText
                      value={p.meeting_url}
                      placeholder="https://— their own room"
                      onSave={(meeting_url) => save({ meeting_url })}
                    />
                    {p.meeting_url && (
                      <a className="chip c-blue" href={p.meeting_url} target="_blank" rel="noopener noreferrer">
                        <Icon name="link" size={11} /> join
                      </a>
                    )}
                  </div>
                  {/* Which link a new meeting will start from, said plainly, so a
                      prefilled URL later is never a surprise. */}
                  <span className="pe-hint">
                    {p.meeting_url
                      ? 'Used for new meetings with them.'
                      : p.group_name
                        ? `Empty — new meetings fall back to ${p.group_name}'s group link.`
                        : 'Empty, and no group link to fall back on.'}
                  </span>
                </dd>

                <dt>Tags</dt>
                <dd className="col" style={{ gap: 4 }}>
                  <InlineText value={p.tags} placeholder="comma, separated" onSave={(tags) => save({ tags })} />
                  {tagList(p.tags).length > 0 && (
                    <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
                      {tagList(p.tags).map((t) => <span key={t} className={`chip ${cls(p.color)}`}>{t}</span>)}
                    </div>
                  )}
                </dd>

                <dt>Last touch</dt>
                <dd className="col" style={{ gap: 4 }}>
                  <div className="row">
                    <input
                      className="input"
                      type="date"
                      style={{ width: 124 }}
                      value={p.last_touch || ''}
                      onChange={(e) => save({ last_touch: e.target.value || null })}
                    />
                    <button className="btn ghost sm" onClick={() => save({ last_touch: today() })}>today</button>
                    {p.last_touch && (
                      <button className="btn ghost sm" onClick={() => save({ last_touch: null })} title="Clear">
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </div>
                  {p.last_touch && <span className="muted" style={{ fontSize: 12 }}>{relative(p.last_touch)}</span>}
                </dd>
              </dl>
            </Panel>
          </aside>
        </div>
      </div>

      {meeting && (
        <QuickMeeting
          person={p}
          onClose={() => setMeeting(false)}
          onCreated={() => { setMeeting(false); person.reload() }}
        />
      )}
    </>
  )
}

/**
 * A meeting is an ordinary task, so the row itself is the ordinary TaskRow —
 * same status box, same deep/light and duration chips, same edit-in-place title.
 * Only the two things TaskRow has no notion of sit outside it: which day the
 * meeting is on, and its join link, which are exactly what you want first on a
 * person's page.
 */
function MeetingRow({ meeting, onChange, onDelete }) {
  return (
    <div className="pe-meeting">
      <Link className="pe-meeting-day" to={`/day/${meeting.scheduled_date}`}>
        {shortDate(meeting.scheduled_date) || 'unscheduled'}
      </Link>

      <div className="pe-meeting-row">
        <TaskRow task={meeting} onChange={onChange} onDelete={onDelete} draggable={false} />
      </div>

      {meeting.url && (
        <a className="chip c-blue pe-meeting-join" href={meeting.url} target="_blank" rel="noopener noreferrer">
          <Icon name="link" size={11} /> join
        </a>
      )}
    </div>
  )
}
