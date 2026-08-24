/**
 * The day/night switch, beneath the mark at the foot of the rail.
 *
 * Drawn in the geometric idiom the mark belongs to: an eight-pointed khatim —
 * two squares set at 45° to each other, the star that covers Islamic tilework —
 * as the sun's core, and the same star kept as the companion to a crescent.
 *
 * It shows what you are about to get rather than what you have: a moon means
 * "make it night". A control showing the current state leaves you working out
 * which way it acts every time you look at it.
 */

/** Eight points, as two overlapping squares. `r` is the outer radius. */
function Khatim({ cx, cy, r }) {
  const square = (rot) =>
    [0, 90, 180, 270]
      .map((a) => {
        const t = ((a + rot) * Math.PI) / 180
        return `${(cx + r * Math.cos(t)).toFixed(2)},${(cy + r * Math.sin(t)).toFixed(2)}`
      })
      .join(' ')

  return (
    <>
      <polygon points={square(0)} />
      <polygon points={square(45)} />
    </>
  )
}

export default function DayNight({ dark, onToggle }) {
  const label = dark ? 'Switch to day' : 'Switch to night'

  return (
    <button type="button" className="daynight" title={label} aria-label={label} onClick={onToggle}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        {dark ? (
          <>
            <Khatim cx={20} cy={20} r={7.2} />
            {Array.from({ length: 8 }, (_, i) => {
              const a = ((i * 45 + 22.5) * Math.PI) / 180
              return (
                <line
                  key={i}
                  className="dn-ray"
                  x1={(20 + 10.2 * Math.cos(a)).toFixed(2)}
                  y1={(20 + 10.2 * Math.sin(a)).toFixed(2)}
                  x2={(20 + 15.8 * Math.cos(a)).toFixed(2)}
                  y2={(20 + 15.8 * Math.sin(a)).toFixed(2)}
                />
              )
            })}
          </>
        ) : (
          <>
            {/* Two arcs, not a masked or even-odd pair of discs. Even-odd on two
                discs gives their symmetric difference — a lens-shaped hole, not
                a crescent — and a mask is more machinery than a shape this
                simple deserves. The outer arc is a half-circle; the inner one
                returns on a longer radius, and the gap between them is the
                moon. */}
            <path d="M20 8 A12 12 0 0 0 20 32 A16 16 0 0 1 20 8 Z" />
            <Khatim cx={28.5} cy={14} r={3.2} />
          </>
        )}
      </svg>
    </button>
  )
}
