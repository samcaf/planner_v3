/**
 * How long a task is, drawn rather than written — and the control that selects
 * it. It stands where the selection checkbox used to, to the left of the status
 * box.
 *
 * A task's minutes are rounded to the nearest quarter hour and split as
 * `N1 × 30m + N2 × 15m`, so N2 is only ever 0 or 1. N1 becomes that many small
 * boxes stacked as a Young diagram — rows of at most three, longest first, so
 * the row lengths never increase going down. N2 adds a "therefore" ∴ to the
 * right. Past six boxes the stack stops being countable at a glance, so it
 * collapses to "N ×" and one box; the ∴ still shows, because it is the odd
 * quarter-hour rather than part of the count.
 *
 *   15m  ∴            60m  ▪▪           195m  ▪▪▪  ∴        300m  10× ▪
 *   30m  ▪            75m  ▪▪ ∴               ▪▪▪
 *   45m  ▪ ∴         120m  ▪▪▪▪
 *
 * The tilts are deliberate and deliberately deterministic: they come from the
 * box's own index, so the drawing has a hand-inked wobble that stays put across
 * re-renders instead of twitching every time the row updates.
 */

const BOX = 5
const GAP = 1.6
const PER_ROW = 3
const MAX_BOXES = 6

/** Rounded to the quarter hour, then split into half-hours and one remainder. */
export function splitTime(minutes) {
  const rounded = Math.round((minutes || 0) / 15) * 15
  return { halves: Math.floor(rounded / 30), quarter: (rounded % 30) / 15, rounded }
}

/** Row lengths of a Young diagram for n cells, at most PER_ROW wide. */
function rows(n) {
  const out = []
  for (let left = n; left > 0; left -= PER_ROW) out.push(Math.min(PER_ROW, left))
  return out
}

const TILT = [-6, 4, -3, 7, -5, 2, -4, 5]

function Cell({ i, x, y }) {
  return (
    <rect
      x={x} y={y} width={BOX} height={BOX} rx="1.2"
      transform={`rotate(${TILT[i % TILT.length]} ${x + BOX / 2} ${y + BOX / 2})`}
    />
  )
}

/** The ∴, as three dots: two below, one above and centred. */
function Therefore({ x, y }) {
  const r = 1.35
  return (
    <g className="tg-dots">
      <circle cx={x + 3} cy={y} r={r} />
      <circle cx={x} cy={y + 5} r={r} />
      <circle cx={x + 6} cy={y + 5} r={r} />
    </g>
  )
}

export default function TimeGlyph({ minutes = 0, selected = false, onSelect, label }) {
  const { halves, quarter, rounded } = splitTime(minutes)
  const many = halves > MAX_BOXES

  const shape = many ? [1] : rows(halves)
  const width = many ? PER_ROW * (BOX + GAP) : Math.max(1, shape[0] || 1) * (BOX + GAP)
  const height = Math.max(1, shape.length) * (BOX + GAP)
  const dotsX = width + 2

  const H = 13
  const W = dotsX + (quarter ? 9 : 0)
  const dy = (H - height) / 2

  const title = rounded
    ? `${label || 'Task'} — ${rounded} minutes. Click to select; shift-click for a range.`
    : `${label || 'Task'} — no estimate. Click to select; shift-click for a range.`

  return (
    <button
      type="button"
      className={`time-glyph${selected ? ' is-on' : ''}${rounded ? '' : ' is-empty'}`}
      title={title}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        {/* An untimed task still needs somewhere to click, so it keeps a faint
            outline rather than becoming an invisible hit target. */}
        {rounded === 0 && (
          <rect className="tg-ghost" x="0" y={(H - BOX) / 2} width={BOX} height={BOX} rx="1.2" />
        )}

        {many ? (
          <>
            <text className="tg-count" x="0" y={H / 2 + 3.2}>{halves}×</text>
            <Cell i={0} x={width - BOX} y={(H - BOX) / 2} />
          </>
        ) : (
          shape.flatMap((len, r) =>
            Array.from({ length: len }, (_, c) => (
              <Cell key={`${r}-${c}`} i={r * PER_ROW + c} x={c * (BOX + GAP)} y={dy + r * (BOX + GAP)} />
            ))
          )
        )}

        {quarter === 1 && <Therefore x={dotsX} y={H / 2 - 2.5} />}
      </svg>
    </button>
  )
}
