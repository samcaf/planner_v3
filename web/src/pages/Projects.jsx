import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import Progress from '../components/Progress.jsx'
import { bulkPatch, draggedIds, isTaskDrag } from '../components/Selection.jsx'
import { useToast } from '../components/Toast.jsx'
import { ColorPicker, Empty, Field, Modal, Panel, cls } from '../components/ui.jsx'
import { api, useApi } from '../lib/api.js'
import { BACKLOG_QUERY, isBacklogTask } from '../lib/backlog.js'
import { useUndo } from '../lib/undo.jsx'
import { minutesLabel, relative, shortDate } from '../lib/dates.js'
import '../styles/projects.css'
// The digest below is a list of links to somewhere else, which is what the
// dashboard's rows already are, so it borrows their stylesheet rather than
// growing a second set of nearly identical rules.
import '../styles/dashboard.css'

const STATUSES = ['active', 'planned', 'done', 'archived']

/**
 * GET /api/projects returns aggregates, not rows, but `tally` — including its
 * "no estimates anywhere, so count tasks instead" fallback — only speaks tasks.
 * One stand-in row per side carries the minutes and the rest carry the counts,
 * which reproduces the aggregates exactly under either branch.
 */
function summaryTasks(p) {
  const openMin = Math.max(0, p.total_min - p.done_min)
  return [
    ...Array.from({ length: p.done_tasks }, (_, i) => ({ status: 'done', estimate_min: i ? 0 : p.done_min })),
    ...Array.from({ length: p.open_tasks }, (_, i) => ({ status: 'todo', estimate_min: i ? 0 : openMin })),
  ]
}

/**
 * Scoping a project to a type hands the colour over to it — the server adopts
 * the type's colour on the way in, and repaints every project of a type when
 * the type itself is recoloured. Picking a colour by hand takes it back.
 */
function typeHint(p) {
  if (!p.type_id) return 'No type — colour is yours'
  if (p.color !== p.type_color) return `Own colour, overriding ${p.type_name}`
  return `Colour follows ${p.type_name}`
}

