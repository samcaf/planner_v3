import { useEffect } from 'react'

/**
 * A strong horizontal swipe across the page.
 *
 * The day's arrows come off the top bar on a phone, and this is what replaces
 * them — so it has to be reliable in both directions: it must fire when you
 * mean it, and it must never fire when you meant something else. The second
 * half is the hard one. A page full of scrolling lists and draggable rows is
 * full of gestures that begin like a swipe.
 *
 * "Strong" is three conditions, not one:
 *
 *   far     a short drag is a tap that slipped, or the start of a scroll
 *   flat    a gesture with real vertical travel is a scroll with a lean on it,
 *           so the horizontal part has to dominate by a wide margin
 *   fast    a slow horizontal drag is somebody reading, resting a finger, or
 *           panning something. A page turn is a flick.
 *
 * Distance alone would fire on every diagonal scroll. Speed alone would fire on
 * a flicked scroll. Requiring all three is what makes an accidental day change
 * — which loses your place with no visible cause — rare enough to be worth
 * having the gesture at all.
 */
const MIN_PX = 90      // shorter than this is not a page turn
const MIN_SPEED = 0.35 // px per ms — a flick, not a drag
const FLATNESS = 2     // horizontal travel must beat vertical by this much

/** Does anything from here up own horizontal movement already? */
function scrollsSideways(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const how = getComputedStyle(node).overflowX
      if (how === 'auto' || how === 'scroll') return true
    }
  }
  return false
}

/**
 * `onLeft` is the swipe whose content travels left — the next day, the way
 * every calendar on a phone reads. `onRight` goes back.
 */
export function useSwipe(onLeft, onRight, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return
    let from = null

    const down = (e) => {
      from = null
      // A mouse drag across a page is a text selection or a task being carried,
      // and neither should turn into navigation. This is a touch gesture.
      if (e.pointerType === 'mouse') return
      const el = e.target
      if (el?.closest?.('input, textarea, select, [contenteditable="true"], .pop, .modal, .modal-back')) return
      if (el && scrollsSideways(el)) return
      from = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    }

    const up = (e) => {
      if (!from) return
      const dx = e.clientX - from.x
      const dy = e.clientY - from.y
      const dt = Math.max(1, e.timeStamp - from.t)
      from = null
      if (Math.abs(dx) < MIN_PX) return
      if (Math.abs(dx) < Math.abs(dy) * FLATNESS) return
      if (Math.abs(dx) / dt < MIN_SPEED) return
      if (dx < 0) onLeft?.()
      else onRight?.()
    }

    // Capture on the way down so a stopped-propagation press inside a list
    // still registers where the gesture began; the release is read the same way.
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    // A gesture the browser takes over — a pull-to-refresh, a back-swipe — ends
    // as a cancel, and acting on it would fire on top of whatever the browser
    // just did. Named, not inline, so the cleanup can actually remove it.
    const cancel = () => { from = null }
    window.addEventListener('pointercancel', cancel, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
    }
  }, [enabled, onLeft, onRight])
}
