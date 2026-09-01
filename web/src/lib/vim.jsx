import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import { useMobile } from './mobile.js'

/**
 * Keyboard-first control over the task list.
 *
 * Two rules shape the whole thing.
 *
 * The cursor is found in the DOM, not held by a page. Every view that draws
 * tasks draws `.task[data-task-id]`, so navigation works on the day, the
 * project pages and the all-tasks list without any of them knowing this exists.
 *
 * Actions go through the page's own handlers, not the API. A page calls
 * `useVimActions({...})` to lend what it already has — the same functions its
 * buttons call — so every keystroke is undoable exactly like the click it
 * replaces. Where a row already has a control, the key drives that control
 * rather than reaching past it; where it does not, the page has to have lent a
 * handler, and the key reports that it cannot when no page has.
 */

const VimContext = createContext(null)
const ActionContext = createContext({ current: {} })

export const useVim = () => useContext(VimContext)

/** A page lends its handlers for as long as it is mounted. */
export function useVimActions(handlers) {
  const slot = useContext(ActionContext)
  // A ref rather than state: handlers close over fresh data every render, and
  // storing them in state would re-render the whole tree on each keystroke.
  useEffect(() => {
    slot.current = handlers
    return () => { if (slot.current === handlers) slot.current = {} }
  })
}

const MODES = { normal: 'NORMAL', insert: 'INSERT', visual: 'VISUAL', command: 'COMMAND' }

/**
 * Everywhere the cursor can stop, in the order they are drawn.
 *
 * Sections are stops as well as tasks. A section element CONTAINS its tasks, so
 * document order puts the heading immediately before the first of them — which
 * is exactly where the stop belongs: `k` off the first task lands on the
 * section, `j` off the last lands on the next one.
 *
 * A stop is identified by a key rather than an id, because two kinds of thing
 * share one cursor: `12` is a task, `'s12'` a section. Keys are compared with
 * `===` throughout, so the two can never be mistaken for one another.
 *
 * FOUR kinds now, and the fourth is a row whose whole point is a button. A
 * routine in the day's side column is not a task and never will be — it is an
 * offer to make several — but it still wants a cursor on it, because "add the
 * morning routine" is exactly the sort of thing you reach for with your hands
 * on the keys. Those rows carry `data-act`, and Enter presses whatever they
 * mark `data-act-go`.
 *
 * Exported, because the layer that draws the cursor has to walk the same list.
 * It used to write the selector out again and fell a kind behind: rows every
 * movement key could reach were unpaintable, so the repaint read the cursor as
 * pointing at something deleted and sent it back to the day.
 */
export const STOPS = '.panel.section[data-section-id], .task[data-task-id], [data-open], [data-act]'

const stopEls = () => [...document.querySelectorAll(STOPS)]

export const keyOf = (el) => {
  if (el?.dataset?.sectionId) return `s${el.dataset.sectionId}`
  // A card is keyed by where it goes. That is already unique on the page, and
  // it starts with a slash, so it can never be read as a section key or a task
  // id no matter what else is on screen.
  if (el?.dataset?.open) return el.dataset.open
  // An action row names itself, and the name starts with ! for the same reason
  // a card's starts with / — so the four kinds of key can never collide.
  if (el?.dataset?.act) return el.dataset.act
  return Number(el?.dataset?.taskId)
}

export const isSectionKey = (key) => typeof key === 'string' && key.startsWith('s')
export const sectionIdOf = (key) => (isSectionKey(key) ? key.slice(1) : null)
export const isCardKey = (key) => typeof key === 'string' && key.startsWith('/')
export const isActKey = (key) => typeof key === 'string' && key.startsWith('!')

const idsOnScreen = () => stopEls().map(keyOf)

