import { useState } from 'react'
import Icon from '../components/Icon.jsx'
import TaskRow, { nestTasks, visibleIds } from '../components/TaskRow.jsx'
import { draggedIds, isTaskDrag } from '../components/Selection.jsx'
import { ColorPicker, Empty, Panel, ProjectSelect, cls } from '../components/ui.jsx'
import { RichLine } from '../lib/rich.jsx'
import { api, useApi } from '../lib/api.js'
import { minutesLabel, shortDate, today } from '../lib/dates.js'
import '../styles/routines.css'

/*
 * A routine's items are edited with the same TaskRow a day's section uses, so
 * everything a row can do — status, priority, intensity, notes, the time panel,
 * drag to reorder, drag to nest, sub-steps — works here without a second, weaker
 * implementation of any of it.
 *
 * The two tables do not have the same columns, so the row is fed an adapted
 * object and its patches are translated back. The mapping below is the whole of
 * that translation, in both directions; a field that is not in it has no column
 * to write, which is why the affordances that would produce one are suppressed
 * rather than left on screen doing nothing.
 */

/** TaskRow patch key -> routine_items column. */
const ITEM_FIELD = {
  title: 'title',
  notes: 'notes',
  notes_hidden: 'notes_hidden',
  status: 'default_status',
  optional: 'default_optional',
  priority: 'default_priority',
  intensity: 'default_intensity',
  estimate_min: 'estimate_min',
  start_time: 'start_time',
  end_time: 'end_time',
  col_index: 'col_index',
}

/**
 * Why a patch had nowhere to go. An item is a template: it has no day, and the
 * row's date controls are hidden for it — but until the `dateless` prop below is
 * honoured they are still in the overflow menu, and a control that silently does
 * nothing is worse than one that explains itself.
 */
const NO_COLUMN = {
  scheduled_date: 'A routine item has no day of its own — it gets one when the routine is applied.',
  moved_to_date: 'A routine item has no day of its own — it gets one when the routine is applied.',
  subsection: 'Sub-sections belong to a day, not to the template that makes one.',
}

/**
 * One item in the shape TaskRow reads.
 *
 * Absent on purpose, and hidden by TaskRow for exactly that reason: scheduled_date,
 * due_date and moved_to_date (a template has no day), created_at, people, url and
 * location (a routine makes tasks, never meetings or notes), and `kind`, which is
 * always an ordinary task.
 */
function asTask(item, routine, projects) {
  const project = projects.find((p) => p.id === (item.project_id ?? routine.project_id))
  return {
    id: item.id,
    kind: 'task',
    title: item.title,
    notes: item.notes || '',
    notes_hidden: item.notes_hidden,
    // 'maybe' is a retired status the tasks table would now reject. It meant
    // "might do", which is the optional flag — the same bridge /apply uses.
    status: item.default_status === 'maybe' ? 'todo' : (item.default_status || 'todo'),
    optional: item.default_optional,
    priority: item.default_priority || 'medium',
    // The *effective* value, not the stored one: NULL means "whatever the
    // routine says", and a chip reading "light" beneath a deep routine would
    // misdescribe the task this item is actually going to produce.
    intensity: item.default_intensity ?? routine.default_intensity ?? 'light',
    estimate_min: item.estimate_min,
    start_time: item.start_time,
    end_time: item.end_time,
    col_index: item.col_index,
    parent_id: item.parent_id,
    project_name: project?.name,
    project_color: project?.color,
  }
}

/**
 * Shelving a parent shelves the branch — the identical rule /apply uses to
 * decide what to skip. Grouping by the item's own flag instead would show a
 * sub-step in the active list that applying the routine would never create.
 */
