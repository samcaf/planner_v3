import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../styles/priority.css'

const GAP = 6      // breathing room between the trigger and the panel
const EDGE = 8     // smallest margin we will leave against a viewport edge
const MIN_H = 120  // under this a flipped panel is useless, so it scrolls instead

/**
 * Where the panel can actually go. It is `position: fixed`, so everything here
 * is in viewport coordinates and no scroll offsets come into it.
 */
function place(trigger, panel) {
  const t = trigger.getBoundingClientRect()
  const { width, height } = panel.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight

  const below = vh - EDGE - (t.bottom + GAP)
  const above = t.top - GAP - EDGE

  // Flip up only when it helps. A panel too tall for either side stays below
  // and scrolls, rather than jumping to a side that is no better.
  const up = height > below && above > below
  const maxHeight = Math.max(MIN_H, up ? above : below)
  const top = up
    ? Math.max(EDGE, t.top - GAP - Math.min(height, maxHeight))
    : t.bottom + GAP

  // Left-aligned with the trigger, then pulled back from whichever edge it
  // crosses. The inner Math.max keeps a panel wider than the viewport pinned to
  // the left edge instead of being pushed off it.
  const left = Math.min(Math.max(EDGE, t.left), Math.max(EDGE, vw - EDGE - width))

  return { top, left, maxHeight }
}

/**
 * A dropdown that survives its surroundings. The day view nests rows inside two
 * `overflow` scroll containers, so an absolutely-positioned menu is clipped by
 * an ancestor and a menu near the bottom of the list runs off the screen — this
 * portals to <body> and measures itself against the viewport instead.
 *
 *   trigger  — (props) => element; spread `props` onto a focusable element
 *   children — nodes, or (close) => nodes
 *   className — the caller brings the surface, e.g. "menu"; `.pop` only scrolls
 */
export default function Popover({
  trigger,
  children,
  className = '',
  width,
  label,
  role = 'dialog',
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  const close = useCallback((refocus = true) => {
    setOpen(false)
    setPos(null)
    if (refocus) triggerRef.current?.focus()
  }, [])

  // Measured once the panel is in the DOM but before paint, so it is never seen
  // at the wrong place first.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return
    setPos(place(triggerRef.current, panelRef.current))
  }, [open])

  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return

    const away = (e) => {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      close(false) // the pointer already chose where focus should go
    }
    const key = (e) => { if (e.key === 'Escape') close() }
    const scrolled = (e) => {
      if (panelRef.current?.contains(e.target)) return // the panel's own scrollbar
      close(false)
    }

    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', key)
    // Capture: the scroll containers here are ancestors of the trigger, and
    // scroll events from an element never bubble up to window.
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', scrolled)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('resize', scrolled)
    }
  }, [open, close])

  return (
    <>
      {trigger({
        ref: triggerRef,
        'aria-expanded': open,
        'aria-haspopup': 'true',
        onClick: () => (open ? close() : setOpen(true)),
      })}

      {open && createPortal(
        <div
          ref={panelRef}
          className={`pop ${className}`}
          role={role}
          aria-label={label}
          tabIndex={-1}
          style={{
            // Inline rather than in priority.css: `.menu` carries its own
            // position/right/z-index, and these have to win no matter which
            // stylesheet the bundler happens to emit first.
            position: 'fixed',
            zIndex: 90,
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            right: 'auto',
            bottom: 'auto',
            width,
            maxHeight: pos?.maxHeight,
            visibility: pos ? undefined : 'hidden',
          }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>,
        document.body,
      )}
    </>
  )
}