/** The element a key points at, whichever kind it is. */
const rowFor = (key) => {
  if (isSectionKey(key)) {
    return document.querySelector(`.panel.section[data-section-id="${sectionIdOf(key)}"]`)
  }
  // Matched by scanning rather than by an attribute selector: the key is a
  // path, and building a selector out of it would need escaping — CSS.escape
  // is not everywhere, and these lists are a dozen cards long.
  if (isCardKey(key)) {
    return [...document.querySelectorAll('[data-open]')].find((el) => el.dataset.open === key) || null
  }
  if (isActKey(key)) {
    return [...document.querySelectorAll('[data-act]')].find((el) => el.dataset.act === key) || null
  }
  return document.querySelector(`.task[data-task-id="${key}"]`)
}

/** The element a key points at — exported so the layer does not redefine it. */
export const elementFor = rowFor

/**
 * How many cards sit side by side in one row of a card grid.
 *
 * Read off the page, because the grid is `auto-fill` and the answer changes
 * with the window. Cards on the same row share a top edge; counting them gives
 * j and k a stride, so they move down a row rather than one card along.
 *
 * Falls back to one — a single column — when the page has not been laid out,
 * which is also what makes this behave sensibly under a test runner that does
 * no layout at all.
 */
export function cardsAcross(els) {
  const rects = els.map((el) => el.getBoundingClientRect())
  // Nothing has been laid out — every box is zero. Then every card shares a
  // top edge and they would all read as one enormous row, so say one column
  // instead, which is what an unlaid page most resembles.
  if (!rects.some((r) => r.width > 0)) return 1
  const first = Math.round(rects[0].top)
  const n = rects.filter((r) => Math.round(r.top) === first).length
  return n > 1 ? n : 1
}

/**
 * Which of a section's three boxes a row is drawn in, and where among them.
 *
 * Read off the page rather than computed: the grid decides what goes where,
 * and asking the DOM is the only way to agree with it — including inside a
 * sub-section band, which has three boxes of its own.
 */
export function columnOf(id) {
  const row = rowFor(id)
  const col = row?.closest('.box-col')
  if (!col) return null
  const grid = col.parentElement
  const cols = [...grid.children].filter((el) => el.classList.contains('box-col'))
  return { grid, index: cols.indexOf(col), cols }
}

/** The rows of one box, in the order they are drawn. */
export const idsIn = (col) => [...col.querySelectorAll('.task[data-task-id]')]
  .map((el) => Number(el.dataset.taskId))

/** Is the caret in something that wants the keystroke more than we do? */
function typing() {
  const el = document.activeElement
  if (!el) return false
  if (el.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

const fire = (el, type, init = {}) => {
  if (!el) return false
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...init }))
  return true
}

/** Durations the way the timing box already accepts them: 90, 2h, 1h30m. */
export function parseDuration(text) {
  const s = String(text || '').trim().toLowerCase()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m?)?$/.exec(s)
  if (!m || (!m[1] && !m[2])) return null
  return Number(m[1] || 0) * 60 + Number(m[2] || 0)
}

