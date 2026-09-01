/**
 * "Press somewhere else and this goes away" — on a phone as well as a mouse.
 *
 * Every dismissal in the app listened for `mousedown` alone, and a tap does not
 * reliably produce one. A touch browser synthesises mouse events from a tap
 * only where it judges the target was meant to be clicked: a button, a link, or
 * something carrying a click handler or `cursor: pointer`. Tap a bare stretch
 * of the day with a row menu open and no `mousedown` is dispatched at all, so
 * the menu stays up. That is the "sometimes" in "sometimes clicking away does
 * not close it" — it depended entirely on what happened to be under your
 * finger, which is invisible to the person doing the tapping.
 *
 * `pointerdown` is dispatched for the contact itself, whatever it landed on, so
 * it fires for every tap. Both are listened for rather than one: a browser
 * without Pointer Events still needs `mousedown`, and hearing both costs
 * nothing, because putting something away twice is putting it away once.
 *
 * The press, not the click: a gesture that starts inside and ends outside — a
 * drag, or a selection running past an edge — should not count as leaving.
 *
 *   inside   refs that count as "still in here"; a null ref is ignored, so a
 *            panel that has not rendered yet does not throw
 *   leave    called with the event when the press landed outside all of them
 *   capture  run before the pressed element's own handlers. Needed where
 *            closing re-renders whatever was pressed, which otherwise swallows
 *            the press and costs a second one.
 */
const DOWN = ['pointerdown', 'mousedown']

export function onAway(inside, leave, { capture = false } = {}) {
  const away = (e) => {
    for (const ref of inside) if (ref?.current?.contains(e.target)) return
    leave(e)
  }
  for (const type of DOWN) window.addEventListener(type, away, capture)
  return () => {
    for (const type of DOWN) window.removeEventListener(type, away, capture)
  }
}
