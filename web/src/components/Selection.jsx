import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import Popover from './Popover.jsx'
import { PRIORITIES, PriorityIcon } from './Priority.jsx'
import { useToast } from './Toast.jsx'
import { Field } from './ui.jsx'
import { api, useApi } from '../lib/api.js'
import { useUndo } from '../lib/undo.jsx'
import '../styles/selection.css'

const SelectionContext = createContext(null)

/** Null outside a provider, so a list that has not opted in renders no affordance. */
export const useSelection = () => useContext(SelectionContext)

/**
 * Per-page state rather than a module singleton: the provider unmounts on
 * navigation, which is what stops a selection outliving the list it was made in.
 */
export function SelectionProvider({ children }) {
  const [ids, setIds] = useState(() => new Set())
  // What a shift-click measures from — the last row picked by hand.
  const anchor = useRef(null)
  // Refs, not state: the page re-registers on every render, and storing these
  // in state would make each registration a further render.
  const allIds = useRef([])
  const onKeys = useRef(null)

  const clear = useCallback(() => {
    anchor.current = null
    setIds((prev) => (prev.size ? new Set() : prev))
  }, [])

  const select = useCallback((list) => {
    setIds((prev) => {
      const next = new Set(prev)
      for (const id of list) next.add(id)
      return next
    })
  }, [])

  const toggle = useCallback((id) => {
    anchor.current = id
    setIds((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  /** `listIds` is the order the caller is actually rendering, so a range means
   *  what the eye sees rather than what the ids happen to sort as. */
  const selectRange = useCallback((id, listIds = []) => {
    const from = listIds.indexOf(anchor.current)
    const to = listIds.indexOf(id)
    if (from < 0 || to < 0) { toggle(id); return }
    select(listIds.slice(Math.min(from, to), Math.max(from, to) + 1))
  }, [select, toggle])

  /**
   * What a key does to the current selection. Single letters, because they are
   * only live while something is selected and no field has focus — so they cost
   * nothing the rest of the time and never eat typing.
   */
  const KEYS = {
    x: { label: 'complete', patch: { status: 'done' } },
    d: { label: 'complete', patch: { status: 'done' } },
    i: { label: 'start', patch: { status: 'doing' } },
    o: { label: 'make optional', patch: { optional: 1 } },
    O: { label: 'make committed', patch: { optional: 0 } },
    // Not a patch: sending to the backlog copies the task's path out with it,
    // which only the server can do. See POST /api/tasks/:id/backlog.
    b: { label: 'send to backlog', backlog: true },
  }

  useEffect(() => {
    function onKey(e) {
      if (e.altKey) return
      // A field's own keys — a rename, a date picker — always win.
      const el = document.activeElement
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return

      // Select-all is the one that has to work from an empty selection, so it
      // is handled before the "something is selected" gate below.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        const all = allIds.current
        if (!all.length) return
        e.preventDefault()
        select(all)
        return
      }
      if (e.metaKey || e.ctrlKey) return
      if (!ids.size) return

      if (e.key === 'Escape') { clear(); return }

      const action = KEYS[e.key]
      if (!action) return
      e.preventDefault()
      onKeys.current?.(action, [...ids])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ids, clear, select])

  const value = useMemo(() => ({
    ids,
    size: ids.size,
    has: (id) => ids.has(id),
    select,
    toggle,
    selectRange,
    clear,
    // A page registers the rows it is showing and how to act on them, so the
    // shortcuts above stay page-agnostic rather than reaching into any one view.
    register: (rows, handler) => { allIds.current = rows; onKeys.current = handler },
  }), [ids, select, toggle, selectRange, clear])

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

/**
 * Select — or clear — a whole group at once: one column of a three-column
 * section, or a section entire. It reads as a tri-state, because "some of these
 * are picked" is a different answer from "none are", and clicking it when the
 * group is partly selected takes the whole group rather than dropping what you
 * already had.
 */
export function SelectAllBox({ ids = [], label = 'these tasks', className = '' }) {
  const sel = useSelection()
  if (!sel || !ids.length) return null

  const picked = ids.filter((id) => sel.has(id)).length
  const all = picked === ids.length
  const some = picked > 0 && !all

  return (
    <button
      type="button"
      className={`sel-all ${all ? 'is-on' : ''} ${some ? 'is-some' : ''} ${className}`}
      role="checkbox"
      aria-checked={all ? 'true' : some ? 'mixed' : 'false'}
      title={all ? `Deselect ${label}` : `Select ${label} (${ids.length})`}
      onClick={(e) => {
        e.stopPropagation()
        if (all) ids.forEach((id) => sel.has(id) && sel.toggle(id))
        else sel.select(ids)
      }}
    >
      {all
        ? <Icon name="check" size={10} strokeWidth={3} />
        : some ? <span className="sel-all-dash" /> : null}
    </button>
  )
}

/**
 * The ids a drag is carrying. A row that was part of a selection also writes the
 * whole list, so a target reading this handles both without knowing which.
 */
export function draggedIds(e) {
  const many = e.dataTransfer.getData('text/task-ids')
  if (many) {
    try {
      const list = JSON.parse(many)
      if (Array.isArray(list) && list.length) return list.map(Number)
    } catch { /* malformed — fall through to the single id */ }
  }
  const one = Number(e.dataTransfer.getData('text/task-id'))
  return one ? [one] : []
}

/** dragover cannot read the payload, only the type list — enough to light up. */
export function isTaskDrag(e) {
  return Array.from(e.dataTransfer.types).includes('text/task-id')
}

/** The other drag a day carries: a whole section being moved up or down. */
export function isSectionDrag(e) {
  return Array.from(e.dataTransfer.types).includes('text/section-id')
}

const rowsFor = (ids, known) =>
  Promise.all(ids.map(async (id) => known.find((t) => t.id === id) || api.get(`/tasks/${id}`)))

/**
 * A batch of PATCHes under ONE undo entry — recording one per row would make
 * Ctrl-Z walk the batch back a task at a time. `changes` must never carry
 * `parent_id`: PATCH rejects it, re-parenting goes through /nest.
 */
export async function bulkPatch(ids, changes, { known = [], label, undo } = {}) {
  if (!ids.length) return 0

  const rows = await rowsFor(ids, known)
  const before = rows.map((row) => [
    row.id,
    Object.fromEntries(Object.keys(changes).map((k) => [k, row[k] ?? null])),
  ])
  const apply = async () => { for (const id of ids) await api.patch(`/tasks/${id}`, changes) }

  await apply()

  undo?.record?.({
    label: label || `change ${ids.length} tasks`,
    undo: async () => { for (const [id, patch] of before) await api.patch(`/tasks/${id}`, patch) },
    redo: apply,
  })

  return ids.length
}

/**
 * `parent_id` is ON DELETE CASCADE, so deleting a parent takes subtasks that
 * were never selected with it. Those are snapshotted too, or undo would bring
 * the parent back on its own.
 */
function withDescendants(ids, known) {
  const out = new Set(ids)
  for (let grew = true; grew;) {
    grew = false
    for (const t of known) {
      if (t.parent_id != null && out.has(t.parent_id) && !out.has(t.id)) { out.add(t.id); grew = true }
    }
  }
  return [...out]
}

/** Parents before children: `parent_id` is a real foreign key, so restoring a
 *  child while its parent is still missing is rejected outright. */
function parentsFirst(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out = []
  const seen = new Set()

  const place = (row) => {
    if (seen.has(row.id)) return
    seen.add(row.id)
    const parent = byId.get(row.parent_id)
    if (parent) place(parent)
    out.push(row)
  }

  rows.forEach(place)
  return out
}

/**
 * Delete a batch, undoably, as one entry. Rows are snapshotted whole before
 * anything goes, which is what /tasks/restore needs to reinstate them with
 * their own ids — anything nested still points at those.
 */
export async function bulkRemove(ids, { known = [], undo } = {}) {
  const rows = await Promise.all(withDescendants(ids, known).map((id) => api.get(`/tasks/${id}`)))
  const order = parentsFirst(rows)
  const wipe = async () => { for (const row of [...order].reverse()) await api.del(`/tasks/${row.id}`) }
  const restore = async () => { for (const row of order) await api.post('/tasks/restore', row) }

  await wipe()

  undo?.record?.({ label: `delete ${rows.length} tasks`, undo: restore, redo: wipe })

  return { restore, count: rows.length }
}

/**
 * Bulk actions for whatever is selected. Portalled to <body> so a page that puts
 * its columns in overflow containers cannot clip it.
 */
export function SelectionBar({ tasks = [], onDone }) {
  const sel = useSelection()
  const undo = useUndo()

  // The bar unmounts when nothing is selected, so the keyboard wiring cannot
  // live inside it — select-all has to work from an empty selection. It is
  // registered here instead, where the page's rows are already in hand.
  const rows = tasks.filter((t) => t.kind !== 'note').map((t) => t.id)
  useEffect(() => {
    sel?.register(rows, async (action, ids) => {
      if (action.backlog) {
        // Remember where each one was, so undo can put it back on its own day
        // rather than on whichever day happens to be open.
        const from = ids.map((id) => {
          const t = tasks.find((x) => x.id === id)
          return { id, date: t?.scheduled_date, section_id: t?.section_id ?? null }
        }).filter((x) => x.date)

        const out = async () => { for (const { id } of from) await api.post(`/tasks/${id}/backlog`, {}) }
        const back = async () => {
          for (const { id, date, section_id } of from) {
            await api.post(`/tasks/${id}/schedule`, { date, section_id })
          }
        }
        await out()
        undo?.record?.({ label: action.label, undo: back, redo: out })
      } else {
        await bulkPatch(ids, action.patch, { known: tasks, label: action.label, undo })
      }
      sel.clear()
      onDone?.()
    })
  })

  if (!sel?.size) return null
  return createPortal(<Bar sel={sel} tasks={tasks} onDone={onDone} />, document.body)
}

function Bar({ sel, tasks, onDone }) {
  const projects = useApi('/projects')
  const undo = useUndo()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const ids = [...sel.ids]
  const n = ids.length
  const plural = n === 1 ? 'task' : 'tasks'

  // Everything here ends by refetching: a bulk day change also drops section
  // membership server-side, so the lists would otherwise show it stale. The
  // selection survives a failure so the batch can be retried.
  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      sel.clear()
    } catch (err) {
      toast({ message: err.message })
    } finally {
      setBusy(false)
      onDone?.()
    }
  }

  const patch = (changes, label) => run(() => bulkPatch(ids, changes, { known: tasks, label, undo }))

  const remove = () => run(async () => {
    const { restore, count } = await bulkRemove(ids, { known: tasks, undo })
    toast({
      message: `Deleted ${count} ${count === 1 ? 'task' : 'tasks'}`,
      action: { label: 'Undo', onClick: async () => { await restore(); onDone?.() } },
    })
  })

  return (
    <div className="sel-bar" role="toolbar" aria-label={`${n} selected`}>
      <span className="sel-count">{n} selected</span>

      <Field label="Move to day">
        <input
          className="input"
          type="date"
          disabled={busy}
          // Only the date: stamping `moved` on a batch would wipe the status of
          // everything in it that was already done.
          onChange={(e) => e.target.value && patch({ scheduled_date: e.target.value }, `move ${n} ${plural}`)}
        />
      </Field>

      <Field label="Move to project">
        <select
          className="input select"
          value=""
          disabled={busy}
          onChange={(e) => {
            if (!e.target.value) return
            patch(
              { project_id: e.target.value === 'none' ? null : Number(e.target.value) },
              `file ${n} ${plural}`,
            )
          }}
        >
          <option value="">Pick one…</option>
          <option value="none">No project</option>
          {(projects.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>

      <Popover
        label="Priority"
        role="menu"
        className="menu"
        width={164}
        trigger={(p) => (
          <button {...p} className="btn sm" disabled={busy}>
            Priority <Icon name="chevronDown" size={12} />
          </button>
        )}
      >
        {(close) => PRIORITIES.map((level) => (
          <button
            key={level}
            className="menu-item pri-opt"
            role="menuitem"
            onClick={() => { close(); patch({ priority: level }, `set ${n} ${plural} to ${level}`) }}
          >
            <PriorityIcon level={level} />
            <span>{level}</span>
          </button>
        ))}
      </Popover>

      <button className="btn sm" disabled={busy} onClick={() => patch({ status: 'done' }, `complete ${n} ${plural}`)}>
        <Icon name="check" size={13} /> Done
      </button>
      <button className="btn sm danger" disabled={busy} onClick={remove}>
        <Icon name="trash" size={13} /> Delete
      </button>
      <button className="btn ghost sm" title="Clear selection (Esc)" onClick={sel.clear}>
        <Icon name="x" size={13} /> Clear
      </button>
    </div>
  )
}
