/**
 * How long a task is, drawn rather than written — and the control that selects
 * it. It stands where the selection checkbox used to, to the left of the status
 * box.
 *
 * A task's minutes are rounded to the nearest quarter hour and split as
 * `N1 × 30m + N2 × 15m`, so N2 is only ever 0 or 1. N1 becomes that many small
 * cells stacked as a Young diagram — longest row first, so row lengths never
 * increase going down. N2 adds a "therefore" ∴ beneath them.
 *
 * Everything here is arranged to spend as little width as it can, because every
 * pixel it takes is one the task's own text does not get: two cells to a row
 * rather than three, the ∴ under the stack rather than beside it, and a count
 * past four rather than a taller stack.
 *
 *   15m   ∴        60m  ▪▪        105m  ▪▪        150m  5× ▪
 *   30m   ▪        75m  ▪▪              ▪▪ ∴
 *   45m   ▪              ∴        120m  ▪▪
 *         ∴                             ▪▪
 *
 * The cells sit square and identical. An earlier version tilted each one a few
 * degrees for a hand-inked look; at this size the tilts read as boxes that
 * failed to line up rather than as a flourish, and counting them became harder,
 * which is the one thing the drawing exists to make easy.
 */

const BOX = 7.5
// Unchanged: the gap reads as a line between the cells, and widening the
// cells rather than the spacing is what makes the stack easier to count.
const GAP = 1.6
const PER_ROW = 2
const MAX_BOXES = 4

const DOTS_H = 7.4
const DOTS_W = 8.4
const DOTS_PAD = 2.4

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

function Cell({ x, y }) {
  return <rect x={x} y={y} width={BOX} height={BOX} rx="1.8" />
}

/** The ∴, as three dots: one above, two below. */
function Therefore({ cx, y }) {
  const r = 1.7
  return (
    <g className="tg-dots">
      <circle cx={cx} cy={y} r={r} />
      <circle cx={cx - 3.5} cy={y + 4.6} r={r} />
      <circle cx={cx + 3.5} cy={y + 4.6} r={r} />
    </g>
  )
}

export default function TimeGlyph({ minutes = 0, selected = false, onSelect, label }) {
  const { halves, quarter, rounded } = splitTime(minutes)
  const many = halves > MAX_BOXES

  const shape = many ? [1] : rows(halves)
  const cellsW = many ? 17.5 : Math.max(1, shape[0] || 1) * (BOX + GAP) - GAP
  // A quarter-hour task has no cells at all, and an untimed one shows a ghost
  // where a cell would be — so the block above the dots is only zero-height in
  // the first case.
  const cellsH = halves ? shape.length * (BOX + GAP) - GAP : (rounded ? 0 : BOX)

  const W = Math.max(cellsW, quarter ? DOTS_W : 0)
  const pad = cellsH ? DOTS_PAD : 0
  const H = many
    ? BOX + (quarter ? pad + DOTS_H : 0)
    : cellsH + (quarter ? pad + DOTS_H : 0)
  const cellsX = (W - cellsW) / 2

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
      {many ? (
        // The count is HTML, not an SVG label: inside the drawing it renders at
        // about seven pixels, which is not a number anyone can read. Out here it
        // is ordinary page text at ordinary page size.
        <span className="tg-many">
          <span className="tg-count">{halves}×</span>
          <svg viewBox={`0 0 ${BOX} ${H}`} width={BOX} height={H} aria-hidden="true">
            <Cell x={0} y={0} />
            {quarter === 1 && <Therefore cx={BOX / 2} y={BOX + pad + 1.7} />}
          </svg>
        </span>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
          {/* An untimed task still needs somewhere to click, so it keeps a faint
              outline rather than becoming an invisible hit target. */}
          {rounded === 0 && (
            <rect className="tg-ghost" x={cellsX} y="0" width={BOX} height={BOX} rx="1.8" />
          )}

          {shape.flatMap((len, r) =>
            Array.from({ length: len }, (_, c) => (
              <Cell key={`${r}-${c}`} x={cellsX + c * (BOX + GAP)} y={r * (BOX + GAP)} />
            ))
          )}

          {quarter === 1 && <Therefore cx={W / 2} y={cellsH + pad + 1.7} />}
        </svg>
      )}
    </button>
  )
}
