import { minutesLabel } from '../lib/dates.js'
import '../styles/deep.css'

/** Deep work only: chores cost clock time but none of the scarce resource. */
export function deepTally(tasks = []) {
  let scheduled = 0
  let done = 0
  for (const t of tasks) {
    if (t.kind === 'note' || t.intensity !== 'deep') continue
    // Optional work is uncommitted; it does not draw down the thinking budget
    // any more than it draws down the day's.
    if (t.optional || ['dropped', 'moved'].includes(t.status)) continue
    const mins = t.estimate_min || 0
    scheduled += mins
    if (t.status === 'done') done += mins
  }
  return { scheduled, done }
}

/**
 * A fixed-width gauge for the thinking budget, which behaves differently either
 * side of the target:
 *
 * - Under target, the bar *is* the target. Scheduled deep work fills it faintly
 *   and completed work fills it solidly, so the empty remainder reads as
 *   headroom you still have.
 * - Over target, the bar becomes the day. The target shrinks to its true
 *   proportion of that day and the excess sits behind it at low opacity, so
 *   overcommitment is visible as the target being squeezed rather than as a
 *   number you have to read.
 */
export default function DeepBar({ tasks, target }) {
  const { scheduled, done } = deepTally(tasks)
  if (!target) return null

  const over = scheduled > target
  const span = over ? scheduled : target

  const pct = (mins) => `${Math.min(100, Math.round((mins / span) * 100))}%`

  return (
    <div className={`deepbar ${over ? 'is-over' : ''}`}>
      <div className="deepbar-track" title={
        over
          ? `${minutesLabel(scheduled)} of deep work scheduled against a ${minutesLabel(target)} target — `
            + `${minutesLabel(scheduled - target)} over`
          : `${minutesLabel(done) || '0m'} done of ${minutesLabel(scheduled) || '0m'} scheduled, `
            + `${minutesLabel(target)} target`
      }>
        {/* Over target this marks where the target ends; under it, it is the
            faint fill showing what is already committed. */}
        <i className="deepbar-scheduled" style={{ width: over ? pct(target) : pct(scheduled) }} />
        <i className="deepbar-done" style={{ width: pct(done) }} />
      </div>
      <span className="deepbar-label">
        {minutesLabel(done) || '0m'} / {minutesLabel(scheduled) || '0m'} deep
        {over && <span className="deepbar-over"> · {minutesLabel(scheduled - target)} over</span>}
        <span className="spacer" />
        <span className="deepbar-target">target {minutesLabel(target)}</span>
      </span>
    </div>
  )
}
