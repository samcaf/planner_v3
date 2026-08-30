import { useRef } from 'react'
import Icon from './Icon.jsx'
import Popover from './Popover.jsx'
import { DECLARED, ENFORCED, notable, read, setSwitch, stack } from '../lib/aiSwitches.js'

/**
 * The terms an AI task is worked under, in place of its duration.
 *
 * Edits ONE layer — a task, a section, or your defaults in settings — against
 * whatever it would inherit if it set nothing. Only what differs from that is
 * shown, so a task in a conversation that already works in build mode shows no
 * chip for it, and most rows show only the button.
 *
 * The two classes are kept visibly apart. An enforced switch is refused by the
 * server; a declared one is a message to whoever runs the agent, which nothing
 * on this side can make true. Drawing them the same way would be a lie about
 * which of them bite.
 */
export default function AiSwitches({
  value, inherited, onChange, label = 'How the AI should work this',
}) {
  // What we last wrote, held until the server actually reports it back.
  //
  // Setting a switch patches the task and waits for the day to be refetched. A
  // second click before that landed used to be computed from the row as it was
  // BEFORE the first, so it wrote a blob containing only the second switch and
  // the first silently reverted — which is what "the others reset" was.
  //
  // Held until CONFIRMED, not merely until the prop changes: a refetch that
  // was already in flight arrives carrying the old value, and dropping our
  // copy on that would put the same stale row back under the next click.
  const pending = useRef(null)
  if (pending.current !== null && value === pending.current) pending.current = null
  const raw = pending.current ?? value

  // Writes are chained rather than fired in parallel. Each carries the whole
  // blob, so three in flight at once are three racing last-writers and the one
  // that happens to land last wins — which for the earliest of them means
  // undoing the two after it.
  const chain = useRef(Promise.resolve())

  const applied = stack(inherited, raw)
  const own = read(raw)
  const shown = notable(raw, inherited)

  const set = (key, next) => {
    // Read at click time, not from `raw` above. Three clicks in one render all
    // share that render's closure, so computing from it means all three start
    // from the same value and only the last survives — which is the bug this
    // ref exists to fix, reintroduced one line lower down.
    const written = setSwitch(pending.current ?? value, inherited, key, next)
    pending.current = written
    chain.current = chain.current
      .then(() => onChange(written))
      // A failed write must not wedge the chain shut for every later one.
      .catch(() => {})
  }

  const group = (list) => list.map((s) => (
    <div key={s.key} className="ais-row">
      <span className="ais-name" title={s.hint}>{s.label}</span>
      <div className="ais-opts">
        {s.values.map((v) => (
          <button
            key={v}
            className={`btn ghost sm ${applied[s.key] === v ? 'is-on' : ''}`}
            role="menuitemradio"
            aria-checked={applied[s.key] === v}
            title={[
              s.about?.[v],
              own[s.key] === undefined && applied[s.key] === v ? '(inherited)' : null,
            ].filter(Boolean).join(' ')}
            // The panel stays open: you are usually setting two or three of
            // these at once, and closing after each would make that four round
            // trips through the same button.
            onClick={() => set(s.key, v)}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  ))

  return (
    <div className="ai-switches">
      {shown.map((s) => (
        <span
          key={s.key}
          className="chip ais-chip"
          title={`${s.label}: ${s.value}\n${s.about?.[s.value] || s.hint}`}
        >
          {s.key === 'budget' || s.key === 'depth' ? `${s.label.toLowerCase()} ${s.value}` : s.value}
        </span>
      ))}

      <Popover
        label={label}
        role="menu"
        className="menu ais-menu"
        width={360}
        trigger={(p) => (
          <button {...p} className="chip ais-open" title={label}>
            <Icon name="gear" size={11} />
            {shown.length ? '' : 'terms'}
          </button>
        )}
      >
        {() => (
          <>
            <p className="ais-head">Enforced — the planner refuses past these</p>
            {group(ENFORCED)}
            <p className="ais-head ais-head-soft">
              Declared — honoured by whatever runs the agent
            </p>
            {group(DECLARED)}
            <p className="ais-foot">
              Hover any option for what it means. Blank means inherited — from the
              conversation, or from your defaults in Settings.
            </p>
          </>
        )}
      </Popover>
    </div>
  )
}
