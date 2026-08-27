import { useId } from 'react'

/**
 * A pomegranate, drawn in the same geometric idiom as the mark and the day/night
 * switch: a khatim at its heart, a ring of seeds around it, a crown of sepals.
 *
 * The fruit is a pomegranate rather than the tomato the technique is named
 * after because the tomato belongs to a kitchen timer and this artwork does not.
 * The pomegranate is the fruit of Persian and Mughal ornament — the thing the
 * rest of this project's art is quoting — and it is already full of the
 * geometry: a shell of seeds around a centre.
 *
 * Progress fills the fruit itself. The whole symbol is drawn twice, the second
 * time clipped to everything below a waterline, so shell, seeds, khatim and
 * crown all change colour together as the phase runs — rather than a ring
 * around the outside, which said the same thing while sitting apart from the
 * thing it described.
 */

const P = (x, y) => `${x.toFixed(2)} ${y.toFixed(2)}`

const CX = 20
const CY = 21.6
const R = 10.2

/**
 * Where to put the waterline so that the AREA below it is `p` of the whole.
 *
 * Raising the line at a constant rate would not do: a circle is widest at its
 * middle, so a line halfway up covers half the height but well over half the
 * area near the ends and less in between. For a unit circle the area below a
 * line at height u (from the centre, up positive) is
 *
 *     A(u) = u·√(1 − u²) + asin(u) + π/2
 *
 * of a total π. That has no closed-form inverse worth writing, and twenty
 * bisections settle it to within a millionth — far finer than a 40-unit glyph
 * can show.
 */
function waterline(p) {
  const want = Math.max(0, Math.min(1, p))
  if (want <= 0) return CY + R
  if (want >= 1) return CY - R

  const below = (u) => (u * Math.sqrt(Math.max(0, 1 - u * u)) + Math.asin(u) + Math.PI / 2) / Math.PI
  let lo = -1
  let hi = 1
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (below(mid) < want) lo = mid; else hi = mid
  }
  // SVG counts y downward, so a higher waterline is a smaller y.
  return CY - R * ((lo + hi) / 2)
}

/** Two squares at 45°, as one path. */
function khatim(cx, cy, r) {
  const square = (rot) =>
    [0, 90, 180, 270].map((a) => {
      const t = ((a + rot) * Math.PI) / 180
      return P(cx + r * Math.cos(t), cy + r * Math.sin(t))
    })
  const [a, b] = [square(0), square(45)]
  return `M${a[0]}L${a[1]}L${a[2]}L${a[3]}Z M${b[0]}L${b[1]}L${b[2]}L${b[3]}Z`
}

/** The sepals, as a small fan of tapered points. */
function crown(cx, cy, r, n) {
  let d = ''
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.5
    d += `M${P(cx + r * 0.55 * Math.cos(a - 0.36), cy + r * 0.55 * Math.sin(a - 0.36))}`
      + `L${P(cx + r * 1.7 * Math.cos(a), cy + r * 1.7 * Math.sin(a))}`
      + `L${P(cx + r * 0.55 * Math.cos(a + 0.36), cy + r * 0.55 * Math.sin(a + 0.36))}Z`
  }
  return d
}

const SEEDS = Array.from({ length: 6 }, (_, i) => {
  const a = (i * Math.PI) / 3 + Math.PI / 6
  return [CX + 6.6 * Math.cos(a), CY + 6.5 * Math.sin(a)]
})

/** The whole fruit. Drawn twice — once plain, once clipped — so the two agree. */
function Body() {
  return (
    <>
      <circle className="pom-shell" cx={CX} cy={CY} r={R} />
      <path className="pom-ink" fillRule="evenodd" d={khatim(CX, CY, 3.6)} />
      {SEEDS.map(([x, y]) => (
        <circle key={`${x.toFixed(1)}-${y.toFixed(1)}`} className="pom-seed" cx={x} cy={y} r="1.15" />
      ))}
      <path className="pom-ink" d={crown(CX, CY - R + 0.6, 2.7, 5)} />
    </>
  )
}

export default function Pomegranate({ progress = 0, className = '' }) {
  const done = Math.max(0, Math.min(1, progress))
  // Unique per instance: two pomodoros on one page would otherwise share a clip
  // and the second would wear the first's progress.
  const clip = `pom-fill-${useId().replace(/:/g, '')}`
  const y = waterline(done)

  return (
    <svg className={`pom ${className}`} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <rect x="0" y={y.toFixed(3)} width="40" height={(40 - y).toFixed(3)} />
        </clipPath>
      </defs>

      <g className="pom-body"><Body /></g>
      {done > 0 && (
        <g className="pom-body is-filled" clipPath={`url(#${clip})`}><Body /></g>
      )}
    </svg>
  )
}
