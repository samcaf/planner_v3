/**
 * The day/night switch, beneath the mark at the foot of the rail.
 *
 * Both faces are mandalas built from the same two pieces, so they read as one
 * object seen twice: an edge of hyperbolic arcs — each side pulled in toward the
 * centre, meeting at points — and the eight-pointed khatim that covers Islamic
 * tilework.
 *
 * The sun is that edge at full size with the khatim cut out of it, which is why
 * the centre reads on any background rather than needing a second colour.
 *
 * The night face is a different figure: a wide, thin crescent ring with a small
 * crescent at its centre and sparks scattered around them — concentric, and
 * open at one side, so it reads as a night sky rather than as a moon on its
 * own. Both crescents are one disc minus another, offset; where the subtracted
 * disc pushes past the outer edge, the ring opens, and that gap is what makes
 * the horns.
 *
 * It shows what you are about to get rather than what you have: a moon means
 * "make it night". A control showing the current state leaves you working out
 * which way it acts every time you look at it.
 */

const P = (x, y) => `${x.toFixed(2)} ${y.toFixed(2)}`
const at = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]

/**
 * A closed ring of `n` quadratic arcs. Tips sit at `R`; each arc is bent toward
 * a control point at `rc`, so the smaller `rc` is the more sharply the edge is
 * drawn in between the points.
 */
function edge(cx, cy, R, rc, n) {
  let d = ''
  for (let i = 0; i <= n; i++) {
    const a = (i * 2 * Math.PI) / n
    const [x, y] = at(cx, cy, R, a)
    if (i === 0) { d += `M${P(x, y)}`; continue }
    const [mx, my] = at(cx, cy, rc, a - Math.PI / n)
    d += `Q${P(mx, my)} ${P(x, y)}`
  }
  return `${d}Z`
}

/** The khatim: two squares at 45° to each other, as one path. */
function khatim(cx, cy, r) {
  const square = (rot) =>
    [0, 90, 180, 270].map((a) => {
      const t = ((a + rot) * Math.PI) / 180
      return P(cx + r * Math.cos(t), cy + r * Math.sin(t))
    })
  const [a, b] = [square(0), square(45)]
  return `M${a[0]}L${a[1]}L${a[2]}L${a[3]}Z M${b[0]}L${b[1]}L${b[2]}L${b[3]}Z`
}

const disc = (cx, cy, r) => `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${2 * r}a${r} ${r} 0 1 0 0 ${-2 * r}Z`

/** A four-pointed spark: a diamond whose sides are pulled in toward its centre. */
function spark(cx, cy, r) {
  const k = r * 0.34
  return `M${P(cx, cy - r)}Q${P(cx + k, cy - k)} ${P(cx + r, cy)}`
    + `Q${P(cx + k, cy + k)} ${P(cx, cy + r)}`
    + `Q${P(cx - k, cy + k)} ${P(cx - r, cy)}`
    + `Q${P(cx - k, cy - k)} ${P(cx, cy - r)}Z`
}

/** Each crescent is a disc with a second, offset disc taken out of it. */
const RING = { o: [20, 20, 15.4], i: [21.9, 18.1, 13.9] }
const CORE = { o: [20.2, 20.4, 5.2], i: [21.9, 19.0, 4.5] }

/** Sparks fade as they go out, so the eye settles on the middle. */
const SPARKS = [
  [31.4, 7.6, 2.5, 0.85], [8.0, 10.6, 1.9, 0.7], [33.6, 29.4, 1.7, 0.6],
  // Pulled in from y=3.4: at the moon's scale the window starts at 3.33, and
  // this spark's top edge was outside it.
  [11.4, 32.6, 1.5, 0.5], [20.2, 5.8, 1.3, 0.45],
]

/**
 * Each face is drawn against the same 40-unit square and the same centre, then
 * shown through a smaller viewport — which magnifies it about that centre without
 * touching the button's own size, so the mark above it never moves and the two
 * faces stay concentric with each other.
 */
function viewWindow(scale) {
  const side = 40 / scale
  const off = 20 - side / 2
  return `${off.toFixed(2)} ${off.toFixed(2)} ${side.toFixed(2)} ${side.toFixed(2)}`
}

const SUN_VIEW = viewWindow(1.1)
const MOON_VIEW = viewWindow(1.2)

export default function DayNight({ dark, onToggle }) {
  const label = dark ? 'Switch to day' : 'Switch to night'

  return (
    <button type="button" className="daynight" title={label} aria-label={label} onClick={onToggle}>
      <svg viewBox={dark ? SUN_VIEW : MOON_VIEW} aria-hidden="true">
        {dark ? (
          // Silhouette, khatim as a hole in it, and the eye filled back in —
          // three subpaths, so even-odd alternates fill and hole down the stack.
          <path className="dn-ink" fillRule="evenodd" d={`${edge(20, 20, 17.5, 4.5, 12)} ${khatim(20, 20, 7)} ${disc(20, 20, 2.4)}`} />
        ) : (
          <>
{/* A mask, not even-odd: even-odd on two overlapping discs gives their
                symmetric difference — a lens-shaped hole — where what is wanted
                is one taken out of the other.

                The ring and the centre get a mask each rather than sharing one,
                so the ring can be held back. At full strength it was the
                brightest thing in the rail and sat on top of the sidebar rather
                than in it; at this weight it reads as depth behind the moon,
                which is what the artwork it comes from does. */}
            <defs>
              {[['dn-ring', RING], ['dn-core', CORE]].map(([id, { o, i }]) => (
                <mask key={id} id={id}>
                  <rect width="40" height="40" fill="black" />
                  <circle cx={o[0]} cy={o[1]} r={o[2]} fill="white" />
                  <circle cx={i[0]} cy={i[1]} r={i[2]} fill="black" />
                </mask>
              ))}
            </defs>
            <rect className="dn-ink dn-far" width="40" height="40" mask="url(#dn-ring)" />
            <rect className="dn-ink" width="40" height="40" mask="url(#dn-core)" />
            {SPARKS.map(([x, y, r, o]) => (
              <path key={`${x}-${y}`} className="dn-ink" d={spark(x, y, r)} opacity={o} />
            ))}
          </>
        )}
      </svg>
    </button>
  )
}
