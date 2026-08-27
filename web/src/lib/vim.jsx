import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'

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

/** Rows on screen, in the order they are drawn. */
const rows = () => [...document.querySelectorAll('.task[data-task-id]')]
const idsOnScreen = () => rows().map((el) => Number(el.dataset.taskId))

const rowFor = (id) => document.querySelector(`.task[data-task-id="${id}"]`)

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
  const [enabled, setEnabled] = useState(() => localStorage.getItem('vim_mode') === '1')
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
    const next = on ?? !enabled
    setEnabled(next)
    localStorage.setItem('vim_mode', next ? '1' : '0')
    setMode('normal')
    setPending('')
    if (!next) setCursor(null)
  }, [enabled])

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

  /** Put the cursor somewhere sensible, and keep it on screen. */
  const move = useCallback((to) => {
    const ids = idsOnScreen()
    if (!ids.length) return
    const at = cursor == null ? -1 : ids.indexOf(cursor)
    let next = at
    if (to === 'down') next = at < 0 ? 0 : Math.min(ids.length - 1, at + 1)
    else if (to === 'up') next = at < 0 ? 0 : Math.max(0, at - 1)
    else if (to === 'first') next = 0
    else if (to === 'last') next = ids.length - 1
    else if (typeof to === 'number') next = Math.max(0, Math.min(ids.length - 1, to))
    const id = ids[next]
    setCursor(id)
    rowFor(id)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // Recovering a cursor whose row has gone is done in VimLayer, where the DOM
  // is already being watched. A timer here could not see the moment a row was
  // removed, and re-armed itself on every render besides.

  const value = useMemo(() => ({
    enabled, toggle, mode, setMode, cursor, setCursor, selection, move,
    pending, command, flash, say, actions, registers, register,
    helpOpen, setHelpOpen, setAnchor, setPending, setCommand,
  }), [enabled, toggle, mode, cursor, selection, move, pending, command, flash, say, helpOpen])

  return (
    <ActionContext.Provider value={actions}>
      <VimContext.Provider value={value}>{children}</VimContext.Provider>
    </ActionContext.Provider>
  )
}