function branchShelved(item, byId) {
  const seen = new Set()
  for (let cursor = item; cursor; cursor = byId.get(cursor.parent_id)) {
    if (cursor.shelved) return true
    if (seen.has(cursor.id)) return true
    seen.add(cursor.id)
  }
  return false
}

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
  // The item created by the last add, so its title opens ready to type into —
  // the same trick the Day view uses for a new row.
  const [justAdded, setJustAdded] = useState(null)

  const byId = new Map(rt.items.map((i) => [i.id, i]))
  const mine = (id) => byId.has(Number(id))

  async function patch(body) {
    await api.patch(`/routines/${rt.id}`, body)
    reload()
  }

  async function patchItem(id, body) {
    await api.patch(`/routines/items/${id}`, body)
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

  /**
   * Translate one TaskRow patch onto the item's columns. A key with no column
   * says so out loud rather than being dropped on the floor.
   */
  async function changeItem(id, taskPatch) {
    const body = {}
    const orphans = []
    for (const [key, value] of Object.entries(taskPatch)) {
      if (ITEM_FIELD[key]) body[ITEM_FIELD[key]] = value
      else orphans.push(key)
    }
    if (Object.keys(body).length) {
      if (taskPatch.title !== undefined && id === justAdded) setJustAdded(null)
      await patchItem(id, body)
    }
    const explained = orphans.find((key) => NO_COLUMN[key])
    if (explained) flash(NO_COLUMN[explained])
  }

  /** A sub-step: created on the routine, then nested, exactly as a subtask is. */
  async function addChild(task) {
    const parent = byId.get(task.id)
    const created = await api.post(`/routines/${rt.id}/items`, {
      title: 'New step',
      // A sub-step of a line filed under a project belongs to the same one.
      project_id: parent?.project_id ?? null,
    })
    await api.post(`/routines/items/${created.id}/nest`, { parent_id: task.id })
    setJustAdded(created.id)
    reload()
  }

  const nestItem = async (id, parentId) => {
    if (!mine(id)) return
    await api.post(`/routines/items/${id}/nest`, { parent_id: parentId })
    reload()
  }

  /**
   * One gesture, two outcomes, the same as on a day: a drop across the middle of
   * a row nests, a drop near either edge reorders within that row's own sibling
   * group. `mine` is what keeps a drag from one routine's card out of another's
   * — the two lists are side by side on this page, and the server would reject
   * the cross-routine parent anyway, but silently doing nothing is clearer than
   * a rejected request.
   */
  async function onDropTask(draggedId, target, zone) {
    if (!mine(draggedId)) return
    if (zone === 'nest') { await nestItem(draggedId, target.id); return }

    const parentId = target.parent_id ?? null
    const siblings = rt.items
      .filter((i) => (i.parent_id ?? null) === parentId)
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((i) => i.id)
      .filter((id) => id !== draggedId)

    const at = siblings.indexOf(target.id)
    siblings.splice(zone === 'before' ? at : at + 1, 0, draggedId)

    await api.post('/routines/items/reorder', { ids: siblings, parent_id: parentId })
    reload()
  }

  /** Dropping a row onto the other group's panel is what shelves or unshelves it. */
  async function setShelved(ids, shelved) {
    const changing = ids.filter((id) => mine(id) && !!byId.get(id).shelved !== shelved)
    if (!changing.length) return
    await Promise.all(changing.map((id) =>
      api.patch(`/routines/items/${id}`, { shelved: shelved ? 1 : 0 })))
    reload()
  }

  async function removeItem(id) {
    const kids = rt.items.filter((i) => i.parent_id === id).length
    if (kids && !window.confirm(
      `Delete “${byId.get(id)?.title}” and its ${kids} sub-step${kids === 1 ? '' : 's'}?`
    )) return
    await api.del(`/routines/items/${id}`)
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
  // that describes what applying the routine would actually do. By *branch*, not
  // by the flag alone — a sub-step of a shelved line is never created either.
  const active = rt.items.filter((i) => !branchShelved(i, byId))
  const shelved = rt.items.filter((i) => branchShelved(i, byId))
  const load = active.reduce((sum, i) => sum + (i.estimate_min || 0), 0)

  const itemExtras = (task) => (
    <ItemExtras
      item={byId.get(task.id)}
      projects={projects}
      inherits={rtProject}
      onPatch={patchItem}
    />
  )

  const rowProps = (task) => ({
    task,
    subtasks: task.subtasks || [],
    onChange: (body, id = task.id) => changeItem(id, body),
    onDelete: (id = task.id) => removeItem(id),
    onNest: nestItem,
    onDropTask,
    onAddChild: addChild,
    autoEdit: task.id === justAdded,
    // An item's project chip is its own or, where it has none, the routine's —
    // which is the project the task will actually land in.
    showProject: true,
    /*
     * Both are additive props TaskRow does not yet accept; passing them is inert
     * until it does, and nothing here depends on them to be correct.
     *
     * `dateless` hides the row's three scheduling entries. A template has no day,
     * so "Move to tomorrow", "Move to…" and "Schedule today" have no column to
     * write — see NO_COLUMN above, which explains itself in a toast meanwhile.
     *
     * `rowExtras` is where the two controls with no TaskRow equivalent live: the
     * per-item project override, and shelving. Until it is honoured, shelving is
     * done by dragging a row between this card's two lists, and an item's project
     * follows the routine's.
     */
    dateless: true,
    rowExtras: itemExtras,
  })

  const asRows = (items) => nestTasks(items.map((i) => asTask(i, rt, projects)))

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

      <ItemList
        rows={asRows(active)}
        rowProps={rowProps}
        onDrop={(ids) => setShelved(ids, false)}
        empty={rt.items.length === 0
          ? 'No items yet. Add the first line of the routine below.'
          : 'Every item is shelved, so applying this routine would add nothing.'}
      />

      {/* Grouped rather than merely sorted: one heading explains the whole block,
          so the rows below it need no per-row justification for being dimmed, and
          an item does not silently change places on unshelving. The heading is
          also the drop target — dragging a row between the two lists is what
          shelves and unshelves it, the same gesture that moves a task between two
          sections on a day. */}
      <ItemList
        rows={asRows(shelved)}
        rowProps={rowProps}
        onDrop={(ids) => setShelved(ids, true)}
        heading={
          <>
            <Icon name="moon" size={12} />
            {shelved.length
              ? `${shelved.length} shelved — kept here, skipped when the routine is applied`
              : 'Shelved — drag an item here to keep it but skip it when the routine is applied'}
          </>
        }
        empty=""
      />

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
 * One group of a routine's items, rendered with the day view's own TaskRow.
 *
 * The whole body is a drop target, which is what moves an item between this
 * card's two groups — the same gesture that moves a task between two sections on
 * a day. A drop that a row handled itself (a reorder or a nest) never reaches
 * here, because TaskRow stops it.
 *
 * A shelved group renders nothing when it is empty *and* nothing is being
 * dragged; its heading is the target, so it has to stay on screen to be aimed at.
 */
function ItemList({ rows, rowProps, heading, empty, onDrop }) {
  const [over, setOver] = useState(false)
  const ids = visibleIds(rows)

  return (
    <div
      /* The shelf keeps its heading even when nothing is on it: the heading is
         the drop target, so it has to stay on screen to be aimed at, and it is
         where the gesture is explained. */
      className={['rt-items', heading ? 'rt-shelf' : '', over ? 'sel-drop-on' : ''].filter(Boolean).join(' ')}
      onDragOver={(e) => { if (!isTaskDrag(e)) return; e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const dropped = draggedIds(e)
        if (dropped.length) onDrop(dropped)
      }}
    >
      {heading && <div className="rt-shelf-h">{heading}</div>}
      {rows.length === 0
        ? (empty ? <Empty>{empty}</Empty> : null)
        : rows.map((row) => <TaskRow key={row.id} {...rowProps(row)} listIds={ids} />)}
    </div>
  )
}

/**
 * The two things a routine item has that a task does not, so TaskRow has no
 * control for either: which project it overrides the routine with, and whether
 * it is shelved.
 *
 * Rendered through TaskRow's `rowExtras`, which it does not accept yet — until
 * it does this is simply not on screen, and shelving is done by dragging a row
 * between the card's two lists. Absent beats present-and-dead.
 */
function ItemExtras({ item, projects, inherits, onPatch }) {
  if (!item) return null
  const shelved = !!item.shelved

  return (
    <span className="rt-row-extras">
      {/* Leaving this empty inherits the routine's project, so it says which one
          — otherwise the row claims "No project" while the task it makes would
          land in one. */}
      <ProjectSelect
        projects={projects}
        value={item.project_id}
        noneLabel={inherits ? `Routine: ${inherits.name}` : 'No project'}
        onChange={(project_id) => onPatch(item.id, { project_id })}
      />
      <button
        className="btn ghost sm rt-shelve"
        aria-pressed={shelved}
        aria-label={`${shelved ? 'Unshelve' : 'Shelve'} ${item.title}`}
        title={shelved
          ? 'Unshelve — add this again when the routine is applied'
          : 'Shelve — keep it here, but skip it when the routine is applied'}
        onClick={() => onPatch(item.id, { shelved: shelved ? 0 : 1 })}
      >
        <Icon name="moon" size={13} />
      </button>
    </span>
  )
}
