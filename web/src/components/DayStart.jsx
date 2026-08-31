import { useEffect, useState } from 'react'
import { today } from '../lib/dates.js'
import '../styles/complete.css'

/** Before this hour the day has not started; you are still on the last one. */
const DAWN = 6

/**
 * The moment a day begins.
 *
 * The companion to DayComplete, and it fires on the opposite kind of event.
 * Completion is a TRANSITION you watch for — the last task going green under
 * you — and can happen at any hour. A beginning is not something you can watch
 * for: by the time the page is open it has already happened. So this fires on
 * arrival, and the once-only-ness has to be remembered rather than inferred.
 *
 * Three conditions, and each rules out a way of seeing it when you should not:
 *
 *   it is TODAY          opening next Tuesday to plan it is not living it
 *   it is after 6am      a day opened at two in the morning is the one before
 *   you have not seen it stored, because a reload is not a new day
 *
 * The mark is written the first time rather than on the way out, so a page
 * closed mid-animation still counts as having been shown.
 */
export default function DayStart({ date }) {
  const [showing, setShowing] = useState(false)

  useEffect(() => {
    if (!date || date !== today()) return
    if (new Date().getHours() < DAWN) return

    const key = `day_start:${date}`
    let seen = null
    try { seen = localStorage.getItem(key) } catch { return }
    if (seen) return

    try {
      // Only today's mark is worth keeping. Without this the key is one row
      // per day forever, in storage nothing ever reads again.
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('day_start:') && k !== key) localStorage.removeItem(k)
      }
      localStorage.setItem(key, '1')
    } catch { /* private mode: show it, and show it again next time */ }
    setShowing(true)
  }, [date])

  useEffect(() => {
    if (!showing) return
    const timer = setTimeout(() => setShowing(false), 4200)
    return () => clearTimeout(timer)
  }, [showing])

  if (!showing) return null

  return (
    <div
      className="dc is-start"
      role="status"
      aria-live="polite"
      onClick={() => setShowing(false)}
    >
      <div className="dc-glow" />
      <p className="dc-words">
        {'DAY START'.split('').map((ch, i) => (
          <span
            key={`${ch}-${i}`}
            className="dc-ch"
            style={{ animationDelay: `${180 + i * 55}ms` }}
          >
            {ch === ' ' ? ' ' : ch}
          </span>
        ))}
      </p>
    </div>
  )
}
