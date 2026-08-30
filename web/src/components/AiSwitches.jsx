import Icon from './Icon.jsx'
import Popover from './Popover.jsx'
import {
  DECLARED, ENFORCED, notable, resolve, sources, withSwitch,
} from '../lib/aiSwitches.js'

/**
 * The terms an AI task is worked under, in place of its duration.
 *
 * A row shows only what is unusual about it. Eleven switches on every task
 * would bury the title, and for most tasks the section's terms are the right
 * ones — so most rows show a single button and nothing else.
 *
 * The two classes are kept visibly apart. An enforced switch is refused by the
 * server; a declared one is a message to whoever runs the agent, which nothing
 * on this side can make true. Drawing them the same way would be a lie about
 * which of them bite.
 */
export default function AiSwitches({ task, section, onChange }) {
  const applied = resolve(task, section)
  const from = sources(task, section)
  const shown = notable(task, section)

  const set = (key, value) => onChange({ ai_switches: withSwitch(task, section, key, value) })

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
            title={from[s.key] === 'section' && applied[s.key] === v
              ? 'From the section'
              : undefined}
            // The panel stays open: you are usually setting two or three of
            // these at once, and closing after each would make that four
            // round trips through the same button.
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
          className={`chip ais-chip ${from[s.key] === 'section' ? 'is-inherited' : ''}`}
          title={`${s.label}: ${s.value}${from[s.key] === 'section' ? ' — from the section' : ''}`}
        >
          {s.key === 'budget' || s.key === 'depth' ? `${s.label.toLowerCase()} ${s.value}` : s.value}
        </span>
      ))}

      <Popover
        label="How the AI should work this"
        role="menu"
        className="menu ais-menu"
        width={330}
        trigger={(p) => (
          <button {...p} className="chip ais-open" title="How the AI should work this">
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
          </>
        )}
      </Popover>
    </div>
  )
}
