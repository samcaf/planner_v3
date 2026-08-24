import { useEffect } from 'react'

/**
 * Left and right walk the calendar by whatever the current view counts in — a
 * day on the day page, a week on the week page, a month on the month page.
 *
 * Ignored while a field has focus, so they never eat a caret moving through
 * text, and ignored with any modifier down, so they never fight the browser's
 * own back and forward.
 */
export function useArrowNav(step) {
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return

      const el = document.activeElement
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return

      e.preventDefault()
      step(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])
}
