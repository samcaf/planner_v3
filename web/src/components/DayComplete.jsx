import { useEffect, useRef, useState } from 'react'
import '../styles/complete.css'

/**
 * The moment a day is finished.
 *
 * It fires on the TRANSITION, not on the state: a day that is already done
 * when you open it has been done for hours, and announcing it every time you
 * navigate back would turn the one moment worth marking into wallpaper. So the
 * first render only records where the day stands, and the banner appears when
 * that changes from unfinished to finished under you.
 *
 * `date` keys the memory, so walking between days does not read one day's
 * completion as another's.
 */
export default function DayComplete({ date, done, total }) {
  const [showing, setShowing] = useState(false)
  const was = useRef(null)
  const seen = useRef(date)

  useEffect(() => {
    // A new day: take its state as the starting point, announce nothing.
    if (seen.current !== date) {
      seen.current = date
      was.current = null
    }
    const complete = total > 0 && done >= total
    const before = was.current
    was.current = complete
    if (before === false && complete) setShowing(true)
  }, [date, done, total])

  useEffect(() => {
    if (!showing) return
    const timer = setTimeout(() => setShowing(false), 4200)
    return () => clearTimeout(timer)
  }, [showing])

  if (!showing) return null

  return (
    <div
      className="dc"
      role="status"
      aria-live="polite"
      // Dismissable, because four seconds is a long time if you are mid-thought.
      onClick={() => setShowing(false)}
    >
      <div className="dc-glow" />
      <p className="dc-words">
        {'DAY COMPLETE'.split('').map((ch, i) => (
          <span
            key={`${ch}-${i}`}
            className="dc-ch"
            // Each letter a beat behind the last, so the phrase resolves rather
            // than arriving. The space keeps its slot but not its animation.
            style={{ animationDelay: `${180 + i * 55}ms` }}
          >
            {ch === ' ' ? ' ' : ch}
          </span>
        ))}
      </p>
    </div>
  )
}
