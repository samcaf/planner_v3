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
 * Progress is a ring AROUND the fruit rather than a level rising inside it. A
 * fill in the same colour swallowed the seeds and the khatim as it rose, so at
 * three quarters through there was nothing left to look at but a blob.
 */

const P = (x, y) => `${x.toFixed(2)} ${y.toFixed(2)}`

const RING_R = 16.4
const CIRC = 2 * Math.PI * RING_R

const CX = 20
const CY = 21.6
const R = 10.2

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

export default function Pomegranate({ progress = 0, className = '' }) {
  const done = Math.max(0, Math.min(1, progress))

  return (
    <svg className={`pom ${className}`} viewBox="0 0 40 40" aria-hidden="true">
      <circle className="pom-track" cx="20" cy="20" r={RING_R} />
      {done > 0 && (
        <circle
          className="pom-arc"
          cx="20" cy="20" r={RING_R}
          // Dash on, gap the whole circumference: one arc, however long.
          strokeDasharray={`${(CIRC * done).toFixed(2)} ${CIRC.toFixed(2)}`}
          transform="rotate(-90 20 20)"
        />
      )}

      <circle className="pom-shell" cx={CX} cy={CY} r={R} />
      <path className="pom-ink" fillRule="evenodd" d={khatim(CX, CY, 3.6)} />
      {SEEDS.map(([x, y]) => (
        <circle key={`${x.toFixed(1)}-${y.toFixed(1)}`} className="pom-seed" cx={x} cy={y} r="1.15" />
      ))}
      <path className="pom-ink" d={crown(CX, CY - R + 0.6, 2.7, 5)} />
    </svg>
  )
}
