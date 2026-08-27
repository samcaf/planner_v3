import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import Icon from './Icon.jsx'
import { Rich } from '../lib/rich.jsx'
import { api, useApi } from '../lib/api.js'
import { cls } from './ui.jsx'
import '../styles/search.css'

/**
 * One box over everything the planner holds.
 *
 * The pieces were all searchable separately — a query box on the task list, a
 * filter on the project page — which is fine when you know where a thing is and
 * useless when you do not, which is the only time you search. This is the whole
 * database behind one field, narrowed by whichever filters apply to what you
 * are looking for.
 *
 * Results are real links, so anything found is one click from where it lives.
 */

const KINDS = [
  ['task', 'Tasks'],
  ['note', 'Day notes'],
  ['notebook', 'Notebook'],
  ['day', 'Days'],
  ['project', 'Projects'],
  ['person', 'People'],
  ['upload', 'Uploads'],
]

const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest']
const STATUSES = ['todo', 'doing', 'done', 'dropped']

const ICON = {
  task: 'check', note: 'templates', notebook: 'templates', day: 'today',
  project: 'projects', person: 'people', upload: 'paperclip',
}

/** Everything the query narrows on, as URL params the server understands. */
function paramsFor(q, f) {
  const p = new URLSearchParams()
  if (q.trim()) p.set('q', q.trim())
  if (f.kinds.length) p.set('kind', f.kinds.join(','))
  if (f.projectId) p.set('project_id', String(f.projectId))
  if (f.priorities.length) p.set('priority', f.priorities.join(','))
  if (f.statuses.length) p.set('status', f.statuses.join(','))
  if (f.exts.trim()) p.set('ext', f.exts.trim())
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  return p
}

const NO_FILTERS = {
  kinds: [], projectId: null, priorities: [], statuses: [], exts: '', from: '', to: '',
}