export default function Projects() {
  const navigate = useNavigate()
  const [showArchived, setShowArchived] = useState(false)
  const projects = useApi(`/projects${showArchived ? '?include_archived=1' : ''}`, [showArchived])
  const types = useApi('/projects/types')
  // The whole backlog in one request, tallied by project below. A count per
  // project would be a request per card, and asking the same question the day
  // view asks is what stops the two from quoting different numbers.
  const backlog = useApi(`/tasks?${BACKLOG_QUERY}`)
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')
  const [over, setOver] = useState(null)
  // Reordering is a separate gesture from filing a task under a project, so it
  // carries its own drag payload and its own hover state.
  const [dragProj, setDragProj] = useState(null)
  const [dropAt, setDropAt] = useState(null)
  const undo = useUndo()
  const toast = useToast()

  const typeList = types.data || []

  const list = (projects.data || []).filter((p) => {
    if (typeFilter === 'all') return true
    if (typeFilter === 'none') return p.type_id == null
    return String(p.type_id) === typeFilter
  })

  // Unfiled backlog tasks belong to no project and so belong in no project's
  // count; the day view is where they are answered for.
  const backlogCounts = new Map()
  for (const t of (backlog.data || []).filter(isBacklogTask)) {
    if (t.project_id == null) continue
    backlogCounts.set(t.project_id, (backlogCounts.get(t.project_id) || 0) + 1)
  }

  async function setType(project, type_id) {
    await api.patch(`/projects/${project.id}`, { type_id })
    projects.reload()
  }

  /**
   * Reorder against the *unfiltered* list. The page may be showing one type, but
   * writing 0..n over a filtered subset would renumber those few on top of the
   * projects that happen to be hidden and scramble their order.
   */
  async function reorder(draggedId, targetId, side) {
    const all = (projects.data || []).map((p) => p.id)
    const from = all.indexOf(draggedId)
    if (from < 0 || draggedId === targetId) return

    all.splice(from, 1)
    const at = all.indexOf(targetId)
    if (at < 0) return
    all.splice(side === 'after' ? at + 1 : at, 0, draggedId)

    await api.post('/projects/reorder', { ids: all })
    projects.reload()
  }

  /**
   * Dropped tasks are reassigned, nothing more: the day they sit on is theirs,
   * not the project's. Nothing here shows the tasks themselves, so the toast is
   * the only evidence the drop landed.
   */
  async function fileUnder(project, ids) {
    if (!ids.length) return
    await bulkPatch(ids, { project_id: project.id }, { label: `file ${ids.length} tasks`, undo })
    projects.reload()
    toast({ message: `Filed ${ids.length} task${ids.length === 1 ? '' : 's'} under ${project.name}` })
  }

  return (
    <>
      <header className="topbar">
        <h1>Projects</h1>
        <span className="muted sub">{list.length}</span>
        <span className="spacer" />
        <select
          className="input select"
          style={{ width: 150 }}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="none">No type</option>
          {typeList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn ghost sm" onClick={() => setManaging(true)}>Manage types</button>
        <button className="btn ghost sm" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} /> New project
        </button>
      </header>

      <div className="page">
        {list.length === 0 ? (
          <Panel>
            <Empty>
              {typeFilter === 'all'
                ? 'No projects yet. Create one to start grouping tasks and deadlines.'
                : 'No projects of that type. Clear the filter to see the rest.'}
            </Empty>
          </Panel>
        ) : (
          <div className="cards">
            {list.map((p) => {
              const left = Math.max(0, p.total_min - p.done_min)

              return (
                <article
                  key={p.id}
                  className={[
                    'panel pcard', cls(p.color),
                    over === p.id ? 'sel-drop-on' : '',
                    dragProj === p.id ? 'pj-dragging' : '',
                    dropAt?.id === p.id ? `pj-drop-${dropAt.side}` : '',
                  ].filter(Boolean).join(' ')}
                  draggable
                  onClick={() => navigate(`/projects/${p.id}`)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/project-id', String(p.id))
                    e.dataTransfer.effectAllowed = 'move'
                    setDragProj(p.id)
                  }}
                  onDragEnd={() => { setDragProj(null); setDropAt(null) }}
                  onDragOver={(e) => {
                    if (isTaskDrag(e)) { e.preventDefault(); setOver(p.id); return }
                    if (dragProj == null || dragProj === p.id) return
                    e.preventDefault()
                    // Left half drops before, right half after — the cards flow
                    // in a grid, so the split is horizontal rather than vertical.
                    const r = e.currentTarget.getBoundingClientRect()
                    setDropAt({ id: p.id, side: e.clientX - r.left < r.width / 2 ? 'before' : 'after' })
                  }}
                  onDragLeave={() => {
                    setOver((id) => (id === p.id ? null : id))
                    setDropAt((d) => (d?.id === p.id ? null : d))
                  }}
                  onDrop={(e) => {
                    const moved = Number(e.dataTransfer.getData('text/project-id'))
                    if (moved) {
                      e.preventDefault()
                      const side = dropAt?.id === p.id ? dropAt.side : 'before'
                      setDropAt(null)
                      setDragProj(null)
                      reorder(moved, p.id, side)
                      return
                    }
                    setOver(null)
                    fileUnder(p, draggedIds(e))
                  }}
                >
                  <div className="pname">
                    <span className="dot" style={{ background: 'var(--c)' }} />
                    {/* Wrapped rather than left a bare text node so the name is
                        the flex child that takes the card's spare width — as a
                        loose node it was sized to fit and the spacer took the
                        rest, which wrapped names that had room to spare. */}
                    <span className="pj-name">{p.name}</span>
                    {p.type_name && <span className={`chip ${cls(p.type_color)}`}>{p.type_name}</span>}
                    {p.status !== 'active' && <span className="chip">{p.status}</span>}
                  </div>

                  <Progress tasks={summaryTasks(p)} color={p.color} />

                  <div className="pj-meta">
                    <span>{p.open_tasks} open</span>
                    <span>·</span>
                    <span>{p.done_tasks} done</span>
                    {left > 0 && (
                      <>
                        <span>·</span>
                        <span>{minutesLabel(left)} left</span>
                      </>
                    )}
                    {p.open_milestones > 0 && (
                      <>
                        <span>·</span>
                        <span>{p.open_milestones} milestone{p.open_milestones === 1 ? '' : 's'}</span>
                      </>
                    )}
                  </div>

                  {p.next_due && (
                    <div className="row" style={{ fontSize: 12 }}>
                      <Icon name="flag" size={12} />
                      next due {shortDate(p.next_due)}
                      <span className="muted">({relative(p.next_due)})</span>
                    </div>
                  )}

                  {/* The card itself navigates, so its controls must not. */}
                  <div className="pj-type" onClick={(e) => e.stopPropagation()}>
                    <select
                      className="input select"
                      value={p.type_id ?? ''}
                      onChange={(e) => setType(p, e.target.value ? Number(e.target.value) : null)}
                      title="Project type — the project takes the type's colour"
                    >
                      <option value="">No type</option>
                      {typeList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <span className="pj-hint">
                      <span className="dot" style={{ background: `var(--${p.color})` }} />
                      {typeHint(p)}
                    </span>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        <Backlogs projects={list} counts={backlogCounts} />
      </div>

      {creating && (
        <NewProject
          types={typeList}
          onClose={() => setCreating(false)}
          onCreated={(p) => { setCreating(false); navigate(`/projects/${p.id}`) }}
        />
      )}

      {managing && (
        <ManageTypes
          types={typeList}
          onClose={() => setManaging(false)}
          reload={() => { types.reload(); projects.reload() }}
        />
      )}
    </>
  )
}

/**
 * Which projects are carrying unscheduled work, and how much. Only those that
 * are: a project with an empty backlog has nothing to say here, and listing it
 * anyway would bury the handful that do behind a wall of zeroes — the same
 * reason the dashboard's panels disappear rather than render empty.
 *
 * `projects` is the filtered list on screen, so narrowing the page to one type
 * narrows this with it.
 */
function Backlogs({ projects, counts }) {
  const carrying = projects.filter((p) => counts.get(p.id) > 0)
  if (carrying.length === 0) return null

  const total = carrying.reduce((n, p) => n + counts.get(p.id), 0)

  return (
    <Panel
      className="pj-backlogs"
      title={<><Icon name="list" size={14} /> Backlogs <span className="muted">({total})</span></>}
      bodyClass="db-list"
    >
      <p className="db-hint">Open tasks filed under a project but not yet given a day.</p>
      {carrying.map((p) => (
        <Link key={p.id} to={`/projects/${p.id}`} className="db-row">
          <span className="dot" style={{ background: `var(--${p.color || 'gray'})` }} />
          <span className="db-row-title">{p.name}</span>
          <span className="db-row-meta">{counts.get(p.id)}</span>
        </Link>
      ))}
    </Panel>
  )
}

function NewProject({ types, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', color: 'blue', status: 'active', due_date: '', type_id: '' })
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  // Picking a type adopts its colour, which is what the server does with a
  // typed project anyway — mirroring it here keeps the swatch honest.
  const setType = (value) => setForm((f) => ({
    ...f,
    type_id: value,
    color: types.find((t) => String(t.id) === value)?.color || f.color,
  }))

  const typeName = types.find((t) => String(t.id) === form.type_id)?.name

  async function submit() {
    if (!form.name.trim()) return
    const created = await api.post('/projects', {
      ...form,
      due_date: form.due_date || null,
      type_id: form.type_id ? Number(form.type_id) : null,
    })
    onCreated(created)
  }

  return (
    <Modal
      title="New project"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!form.name.trim()}>Create</button>
      </>}
    >
      <Field label="Name">
        <input
          className="input"
          autoFocus
          value={form.name}
          onChange={(e) => set('name')(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </Field>
      <Field label="Colour">
        <ColorPicker value={form.color} onChange={set('color')} />
        <div className="pj-colour">
          <span className="pj-hint">
            {typeName
              ? `Taken from ${typeName} — pick one to override it.`
              : 'Or choose a type below and inherit its colour.'}
          </span>
        </div>
      </Field>
      <div className="grid-2">
        <Field label="Status">
          <select className="input select" value={form.status} onChange={(e) => set('status')(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select className="input select" value={form.type_id} onChange={(e) => setType(e.target.value)}>
            <option value="">No type</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Target date">
          <input className="input" type="date" value={form.due_date} onChange={(e) => set('due_date')(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function ManageTypes({ types, onClose, reload }) {
  const [draft, setDraft] = useState('')

  async function patch(type, body) {
    await api.patch(`/projects/types/${type.id}`, body)
    reload()
  }

  async function add(e) {
    e.preventDefault()
    const name = draft.trim()
    if (!name) return
    setDraft('')
    await api.post('/projects/types', { name })
    reload()
  }

  async function remove(type) {
    if (!window.confirm(`Delete the type “${type.name}”? Its projects stay, without a type.`)) return
    await api.del(`/projects/types/${type.id}`)
    reload()
  }

  return (
    <Modal
      title="Project types"
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Done</button>}
    >
      {types.length === 0 ? (
        <Empty>No types yet. Work, Research and Personal are a reasonable start.</Empty>
      ) : (
        <>
        <p className="pj-hint">Recolouring a type repaints every project that uses it.</p>
        {types.map((t) => (
          <div key={t.id} className="row">
            <input
              className="input"
              style={{ width: 150 }}
              defaultValue={t.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== t.name
                && patch(t, { name: e.target.value.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <ColorPicker value={t.color} onChange={(color) => patch(t, { color })} />
            <span className="spacer" />
            <button className="btn ghost sm danger" onClick={() => remove(t)} aria-label={`Delete ${t.name}`}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))}
        </>
      )}

      <form className="row" onSubmit={add}>
        <input
          className="input"
          placeholder="New type…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn primary" type="submit"><Icon name="plus" size={14} /> Add</button>
      </form>
    </Modal>
  )
}
