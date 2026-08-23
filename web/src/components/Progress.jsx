import { minutesLabel } from '../lib/dates.js'

/** Statuses that count as "no longer on the plate". */
export const CLOSED = ['done', 'dropped', 'moved']

/** Statuses that still want doing. */
export const OPEN = ['todo', 'doing']

/**
 * Time accounting for a set of tasks. Notes carry no time, and optional work is
 * reported separately rather than counted — it is not committed, so a pile of
 * maybes should never make a day read as full.
 */
export function tally(tasks = []) {
  let done = 0
  let total = 0
  let optional = 0
  let doneCount = 0
  let openCount = 0
  let optionalCount = 0

  for (const t of tasks) {
    if (t.kind === 'note') continue
    const mins = t.estimate_min || 0
    if (t.status === 'dropped' || t.status === 'moved') continue
    // Optional work is not committed, so it stays out of the day's totals and
    // is reported separately — otherwise a pile of maybes reads as a full day.
    if (t.optional) { optional += mins; optionalCount++; continue }
    total += mins
    if (t.status === 'done') { done += mins; doneCount++ } else openCount++
  }

  // With no estimates anywhere, minutes say nothing — fall back to counting
  // tasks so a day of untimed work still shows real progress.
  const pct = total
    ? Math.round((done / total) * 100)
    : (doneCount + openCount ? Math.round((doneCount / (doneCount + openCount)) * 100) : 0)

  return { done, total, optional, doneCount, openCount, optionalCount, pct }
}

/**
 * A slim bar plus "30m / 5h" so progress is legible as both a shape and a
 * number. `compact` drops the label for use inside a calendar cell.
 */
export default function Progress({ tasks, color, compact = false, className = '' }) {
  const { done, total, doneCount, openCount, pct } = tally(tasks)
  if (!total && !doneCount && !openCount) return null

  return (
    <div className={`prog ${compact ? 'is-compact' : ''} ${className}`}>
      <div className="prog-bar">
        <i style={{ width: `${pct}%`, background: color ? `var(--${color})` : undefined }} />
      </div>
      {!compact && (
        <span className="prog-label">
          {total > 0 ? `${minutesLabel(done) || '0m'} / ${minutesLabel(total)}` : `${doneCount}/${doneCount + openCount}`}
          <span className="muted"> · {pct}%</span>
        </span>
      )}
    </div>
  )
}