export default function Search() {
  const [q, setQ] = useState('')
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const box = useRef(null)
  const input = useRef(null)
  const panel = useRef(null)
  const [pos, setPos] = useState(null)
  const location = useLocation()

  /**
   * Where the panel goes, in viewport coordinates.
   *
   * The rail scrolls, and a scroll container clips its children sideways as
   * well as vertically — so a panel positioned inside it was cut off at the
   * rail's edge however wide it was told to be. It is portalled to <body> and
   * placed against the viewport instead, then pulled back from the right edge
   * so a wide panel beside a wide rail still fits.
   */
  const place = useCallback(() => {
    const anchor = box.current?.getBoundingClientRect()
    if (!anchor) return
    const width = panel.current?.getBoundingClientRect().width || 520
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    setPos({
      top: anchor.bottom + 4,
      left: Math.min(Math.max(8, anchor.left), Math.max(8, vw - 8 - width)),
      maxHeight: Math.max(220, vh - anchor.bottom - 20),
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    place()
    // `true` for the capture phase: the rail is a scroll container of its own,
    // and a scroll inside it does not bubble to the window.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place, showFilters])

  const projects = useApi('/projects')

  // Typing straight into the query string would refetch on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed), 220)
    return () => clearTimeout(timer)
  }, [typed])

  const active = useMemo(() => {
    const n = filters.kinds.length + filters.priorities.length + filters.statuses.length
      + (filters.projectId ? 1 : 0) + (filters.exts.trim() ? 1 : 0)
      + (filters.from ? 1 : 0) + (filters.to ? 1 : 0)
    return n
  }, [filters])

  const query = paramsFor(q, filters).toString()
  // With nothing typed and nothing narrowed there is nothing to ask for; the
  // server would refuse a one-letter query anyway.
  const runnable = q.trim().length >= 2 || active > 0
  const [hits, setHits] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !runnable) { setHits(null); return }
    let cancelled = false
    setBusy(true)
    api.get(`/search?${query}`)
      .then((r) => { if (!cancelled) setHits(r) })
      .catch(() => { if (!cancelled) setHits({ results: [], count: 0 }) })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [open, runnable, query])

  // Ctrl/Cmd-K from anywhere, the shortcut every search box has. Escape closes.
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        input.current?.focus()
        input.current?.select()
      }
      if (e.key === 'Escape' && open) { setOpen(false); input.current?.blur() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])

  // A click anywhere else puts it away.
  useEffect(() => {
    if (!open) return
    const away = (e) => {
      if (box.current?.contains(e.target)) return
      if (panel.current?.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  // Following a result closes the panel; staying open over the page you just
  // opened hides the thing you were looking for.
  useEffect(() => { setOpen(false) }, [location.pathname])

  const toggle = (key, value) => setFilters((f) => ({
    ...f,
    [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value],
  }))

  const grouped = useMemo(() => {
    const out = new Map()
    for (const r of hits?.results || []) {
      if (!out.has(r.kind)) out.set(r.kind, [])
      out.get(r.kind).push(r)
    }
    return [...out.entries()]
  }, [hits])

  return (
    <div className="sb-search" ref={box}>
      <div className="sb-search-box">
        <Icon name="search" size={13} />
        <input
          ref={input}
          className="sb-search-input"
          placeholder="Search everything"
          aria-label="Search everything"
          value={typed}
          onChange={(e) => { setTyped(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
        {(typed || active > 0) && (
          <button
            className="sb-search-x"
            title="Clear"
            onClick={() => { setTyped(''); setQ(''); setFilters(NO_FILTERS) }}
          >
            <Icon name="x" size={11} strokeWidth={2.4} />
          </button>
        )}
      </div>

      {open && createPortal(
        <div
          ref={panel}
          className="sb-results panel"
          role="dialog"
          aria-label="Search results"
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            maxHeight: pos?.maxHeight,
            // Hidden until measured, or it flashes at the top-left corner.
            visibility: pos ? undefined : 'hidden',
          }}
        >
          <div className="sb-res-head">
            <button
              className={`btn ghost sm ${showFilters || active ? 'is-on' : ''}`}
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
            >
              <Icon name="list" size={12} /> Filters
              {active > 0 && <span className="at-count">{active}</span>}
            </button>
            <span className="spacer" />
            <span className="muted sb-res-count">
              {busy ? 'Searching…' : hits ? `${hits.count} found` : 'Type, or pick a filter'}
            </span>
          </div>

          {showFilters && (
            <div className="sb-filters">
              <Row label="Kind">
                {KINDS.map(([k, label]) => (
                  <Chip key={k} on={filters.kinds.includes(k)} onClick={() => toggle('kinds', k)}>
                    {label}
                  </Chip>
                ))}
              </Row>

              <Row label="Priority">
                {PRIORITIES.map((p) => (
                  <Chip key={p} on={filters.priorities.includes(p)} onClick={() => toggle('priorities', p)}>
                    {p}
                  </Chip>
                ))}
              </Row>

              <Row label="Status">
                {STATUSES.map((st) => (
                  <Chip key={st} on={filters.statuses.includes(st)} onClick={() => toggle('statuses', st)}>
                    {st}
                  </Chip>
                ))}
              </Row>

              <Row label="Project">
                <select
                  className="input select sb-f-select"
                  value={filters.projectId ?? ''}
                  onChange={(e) => setFilters((f) => ({
                    ...f, projectId: e.target.value ? Number(e.target.value) : null,
                  }))}
                >
                  <option value="">Any project</option>
                  {(projects.data || []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Row>

              <Row label="Scheduled">
                <input
                  className="input sb-f-date" type="date" value={filters.from}
                  onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                />
                <span className="muted">to</span>
                <input
                  className="input sb-f-date" type="date" value={filters.to}
                  onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                />
              </Row>

              <Row label="File type">
                <input
                  className="input sb-f-ext"
                  placeholder="pdf, png, docx"
                  value={filters.exts}
                  onChange={(e) => setFilters((f) => ({ ...f, exts: e.target.value }))}
                />
              </Row>

              {active > 0 && (
                <button className="btn ghost sm" onClick={() => setFilters(NO_FILTERS)}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          <div className="sb-res-list">
            {!runnable && <p className="muted sb-res-empty">Two letters, or a filter, to begin.</p>}
            {runnable && hits && hits.count === 0 && !busy && (
              <p className="muted sb-res-empty">Nothing matches.</p>
            )}
            {grouped.map(([kind, rows]) => (
              <section key={kind} className="sb-res-group">
                <h4 className="sb-res-kind">
                  <Icon name={ICON[kind] || 'search'} size={11} />
                  {KINDS.find(([k]) => k === kind)?.[1] || kind}
                  <span className="muted"> {rows.length}</span>
                </h4>
                {rows.map((r) => (
                  <Result key={`${r.kind}-${r.id}-${r.field}`} row={r} />
                ))}
              </section>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="sb-f-row">
      <span className="sb-f-label">{label}</span>
      <div className="sb-f-vals">{children}</div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return (
    <button className={`at-chip ${on ? 'is-on' : ''}`} onClick={onClick} aria-pressed={on}>
      {children}
    </button>
  )
}

/**
 * An upload is a real file rather than a route, so it opens in its own tab; the
 * router would try to resolve /uploads/xyz.png as a page and find nothing.
 */
function Result({ row }) {
  const inner = (
    <>
      <span className="sb-res-title">
        {row.project_color && <span className={`dot ${cls(row.project_color)}`} />}
        <Rich text={row.title} inline />
      </span>
      {row.snippet && <span className="sb-res-snip">{row.snippet}</span>}
      <span className="sb-res-meta">
        {row.project_name && <span className="chip">{row.project_name}</span>}
        {row.date && <span className="muted">{row.date}</span>}
      </span>
    </>
  )

  if (row.kind === 'upload') {
    return (
      <a className="sb-res-row" href={row.href} target="_blank" rel="noopener noreferrer">{inner}</a>
    )
  }
  return <Link className="sb-res-row" to={row.href}>{inner}</Link>
}
