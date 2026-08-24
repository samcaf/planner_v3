import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { chimeDone } from '../lib/chime.js'
import { minutesLabel } from '../lib/dates.js'

/**
 * A running clock for work whose length is fixed rather than estimated — a
 * timed exercise, a brew, a sitting. It appears only on a task marked as
 * fixed-time, because a countdown against a guess is a countdown against
 * nothing.
 *
 * The state lives on the task, not in this component: `timer_started_at` is
 * when the current run began, or null while paused, and `timer_elapsed_ms` is
 * everything banked before it. Elapsed time is therefore computed from the wall
 * clock rather than accumulated by a counter — so it stays true across a
 * refresh, a background tab, and a laptop that was closed for an hour, none of
 * which a tick-based counter survives.
 */
export default function TaskTimer({ task, onChange }) {
  const totalMs = (task.estimate_min || 0) * 60000
  const [, repaint] = useState(0)
  const rang = useRef(false)

  const running = !!task.timer_started_at
  const banked = task.timer_elapsed_ms || 0
  const since = running ? Math.max(0, Date.now() - Date.parse(task.timer_started_at)) : 0
  const elapsed = banked + since
  const left = Math.max(0, totalMs - elapsed)

  // Only to repaint. Every number above is derived from timestamps, so a
  // throttled or missed tick costs nothing but a stale pixel.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => repaint((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [running])

  useEffect(() => {
    if (!running || left > 0 || rang.current || !totalMs) return
    rang.current = true
    chimeDone()
    // Banked at exactly the full length rather than at whatever the tick
    // happened to observe, so a finished timer reads 0:00 and not -0:03.
    onChange({ timer_started_at: null, timer_elapsed_ms: totalMs })
  }, [running, left, totalMs, onChange])

  if (!totalMs) {
    return <span className="tt-none">Give it a length first.</span>
  }

  const start = () => {
    rang.current = false
    onChange({ timer_started_at: new Date().toISOString() })
  }
  const pause = () => onChange({ timer_started_at: null, timer_elapsed_ms: elapsed })
  const reset = () => {
    rang.current = false
    onChange({ timer_started_at: null, timer_elapsed_ms: 0 })
  }

  const mm = Math.floor(left / 60000)
  const ss = Math.floor((left % 60000) / 1000)
  const done = totalMs ? Math.min(1, elapsed / totalMs) : 0

  return (
    <div className={`tt ${running ? 'is-running' : ''} ${left === 0 ? 'is-done' : ''}`}>
      <div className="tt-bar" role="progressbar" aria-valuenow={Math.round(done * 100)}>
        <i style={{ width: `${done * 100}%` }} />
      </div>

      <span className="tt-clock">{mm}:{String(ss).padStart(2, '0')}</span>
      <span className="tt-of muted">of {minutesLabel(task.estimate_min)}</span>

      <button
        className="btn ghost sm"
        title={running ? 'Pause' : 'Start'}
        onClick={running ? pause : start}
      >
        <Icon name={running ? 'pause' : 'play'} size={12} />
      </button>
      <button className="btn ghost sm" title="Reset" onClick={reset} disabled={!elapsed}>
        <Icon name="reset" size={12} />
      </button>
    </div>
  )
}
