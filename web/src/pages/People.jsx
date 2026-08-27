import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import QuickMeeting from '../components/QuickMeeting.jsx'
import { ColorPicker, Empty, Field, Modal, Panel, cls, initials } from '../components/ui.jsx'
import { api, useApi } from '../lib/api.js'
import { relative } from '../lib/dates.js'
import '../styles/people.css'
import { usePageTitle } from '../lib/title.js'

const BLANK_PERSON = {
  name: '', role: '', group_id: null, email: '', phone: '', location: '',
  tags: '', notes: '', color: 'blue', meeting_url: '',
}

// `kind` is free text, not an enum: a group is any body a person belongs to,
// and the useful word is whatever the user would call it.
const BLANK_GROUP = { name: '', kind: 'company', website: '', meeting_url: '', notes: '' }

export const tagList = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean)

/**
 * A plain text field that writes on blur.
 *
 * Deliberately not RichLine: RichLine renders its value as markdown, GFM
 * autolinks anything that looks like an address or a URL, and `Rich` stops the
 * click on a link before it can reach the click-to-edit handler. The upshot was
 * that filling in an email or a meeting link made that field impossible to edit
 * again. Structured data is not prose, so it gets an ordinary input.
 *
 * Uncontrolled, keyed on the value: no write per keystroke, and a value that
 * changes underneath (a reload, an undo) still reseeds the box.
 */
