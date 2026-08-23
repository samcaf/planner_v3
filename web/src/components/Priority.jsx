import Icon from './Icon.jsx'
import Popover from './Popover.jsx'
import '../styles/priority.css'

/** Lowest first — the picker reads left-to-right, least urgent to most. */
export const PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest']

const ICONS = {
  lowest: 'priLowest',
  low: 'priLow',
  medium: 'priMedium',
  high: 'priHigh',
  highest: 'priHighest',
}

/** Anything the DB doesn't know about sits with medium, as the sorts do. */
const known = (level) => (ICONS[level] ? level : 'medium')

export function PriorityIcon({ level, size = 13 }) {
  const lvl = known(level)
  // Thicker than the default stroke: at 13px the arrowheads need the weight to
  // stay distinct from the two horizontal bars.
  return <Icon name={ICONS[lvl]} size={size} strokeWidth={2.4} className={`pri-ico pri-ico-${lvl}`} />
}

/** The icon plus its label. With `onChange` it opens a picker; without, it is text. */
export function PriorityChip({ level, onChange }) {
  const lvl = known(level)
  const face = <><PriorityIcon level={lvl} /><span>{lvl}</span></>

  if (!onChange) return <span className="pri-chip">{face}</span>

  return (
    <Popover
      label="Priority"
      role="menu"
      className="menu"
      width={164}
      trigger={(p) => (
        <button {...p} className="pri-chip" title={`Priority: ${lvl} — click to change`}>
          {face}
        </button>
      )}
    >
      {(close) => PRIORITIES.map((p) => (
        <button
          key={p}
          className="menu-item pri-opt"
          role="menuitemradio"
          aria-checked={p === lvl}
          onClick={() => { onChange(p); close() }}
        >
          <PriorityIcon level={p} />
          <span>{p}</span>
        </button>
      ))}
    </Popover>
  )
}