/** Markdown stripped back to what it says, for text that has to be plain. */
const asPlain = (md) => String(md || '')
  // Every kind of prefix: one left out reads as `link:repo` in the yank.
  .replace(/\[\[(?:day:|project:|task:|note:|link:)?([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, l) => l || t)
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*`_]/g, '')
  .trim()

/**
 * `yy` — what the tasks say.
 *
 * A task is its title, and its note underneath when it has one. More than one
 * task is separated by a blank line, so a yank of several reads as a list
 * rather than running together.
 */
export function yankText(tasks) {
  return tasks
    .map((t) => {
      const title = asPlain(t.title)
      const notes = asPlain(t.notes)
      return notes ? `${title}\n${notes}` : title
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * `yt` — the same tasks as markdown, under the section they came from.
 *
 * Sections become `#` and tasks `##`, so a yank pasted into a note keeps the
 * shape it had on the day. The metadata line carries only what was actually
 * set: an empty estimate or no project would otherwise print as noise.
 */
export function yankMarkdown(tasks, { sectionName } = {}) {
  const out = []
  let section = null

  for (const t of tasks) {
    const heading = sectionName?.(t) || null
    if (heading && heading !== section) {
      section = heading
      out.push(`# ${asPlain(section)}`)
    }
    out.push(`## ${asPlain(t.title)}`)

    const meta = []
    if (t.status && t.status !== 'todo') meta.push(t.status)
    if (t.optional) meta.push('optional')
    if (t.estimate_min) meta.push(minutes(t.estimate_min))
    if (t.start_time) meta.push(t.end_time ? `${t.start_time}–${t.end_time}` : t.start_time)
    if (t.priority && t.priority !== 'medium') meta.push(`${t.priority} priority`)
    if (t.project_name) meta.push(t.project_name)
    if (t.scheduled_date) meta.push(t.scheduled_date)
    if (meta.length) out.push(`*${meta.join(' · ')}*`)

    const notes = asPlain(t.notes)
    if (notes) out.push(notes)
    out.push('')
  }
  return out.join('\n').trim()
}

const minutes = (m) => (m >= 60
  ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`
  : `${m}m`)

/** `tomorrow`, `+3`, `-1`, or a plain ISO date. */
export function parseWhen(text, from) {
  const s = String(text || '').trim().toLowerCase()
  const base = new Date(`${from}T00:00:00`)
  const iso = (d) => [
    d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'),
  ].join('-')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (s === 'today') return iso(base)
  if (s === 'tomorrow' || s === 'tom') { base.setDate(base.getDate() + 1); return iso(base) }
  if (s === 'yesterday') { base.setDate(base.getDate() - 1); return iso(base) }
  if (/^[+-]\d+$/.test(s)) { base.setDate(base.getDate() + Number(s)); return iso(base) }
  return null
}

export function VimProvider({ children }) {
  // Off on a phone, whatever the stored preference says. A keyboard mode with
  // no keyboard is a bar across the bottom of the screen that eats a tenth of
  // it and can never be dismissed, and the setting is not cleared because the
  // same account on a laptop should still find it on.
  const phone = useMobile()
  const [vimWanted, setEnabled] = useState(() => localStorage.getItem('vim_mode') === '1')
  const enabled = vimWanted && !phone
  const [mode, setMode] = useState('normal')
  const [cursor, setCursor] = useState(null)
  const [anchor, setAnchor] = useState(null)   // where visual mode started
  const [pending, setPending] = useState('')   // keys typed so far in a sequence
  const [command, setCommand] = useState('')
  const [flash, setFlash] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)

  const actions = useRef({})
  const registers = useRef({})
  const register = useRef('"')

  const say = useCallback((text) => {
    setFlash(text)
    clearTimeout(say.timer)
    say.timer = setTimeout(() => setFlash(''), 2200)
  }, [])

  const toggle = useCallback((on) => {
    const next = on ?? !vimWanted
    setEnabled(next)
    localStorage.setItem('vim_mode', next ? '1' : '0')
    setMode('normal')
    setPending('')
    if (!next) setCursor(null)
  }, [vimWanted])

  // The selection: just the cursor in normal mode, the span back to the anchor
  // in visual mode.
  const selection = useMemo(() => {
    if (cursor == null) return []
    if (mode !== 'visual' || anchor == null) return [cursor]
    const ids = idsOnScreen()
    const a = ids.indexOf(anchor)
    const b = ids.indexOf(cursor)
    if (a < 0 || b < 0) return [cursor]
    return ids.slice(Math.min(a, b), Math.max(a, b) + 1)
  }, [cursor, anchor, mode])

  /**
   * Put the cursor somewhere sensible, and keep it on screen.
   *
   * `n` is the count, applied here rather than by the caller looping. Calling
   * this twice does not move two rows: it reads `cursor` from the render it was
   * built in, so both calls start from the same place and `2j` moved one.
   */
  const move = useCallback((to, n = 1) => {
    const els = stopEls()
    const ids = els.map(keyOf)
    if (!ids.length) return
    const at = cursor == null ? -1 : ids.indexOf(cursor)
    const steps = Math.max(1, n)

    /**
     * Down and up a COLUMN, then out of the grid entirely.
     *
     * Document order runs a three-box grid box by box, so plain j at the foot
     * of the first box walked sideways into the top of the second — which is
     * what h and l are for. Inside a grid, j and k stay in their box, and at
     * its edges they step over the whole grid: out of a band into the section's
     * own work, or out of a section into the next one.
     */
    const outOf = (grid, from, dir) => {
      for (let i = from + dir; i >= 0 && i < els.length; i += dir) {
        if (!grid.contains(els[i])) return i
      }
      return null
    }

    let next = at
    if (to === 'first') next = 0
    else if (to === 'last') next = ids.length - 1
    else if (typeof to === 'number') next = Math.max(0, Math.min(ids.length - 1, to))
    else if (at < 0) next = 0
    else {
      const dir = to === 'down' || to === 'right' ? 1 : -1
      const col = els[at]?.closest?.('.box-col')
      const grid = col?.parentElement

      // A grid of cards is not a list. j and k step down and up a row, which
      // is a whole row's worth of cards along in document order; h and l, one
      // card, and those come through as a count of one either way.
      if (isCardKey(ids[at])) {
        const cards = els.filter((el) => el.dataset?.open)
        const here = cards.indexOf(els[at])
        const stride = to === 'down' || to === 'up' ? cardsAcross(cards) : 1
        const want = here + dir * stride * steps
        const landed = cards[Math.max(0, Math.min(cards.length - 1, want))]
        next = ids.indexOf(keyOf(landed))
      } else if (col && grid) {
        const inCol = idsIn(col)
        const i = inCol.indexOf(cursor)
        const want = i + dir * steps
        if (i >= 0 && want >= 0 && want < inCol.length) {
          next = ids.indexOf(inCol[want])
        } else {
          // Past the end of the box: leave the grid rather than sliding into
          // the box beside it. A count that overshoots lands here too, which is
          // the same thing vim does at the end of a buffer.
          const outside = outOf(grid, at, dir)
          next = outside === null ? at : outside
        }
      } else {
        next = Math.max(0, Math.min(ids.length - 1, at + dir * steps))
      }
    }

    const id = ids[next]
    setCursor(id)
    rowFor(id)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // Recovering a cursor whose row has gone is done in VimLayer, where the DOM
  // is already being watched. A timer here could not see the moment a row was
  // removed, and re-armed itself on every render besides.

  /**
   * Put the cursor on a row that does not exist yet.
   *
   * Creating a task is a round trip and a refetch, so the row a page has just
   * asked for is not on screen when the call returns. Setting the cursor to it
   * straight away is worse than doing nothing: the repaint sees an id that is
   * nowhere, decides the row has been deleted, and moves the cursor somewhere
   * else — so `o` left you pointing at the task ABOVE the one it made.
   *
   * So wait for it. The cursor stays where it was until the row appears, which
   * is also the only moment moving it can be seen. Bounded, because a create
   * that fails or lands on another day must not leave a poller running.
   */
  const wanted = useRef(null)
  const selectSoon = useCallback((id) => {
    if (id == null) return
    wanted.current = id
    let tries = 0
    const look = () => {
      if (wanted.current !== id) return
      if (typeof document === 'undefined' || !document?.querySelector) return
      const el = rowFor(id)
      if (el) {
        wanted.current = null
        setCursor(id)
        el.scrollIntoView?.({ block: 'nearest' })
        return
      }
      if (++tries > 50) { wanted.current = null; return }
      setTimeout(look, 40)
    }
    look()
  }, [])

  const value = useMemo(() => ({
    enabled, toggle, mode, setMode, cursor, setCursor, selection, move,
    pending, command, flash, say, actions, registers, register,
    helpOpen, setHelpOpen, setAnchor, setPending, setCommand, selectSoon,
  }), [enabled, toggle, mode, cursor, selection, move, pending, command, flash, say,
    helpOpen, selectSoon])

  return (
    <ActionContext.Provider value={actions}>
      <VimContext.Provider value={value}>{children}</VimContext.Provider>
    </ActionContext.Provider>
  )
}