export function InlineText({ value, onSave, className = 'input', ...rest }) {
  return (
    <input
      key={value || ''}
      className={className}
      defaultValue={value || ''}
      onBlur={(e) => {
        const next = e.target.value.trim()
        if (next !== (value || '')) onSave(next)
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      {...rest}
    />
  )
}

export default function People() {
  usePageTitle('People')
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState('people')
  const [asTable, setAsTable] = useState(false)
  const [q, setQ] = useState('')
  const [person, setPerson] = useState(null)
  const [group, setGroup] = useState(null)
  const [meeting, setMeeting] = useState(false)

  // The group filter lives in the URL so a person's group can link straight into it.
  const groupFilter = params.get('group') || ''

  const search = new URLSearchParams()
  if (q.trim()) search.set('q', q.trim())
  if (groupFilter) search.set('group_id', groupFilter)

  const people = useApi(`/people?${search}`, [q, groupFilter])
  const groups = useApi('/people/groups')

  const list = people.data || []
  const groupList = groups.data || []
  const filteredGroup = groupList.find((g) => String(g.id) === groupFilter)

  function showGroup(id) {
    setParams({ group: String(id) })
    setTab('people')
  }

  async function createPerson() {
    await api.post('/people', person)
    setPerson(null)
    people.reload()
  }

  async function patchGroup(g, patch) {
    await api.patch(`/people/groups/${g.id}`, patch)
    groups.reload()
  }

  async function deleteGroup(g) {
    if (!window.confirm(`Delete ${g.name}? Its people stay, without a group.`)) return
    await api.del(`/people/groups/${g.id}`)
    setGroup(null)
    groups.reload()
    people.reload()
  }

  if (people.error) return <div className="page"><p className="muted">{people.error.message}</p></div>
  if (!people.data) return <div className="page"><p className="muted">Loading…</p></div>

  return (
    <>
      <header className="topbar">
        <h1>People</h1>
        <span className="spacer" />
        {tab === 'people' && (
          <>
            <input
              className="input"
              style={{ width: 230 }}
              placeholder="Search name, role, email, tag…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="daynav">
              <button className={`btn sm ${asTable ? '' : 'primary'}`} aria-pressed={!asTable} onClick={() => setAsTable(false)}>
                Cards
              </button>
              <button className={`btn sm ${asTable ? 'primary' : ''}`} aria-pressed={asTable} onClick={() => setAsTable(true)}>
                Table
              </button>
            </div>
          </>
        )}
        <button className="btn" onClick={() => setMeeting(true)}>
          <Icon name="clock" size={14} /> New meeting
        </button>
        <button
          className="btn primary"
          onClick={() => (tab === 'people' ? setPerson(BLANK_PERSON) : setGroup(BLANK_GROUP))}
        >
          <Icon name="plus" size={14} /> {tab === 'people' ? 'New person' : 'New group'}
        </button>
      </header>

      <div className="page">
        <div className="tabs">
          <button className={`tab ${tab === 'people' ? 'active' : ''}`} onClick={() => setTab('people')}>
            People <span className="muted">({list.length})</span>
          </button>
          <button className={`tab ${tab === 'groups' ? 'active' : ''}`} onClick={() => setTab('groups')}>
            Groups <span className="muted">({groupList.length})</span>
          </button>
        </div>

        {tab === 'people' && filteredGroup && (
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="chip"><Icon name="building" size={11} /> {filteredGroup.name}</span>
            {/* Arriving here from a person's page is the usual way to look at a
                group, so this is where you most often want to fix its details. */}
            <button className="btn ghost sm" onClick={() => setGroup(filteredGroup)}>
              Edit group
            </button>
            <button className="btn ghost sm" onClick={() => setParams({})}>
              <Icon name="x" size={12} /> Clear filter
            </button>
          </div>
        )}

        {tab === 'people' && list.length === 0 && (
          <Panel>
            <Empty>
              {q || groupFilter ? 'Nobody matches that.' : 'No people yet. Add the first one.'}
            </Empty>
          </Panel>
        )}

        {tab === 'people' && list.length > 0 && (
          asTable ? <PersonTable people={list} /> : <PersonCards people={list} />
        )}

        {tab === 'groups' && (
          <GroupTable
            groups={groupList}
            onShow={showGroup}
            onOpen={setGroup}
            onPatch={patchGroup}
            onDelete={deleteGroup}
          />
        )}
      </div>

      {person && (
        <Modal
          title="New person"
          onClose={() => setPerson(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPerson(null)}>Cancel</button>
              <button className="btn primary" disabled={!person.name.trim()} onClick={createPerson}>
                Add person
              </button>
            </>
          }
        >
          <PersonForm person={person} setPerson={setPerson} groups={groupList} />
        </Modal>
      )}

      {group && (
        <GroupModal
          group={group}
          onClose={() => setGroup(null)}
          onSaved={() => { setGroup(null); groups.reload(); people.reload() }}
          onDelete={() => deleteGroup(group)}
        />
      )}

      {meeting && (
        <QuickMeeting
          onClose={() => setMeeting(false)}
          onCreated={() => { setMeeting(false); people.reload() }}
        />
      )}
    </>
  )
}

function PersonCards({ people }) {
  return (
    <div className="cards">
      {people.map((p) => (
        <Link
          key={p.id}
          to={`/people/${p.id}`}
          className="panel pcard"
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          <div className="pname">
            <span className={`avatar ${cls(p.color)}`}>{initials(p.name)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              {p.name}
              {p.role && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{p.role}</div>}
            </span>
          </div>

          {(p.group_name || p.tags) && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {p.group_name && <span className="chip"><Icon name="building" size={11} /> {p.group_name}</span>}
              {tagList(p.tags).map((t) => (
                <span key={t} className={`chip ${cls(p.color)}`}>{t}</span>
              ))}
            </div>
          )}

          <div className="row muted" style={{ fontSize: 12 }}>
            {p.email && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.email}</span>}
            <span className="spacer" />
            <span>{p.last_touch ? `last touch ${relative(p.last_touch)}` : 'no touch logged'}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}

function PersonTable({ people }) {
  const navigate = useNavigate()

  return (
    <Panel bodyClass="">
      <table className="ptable">
        <thead>
          <tr>
            <th>Name</th><th>Role</th><th>Group</th><th>Tags</th><th>Last touch</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} onClick={() => navigate(`/people/${p.id}`)}>
              <td>
                <span className="row">
                  <span className={`avatar ${cls(p.color)}`}>{initials(p.name)}</span>
                  <span style={{ fontWeight: 550 }}>{p.name}</span>
                </span>
              </td>
              <td className="muted">{p.role || '—'}</td>
              <td>{p.group_name || <span className="muted">—</span>}</td>
              <td>
                <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                  {tagList(p.tags).map((t) => <span key={t} className="chip">{t}</span>)}
                </span>
              </td>
              <td className="muted">{relative(p.last_touch) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function GroupTable({ groups, onShow, onOpen, onPatch, onDelete }) {
  if (groups.length === 0) {
    return (
      <Panel>
        <Empty>
          No groups yet. A group is any body a person belongs to — a company, a lab, a cohort.
        </Empty>
      </Panel>
    )
  }

  return (
    <Panel bodyClass="">
      <table className="ptable">
        <thead>
          <tr>
            <th>Name</th><th>Kind</th><th>Website</th><th>Meeting link</th><th>People</th><th />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id} style={{ cursor: 'default' }}>
              <td>
                {/* The name opens the group itself. A row where only one cell
                    could be changed was the whole complaint. */}
                <button className="pe-group-open" onClick={() => onOpen(g)}>
                  <Icon name="building" size={12} /> {g.name}
                </button>
                {g.notes && <div className="pe-group-note">{g.notes}</div>}
              </td>
              <td className="muted">{g.kind}</td>
              <td>
                {g.website
                  ? <a href={g.website} target="_blank" rel="noopener noreferrer">{g.website.replace(/^https?:\/\//, '')}</a>
                  : <span className="muted">—</span>}
              </td>
              <td>
                {/* Kept inline as well as in the editor: reading a column of
                    standing links is how you notice the one that is wrong. */}
                <MeetingUrl
                  value={g.meeting_url}
                  hint="Standing link for this group — new meetings start from it"
                  onSave={(meeting_url) => onPatch(g, { meeting_url })}
                />
              </td>
              <td>
                <button className="btn ghost sm" disabled={!g.people_count} onClick={() => onShow(g.id)}>
                  {g.people_count} {g.people_count === 1 ? 'person' : 'people'}
                </button>
              </td>
              <td style={{ textAlign: 'right' }}>
                <span className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn ghost sm" onClick={() => onOpen(g)}>Edit</button>
                  <button className="btn ghost sm danger" onClick={() => onDelete(g)} aria-label={`Delete ${g.name}`}>
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

/** An editable standing link, with a join button beside it once it is set. */
function MeetingUrl({ value, hint, onSave }) {
  return (
    <span className="pe-url" title={hint}>
      <InlineText value={value} onSave={onSave} placeholder="https://…" />
      {value && (
        <a className="chip c-blue" href={value} target="_blank" rel="noopener noreferrer">
          <Icon name="link" size={11} /> join
        </a>
      )}
    </span>
  )
}

function PersonForm({ person, setPerson, groups }) {
  const set = (e) => setPerson({ ...person, [e.target.name]: e.target.value })

  return (
    <>
      <Field label="Name">
        <input className="input" autoFocus name="name" value={person.name} onChange={set} />
      </Field>

      <div className="grid-2">
        <Field label="Role">
          <input className="input" name="role" placeholder="Program manager" value={person.role} onChange={set} />
        </Field>
        <Field label="Group">
          <select
            className="select input"
            value={person.group_id ?? ''}
            onChange={(e) => setPerson({ ...person, group_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">No group</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid-2">
        <Field label="Email">
          <input className="input" type="email" name="email" value={person.email} onChange={set} />
        </Field>
        <Field label="Phone">
          <input className="input" name="phone" value={person.phone} onChange={set} />
        </Field>
      </div>

      <div className="grid-2">
        <Field label="Location">
          <input className="input" name="location" value={person.location} onChange={set} />
        </Field>
        <Field label="Tags">
          <input className="input" name="tags" placeholder="comma, separated" value={person.tags} onChange={set} />
        </Field>
      </div>

      <Field label="Meeting link">
        <input className="input" name="meeting_url" placeholder="https://" value={person.meeting_url} onChange={set} />
        <span className="pe-hint">Their own room, used before the group's when you book a meeting.</span>
      </Field>

      <Field label="Colour">
        <ColorPicker value={person.color} onChange={(color) => setPerson({ ...person, color })} />
      </Field>

      <Field label="Notes">
        <textarea className="input" rows={3} name="notes" value={person.notes} onChange={set} />
      </Field>
    </>
  )
}

/**
 * The whole of a group, new or existing, in one place.
 *
 * A modal rather than its own route: a group detail page would need a route in
 * App.jsx, and the group is small enough that a page would be one panel with
 * five fields on it. This also keeps the group one click from the row it is
 * listed in, which is where you notice it needs changing.
 */
function GroupModal({ group, onClose, onSaved, onDelete }) {
  const [draft, setDraft] = useState(group)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const existing = draft.id != null

  const set = (e) => setDraft({ ...draft, [e.target.name]: e.target.value })

  async function save() {
    setSaving(true)
    setError('')
    try {
      // The server's allow-list ignores id and people_count, so the draft can go
      // over whole rather than being picked apart field by field here.
      if (existing) await api.patch(`/people/groups/${draft.id}`, draft)
      else await api.post('/people/groups', draft)
      onSaved()
    } catch (err) {
      // Group names are unique, so a rename can legitimately fail. Closing the
      // modal on that would throw away everything else that was typed.
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={existing ? `Group — ${group.name}` : 'New group'}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <>
              <button className="btn sm danger" onClick={onDelete}>
                <Icon name="trash" size={13} /> Delete
              </button>
              <span className="spacer" />
            </>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!draft.name.trim() || saving} onClick={save}>
            {existing ? 'Save group' : 'Add group'}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" autoFocus name="name" value={draft.name} onChange={set} />
      </Field>

      <div className="grid-2">
        <Field label="Kind">
          <input className="input" name="kind" placeholder="company, lab, cohort, unit" value={draft.kind || ''} onChange={set} />
        </Field>
        <Field label="Website">
          <input className="input" name="website" placeholder="https://" value={draft.website || ''} onChange={set} />
        </Field>
      </div>

      <Field label="Meeting link">
        <input className="input" name="meeting_url" placeholder="https://" value={draft.meeting_url || ''} onChange={set} />
        <span className="pe-hint">
          The standing room for this group — anyone in it starts a meeting here.
        </span>
      </Field>

      <Field label="Notes">
        <textarea className="input" rows={4} name="notes" value={draft.notes || ''} onChange={set} />
      </Field>

      {existing && (
        <span className="pe-hint">
          {draft.people_count
            ? `${draft.people_count} ${draft.people_count === 1 ? 'person is' : 'people are'} in this group.`
            : 'Nobody is in this group yet.'}
        </span>
      )}

      {error && <p className="pe-error">{error}</p>}
    </Modal>
  )
}
