import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import Pomegranate from './Pomegranate.jsx'
import { chimeBreak, chimeDone } from '../lib/chime.js'
import { useApi } from '../lib/api.js'

/**
 * The pomodoro, living in the rail between Settings and the mark.
 *
 * The clock is kept as an END TIME rather than as a number counted down. A
 * counter that ticks only survives while the tab is awake — browsers throttle
 * background timers hard, and a phase would finish minutes late or not at all.
 * An end time is simply a fact about the world, so the tick is only there to
 * repaint; the arithmetic is done against the wall clock every time.
 *
 * The whole thing is mirrored to localStorage for the same reason: a timer that
 * forgets itself when you open another view is not a timer.
 */

const KEY = 'pomodoro'

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}

const FALLBACK = { work: 30, short: 5, long: 20, before_long: 4 }

/** Minutes for each phase, from settings, with sane numbers if unset. */
function lengths(settings) {
  const n = (k, d) => {
    const v = Number(settings?.[`pomodoro_${k}`])
    return Number.isFinite(v) && v > 0 ? v : d
  }
  return {
    work: n('work', FALLBACK.work),
    short: n('short', FALLBACK.short),
    long: n('long', FALLBACK.long),
    beforeLong: Math.max(1, n('before_long', FALLBACK.before_long)),
  }
}

export default function Pomodoro() {
  const settings = useApi('/settings')
  const len = lengths(settings.data)

  // phase: 'work' | 'short' | 'long'. `endsAt` is a timestamp while running and
  // null while paused; `left` holds what remains when paused.
  const [s, setS] = useState(() => read() || {
    phase: 'work', endsAt: null, left: FALLBACK.work * 60000, done: 0,
  })
  const [, tick] = useState(0)
  const rang = useRef(false)

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(s)) }, [s])

  const total = (phase) => (phase === 'work' ? len.work : phase === 'short' ? len.short : len.long) * 60000

  const remaining = s.endsAt ? Math.max(0, s.endsAt - Date.now()) : s.left

  /** What comes after this phase, and how many work blocks will have been done. */
  const next = useCallback((from, done) => {
    if (from !== 'work') return { phase: 'work', done }
    const finished = done + 1
    return { phase: finished % len.beforeLong === 0 ? 'long' : 'short', done: finished }
  }, [len.beforeLong])

  /**
   * The inverse of `next`. A break came after the work that earned it, so going
   * back from one lands on that work with the count not yet banked; going back
   * from work lands on the break before it, if there was one.
   */
  const back = useCallback((from, done) => {
    if (from !== 'work') return { phase: 'work', done: Math.max(0, done - 1) }
    if (done <= 0) return { phase: 'work', done: 0 }
    return { phase: done % len.beforeLong === 0 ? 'long' : 'short', done }
  }, [len.beforeLong])

  const goTo = useCallback((phase, done, run) => {
    rang.current = false
    const ms = (phase === 'work' ? len.work : phase === 'short' ? len.short : len.long) * 60000
    setS({ phase, done, left: ms, endsAt: run ? Date.now() + ms : null })
  }, [len])

  // One interval while running, purely to repaint. Everything real is derived
  // from the end time, so a throttled or missed tick changes nothing.
  useEffect(() => {
    if (!s.endsAt) return
    const id = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [s.endsAt])

  // Ringing is a side effect of arriving at zero, guarded so a repaint cannot
  // sound it twice.
  useEffect(() => {
    if (!s.endsAt || remaining > 0 || rang.current) return
    rang.current = true
    const after = next(s.phase, s.done)
    if (s.phase === 'work') chimeDone()
    else chimeBreak()
    goTo(after.phase, after.done, false)
  }, [s, remaining, next, goTo])

  const running = !!s.endsAt
  const elapsed = total(s.phase) - remaining
  // A second of slack: a phase that has only just been set up should still
  // count as untouched, so the first press of rewind steps back a round.
  const started = elapsed > 1000
  const progress = total(s.phase) ? elapsed / total(s.phase) : 0

  const mm = Math.floor(remaining / 60000)
  const ss = Math.floor((remaining % 60000) / 1000)
  const clock = `${mm}:${String(ss).padStart(2, '0')}`

  const label = s.phase === 'work' ? 'Work' : s.phase === 'short' ? 'Break' : 'Long break'

  const toggle = () => {
    if (running) setS({ ...s, endsAt: null, left: remaining })
    else setS({ ...s, endsAt: Date.now() + (s.left || total(s.phase)) })
  }

  return (
    <div className={`pomo ${running ? 'is-running' : ''} phase-${s.phase}`}>
      <button
        className="pomo-face"
        title={`${label} — ${clock} left. Click to ${running ? 'pause' : 'start'}.`}
        onClick={toggle}
      >
        <Pomegranate progress={progress} />
      </button>

      {/* Under the fruit and in its colour, only brighter: the clock is what
          the fruit is counting, so the two read as one object rather than as a
          picture with a number beside it. */}
      <span className="pomo-clock">{clock}</span>

      <div className="pomo-keys">
        {/* Rewind, as a music player does it: part-way through, it takes you
            back to the start of this stretch; already at the start, it steps
            back to the one before. So pressing it repeatedly walks you back to
            the first round rather than sticking on a phase you have already
            rewound. */}
        <button
          className="btn ghost"
          title={started ? 'Back to the start of this stretch' : 'Back one round'}
          onClick={() => {
            if (started) { goTo(s.phase, s.done, false); return }
            const b = back(s.phase, s.done)
            goTo(b.phase, b.done, false)
          }}
        >
          <Icon name="rewind" size={16} />
        </button>

        {/* Named so the keyboard can find it. Matching on the title would mean
            matching a string that changes with the state it is reporting. */}
        <button
          className="btn ghost"
          data-pomo="toggle"
          title={running ? 'Pause' : 'Start'}
          onClick={toggle}
        >
          <Icon name={running ? 'pause' : 'play'} size={16} />
        </button>
        <button
          className="btn ghost"
          title="Skip to the next phase"
          onClick={() => { const a = next(s.phase, s.done); goTo(a.phase, a.done, false) }}
        >
          <Icon name="skip" size={16} />
        </button>
      </div>

      {/* Under the controls, in the same colour the fruit is wearing, so which
          kind of stretch you are in is legible without reading it. */}
      <span className="pomo-phase">
        {label}
        {s.done > 0 && <span className="pomo-count"> · {s.done}</span>}
      </span>
    </div>
  )
}
