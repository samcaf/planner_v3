import { useState } from 'react'
import Icon from '../components/Icon.jsx'
import { ColorPicker, Empty, Panel, ProjectSelect, cls } from '../components/ui.jsx'
import { RichLine } from '../lib/rich.jsx'
import { api, useApi } from '../lib/api.js'
import { minutesLabel, shortDate, today } from '../lib/dates.js'
import '../styles/routines.css'

// The states a task can be in; an item is created in whichever one it defaults to.
// "Might do" is no longer one of them — it is the separate `optional` flag now.
const STATUSES = [
  ['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done'],
  ['moved', 'Moved'], ['dropped', 'Dropped'],
]

export default function Routines() {
  const routines = useApi('/routines')
  const projects = useApi('/projects')
  const [toast, setToast] = useState('')

  if (routines.error) return <div className="page"><p className="muted">{routines.error.message}</p></div>
  if (!routines.data) return <div className="page"><p className="muted">Loading…</p></div>

  function flash(message) {
    setToast(message)
    setTimeout(() => setToast(''), 2600)
  }

  async function addRoutine() {
    await api.post('/routines', { name: 'New routine' })
    routines.reload()
  }

  return (
    <>
      <header className="topbar">
        <h1>Routines</h1>
        <span className="muted sub">{routines.data.length}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={addRoutine}>
          <Icon name="plus" size={14} /> New routine
        </button>
      </header>

      <div className="page">
        <p className="rt-intro">
          A routine is a named group of tasks that becomes a section on a day. Nothing is added for
          you — apply it by hand from the Routines panel in the Day view, or with Apply below. Each
          item can start in a state of its own, and a shelved item is kept here but skipped whenever
          the routine is applied.
        </p>

        {routines.data.length === 0 ? (
          <Panel><Empty>No routines yet. A morning routine or a weekly review is a good first one.</Empty></Panel>
        ) : (
          <div className="rt-list">
            {routines.data.map((rt) => (
              <Routine
                key={rt.id}
                routine={rt}
                projects={projects.data || []}
                reload={routines.reload}
                flash={flash}
              />
            ))}
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

const COLLAPSE_STORE = 'planner.routines.collapsed'

function Routine({ routine: rt, projects, reload, flash }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return (JSON.parse(localStorage.getItem(COLLAPSE_STORE)) || []).includes(rt.id) }
    catch { return false }
  })
  const [date, setDate] = useState(today())
  const [draft, setDraft] = useState('')

  async function patch(body) {
    await api.patch(`/routines/${rt.id}`, body)
    reload()
  }

  async function patchItem(item, body) {
    await api.patch(`/routines/items/${item.id}`, body)
    reload()
  }

  async function addItem(e) {
    e.preventDefault()
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await api.post(`/routines/${rt.id}/items`, { title })
    reload()
  }

  async function removeItem(item) {
    await api.del(`/routines/items/${item.id}`)
    reload()
  }

  async function removeRoutine() {
    if (!window.confirm(`Delete “${rt.name}” and its ${rt.items.length} items?`)) return
    await api.del(`/routines/${rt.id}`)
    reload()
  }

  async function apply() {
    const { added } = await api.post(`/routines/${rt.id}/apply`, { date })
    flash(added
      ? `${shortDate(date)}: ${added} task${added === 1 ? '' : 's'} added`
      : `${shortDate(date)}: already up to date`)
  }

  const isColumns = rt.layout === 'columns'
  const isDeep = rt.default_intensity === 'deep'
  // Named so an item's empty project can say what it will actually inherit.
  const rtProject = projects.find((p) => p.id === rt.project_id)

  // Shelved items are skipped by /apply, so they are absent from every figure
  // that describes what applying the routine would actually do.
  const active = rt.items.filter((i) => !i.shelved)
  const shelved = rt.items.filter((i) => i.shelved)
  const load = active.reduce((sum, i) => sum + (i.estimate_min || 0), 0)

  function toggle() {
    setCollapsed((was) => {
      const next = !was
      try {
        const list = new Set(JSON.parse(localStorage.getItem(COLLAPSE_STORE)) || [])
        next ? list.add(rt.id) : list.delete(rt.id)
        localStorage.setItem(COLLAPSE_STORE, JSON.stringify([...list]))
      } catch { /* storage unavailable */ }
      return next
    })
  }

  return (
    <Panel
      className={`rt-card ${cls(rt.color)} ${rt.active ? '' : 'rt-off'}`}
      bodyClass=""
      title={
        <>
          <button
            className="task-twist"
            onClick={toggle}
            title={collapsed ? 'Expand' : 'Minimise'}
            aria-expanded={!collapsed}
          >
            <Icon name={collapsed ? 'right' : 'chevronDown'} size={12} />
          </button>
          <span className="dot" style={{ background: 'var(--c)' }} />
          <RichLine
            value={rt.name}
            onChange={(name) => name.trim() && patch({ name })}
            placeholder="Routine name"
          />
        </>
      }
      actions={
        <>
          {collapsed && active.length > 0 && (
            <span className="chip">{active.length} item{active.length === 1 ? '' : 's'}</span>
          )}
          {shelved.length > 0 && (
            <span className="chip" title="Kept on the routine, skipped when it is applied">
              <Icon name="moon" size={11} /> {shelved.length} shelved
            </span>
          )}
          {load > 0 && <span className="chip"><Icon name="clock" size={11} /> {minutesLabel(load)}</span>}
          <button className="btn ghost sm danger" onClick={removeRoutine} aria-label={`Delete ${rt.name}`}>
            <Icon name="trash" size={13} />
          </button>
        </>
      }
    >
      {!collapsed && (<>
      <div className="rt-controls">
        <div className="rt-layout">
          <button
            className={`btn ghost sm ${isColumns ? '' : 'is-on'}`}
            title="List"
            onClick={() => patch({ layout: 'list' })}
          >
            <Icon name="list" size={13} />
          </button>
          <button
            className={`btn ghost sm ${isColumns ? 'is-on' : ''}`}
            title="Three columns"
            onClick={() => patch({ layout: 'columns' })}
          >
            <Icon name="columns" size={13} />
          </button>
        </div>

        <ColorPicker value={rt.color} onChange={(color) => patch({ color })} />

        {/* Set once here rather than on every line: a routine's items nearly
            always share a project and a kind of attention, and the per-item
            controls below stay available for the exception. */}
        <label className="rt-field" title="Every task this routine creates starts in this project, unless the item names its own">
          <span>Project</span>
          <ProjectSelect
            projects={projects}
            value={rt.project_id}
            onChange={(project_id) => patch({ project_id })}
          />
        </label>

        <div className="rt-field" role="group" aria-label="Default intensity">
          <span>Intensity</span>
          <div className="rt-seg">
            <button
              className={`btn ghost sm ${isDeep ? '' : 'is-on'}`}
              aria-pressed={!isDeep}
              title="Light — chores and admin, which never draw on the thinking budget"
              onClick={() => patch({ default_intensity: 'light' })}
            >
              Light
            </button>
            <button
              className={`btn ghost sm ${isDeep ? 'is-deep-on' : ''}`}
              aria-pressed={isDeep}
              title="Deep — every task in this routine counts toward the day's thinking budget"
              onClick={() => patch({ default_intensity: 'deep' })}
            >
              Deep
            </button>
          </div>
        </div>

        <span className="spacer" />

        <label className="rt-check" title="An inactive routine is not offered on any day">
          <input
            type="checkbox"
            checked={!!rt.active}
            onChange={(e) => patch({ active: e.target.checked ? 1 : 0 })}
          />
          Active
        </label>
        <label className="rt-check" title="Keep this routine's chores out of the cross-cutting task list">
          <input
            type="checkbox"
            checked={!!rt.hide_from_all_tasks}
            onChange={(e) => patch({ hide_from_all_tasks: e.target.checked ? 1 : 0 })}
          />
          Hide from All tasks
        </label>
      </div>

      <div className="rt-items">
        {rt.items.length === 0 && (
          <Empty>No items yet. Add the first line of the routine below.</Empty>
        )}

        {active.map((it) => (
          <RoutineItem
            key={it.id}
            item={it}
            projects={projects}
            inherits={rtProject}
            onPatch={patchItem}
            onRemove={removeItem}
          />
        ))}

        {rt.items.length > 0 && active.length === 0 && (
          <Empty>Every item is shelved, so applying this routine would add nothing.</Empty>
        )}

        {/* Grouped rather than merely sorted: one heading explains the whole
            block, so the rows below it need no per-row justification for being
            dimmed, and an item does not silently change places on unshelving. */}
        {shelved.length > 0 && (
          <>
            <div className="rt-shelf-h">
              <Icon name="moon" size={12} />
              {shelved.length} shelved — kept here, skipped when the routine is applied
            </div>
            {shelved.map((it) => (
              <RoutineItem
                key={it.id}
                item={it}
                projects={projects}
                inherits={rtProject}
                onPatch={patchItem}
                onRemove={removeItem}
              />
            ))}
          </>
        )}
      </div>

      <form className="quick-add" onSubmit={addItem}>
        <input
          className="input"
          placeholder="Add an item…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn primary" type="submit"><Icon name="plus" size={14} /> Add</button>
      </form>

      <div className="quick-add row">
        <span className="rt-hint">Apply to…</span>
        <input
          className="input"
          type="date"
          style={{ width: 150 }}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button className="btn" onClick={apply} disabled={!date || active.length === 0}>Apply</button>
        <span className="spacer" />
        <span className="rt-hint">Re-applying tops the section up rather than duplicating it.</span>
      </div>
      </>)}
    </Panel>
  )
}

/**
 * One line of a routine. A shelved item keeps every control it had — shelving is
 * a pause, not an archive, and the row has to stay editable to be worth keeping.
 */
function RoutineItem({ item, projects, inherits, onPatch, onRemove }) {
  const shelved = !!item.shelved

  return (
    <div className={`rt-item ${shelved ? 'rt-shelved' : ''}`}>
      <input
        className="input rt-time"
        type="time"
        value={item.start_time || ''}
        onChange={(e) => onPatch(item, { start_time: e.target.value || null })}
      />
      <span className="rt-title">
        <RichLine
          value={item.title}
          onChange={(title) => title.trim() && onPatch(item, { title })}
          placeholder="Item"
        />
      </span>
      <select
        className={`select input rt-status rt-s-${item.default_status || 'todo'}`}
        title="The state this item is in when the routine is applied"
        aria-label={`Default status for ${item.title}`}
        value={item.default_status || 'todo'}
        onChange={(e) => onPatch(item, { default_status: e.target.value })}
      >
        {STATUSES.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <input
        className="input rt-min"
        type="number"
        min="0"
        step="5"
        placeholder="min"
        value={item.estimate_min ?? ''}
        onChange={(e) => onPatch(item, { estimate_min: e.target.value ? Number(e.target.value) : null })}
      />
      <div className="rt-project">
        {/* Leaving this empty inherits the routine's project, so it says which
            one — otherwise the row claims "No project" while the task it makes
            would land in one. */}
        <ProjectSelect
          projects={projects}
          value={item.project_id}
          noneLabel={inherits ? `Routine: ${inherits.name}` : 'No project'}
          onChange={(project_id) => onPatch(item, { project_id })}
        />
      </div>
      <button
        className="btn ghost sm rt-shelve"
        aria-pressed={shelved}
        aria-label={`${shelved ? 'Unshelve' : 'Shelve'} ${item.title}`}
        title={shelved
          ? 'Unshelve — add this again when the routine is applied'
          : 'Shelve — keep it here, but skip it when the routine is applied'}
        onClick={() => onPatch(item, { shelved: shelved ? 0 : 1 })}
      >
        <Icon name="moon" size={13} />
      </button>
      <button
        className="btn ghost sm"
        aria-label={`Remove ${item.title}`}
        onClick={() => onRemove(item)}
      >
        <Icon name="trash" size={13} />
      </button>
    </div>
  )
}
