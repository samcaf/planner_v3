import Icon from './Icon.jsx'
import Popover from './Popover.jsx'
import { CLOSED } from './Progress.jsx'
import { addDays, startOfWeek, today } from '../lib/dates.js'
// The chip and popover rules live with the view that grew them; importing them
// here is what lets a second page mount this without knowing that.
import '../styles/alltasks.css'

/* Highest first, so the chip row reads like the scale it represents. */
const PRIORITIES = [
  ['highest', 'Highest'],
  ['high', 'High'],
  ['medium', 'Medium'],
  ['low', 'Low'],
  ['lowest', 'Lowest'],
]

const STATUSES = [
  ['todo', 'To do'],
  ['doing', 'In progress'],
  ['done', 'Done'],
  ['moved', 'Moved'],
  ['dropped', 'Dropped'],
]

const TIMES = [
  ['est', 'Has estimate'],
  ['no-est', 'No estimate'],
  ['over-1h', 'Over 1h'],
  ['under-30m', 'Under 30m'],
]

const DUES = [
  ['week', 'This week'],
  ['overdue', 'Overdue'],
  ['none', 'No due date'],
]

const DATES = [
  ['scheduled', 'Scheduled'],
  ['unscheduled', 'Unscheduled'],
]

const OPTIONS = { priority: PRIORITIES, status: STATUSES, time: TIMES, due: DUES, date: DATES }

export const GROUP_LABELS = {
  priority: 'Priority', status: 'Status', time: 'Time', due: 'Due', date: 'Date',
}

/** Every group, in the order they read in the popover. */
export const ALL_GROUPS = ['priority', 'status', 'time', 'due', 'date']

const LABELS = Object.fromEntries(
  Object.entries(OPTIONS).map(([group, options]) => [group, Object.fromEntries(options)])
)

/**
 * The filter state is `{ group: [keys] }`, and which keys it holds is also what
 * decides which groups a page shows — a page that omits `date` simply never
 * asks for it.
 */
export function emptyFilters(groups = ALL_GROUPS) {
  return Object.fromEntries(groups.map((g) => [g, []]))
}

export function toggleFilter(filters, group, key) {
  const on = filters[group] || []
  return { ...filters, [group]: on.includes(key) ? on.filter((k) => k !== key) : [...on, key] }
}

/** Rows written before the five-point scale still carry the old middle value. */
const priorityOf = (task) => (task.priority === 'normal' ? 'medium' : task.priority || 'medium')

const TIME_TESTS = {
  est: (t) => !!t.estimate_min,
  'no-est': (t) => !t.estimate_min,
  'over-1h': (t) => (t.estimate_min || 0) > 60,
  'under-30m': (t) => !!t.estimate_min && t.estimate_min < 30,
}

const DATE_TESTS = {
  scheduled: (t) => !!t.scheduled_date,
  unscheduled: (t) => !t.scheduled_date,
}

/** Due tests need "now", which is a render-time value rather than a constant. */
function dueTests() {
  const now = today()
  const from = startOfWeek(now)
  const to = addDays(from, 6)
  return {
    week: (t) => !!t.due_date && t.due_date >= from && t.due_date <= to,
    overdue: (t) => !!t.due_date && t.due_date < now && !CLOSED.includes(t.status),
    none: (t) => !t.due_date,
  }
}

/**
 * Build the predicate once per render: the due tests close over today's date,
 * and an absent group means "no opinion". Filters AND across groups and OR
 * inside one.
 */
export function taskFilter(filters) {
  const due = dueTests()
  return (t) => {
    if (filters.priority?.length && !filters.priority.includes(priorityOf(t))) return false
    if (filters.status?.length && !filters.status.includes(t.status)) return false
    if (filters.time?.length && !filters.time.some((k) => TIME_TESTS[k](t))) return false
    if (filters.due?.length && !filters.due.some((k) => due[k](t))) return false
    if (filters.date?.length && !filters.date.some((k) => DATE_TESTS[k](t))) return false
    return true
  }
}

/** Every live chip-filter, flattened into `{ group, key, scope, label }`. */
export function filterChips(filters) {
  const chips = []
  for (const group of Object.keys(filters)) {
    for (const key of filters[group]) {
      chips.push({ group, key, scope: GROUP_LABELS[group].toLowerCase(), label: LABELS[group][key] })
    }
  }
  return chips
}

export function Chip({ on, onClick, children, title }) {
  return (
    <button
      type="button"
      className={`at-chip ${on ? 'is-on' : ''}`}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function ChipGroup({ label, children }) {
  return (
    <div className="at-group">
      <span className="at-group-h">{label}</span>
      <div className="at-chips">{children}</div>
    </div>
  )
}

/** The removable-chip row that says what is currently narrowing the list. */
export function ActiveChips({ chips, onRemove, onClear }) {
  if (chips.length === 0) return null
  return (
    <div className="at-active">
      {chips.map((chip) => (
        <button
          key={`${chip.group}:${chip.key}`}
          className="at-chip is-on at-removable"
          title={`Remove the ${chip.scope} filter`}
          onClick={() => onRemove(chip)}
        >
          <span className="at-chip-scope">{chip.scope}</span>
          {chip.label}
          <Icon name="x" size={11} />
        </button>
      ))}
      <button className="btn ghost sm" onClick={onClear}>Clear all</button>
    </div>
  )
}

/**
 * Grouped chip toggles behind one button. `count` is the caller's, not ours:
 * a page usually has filters of its own — a search box, a project picker —
 * that belong in the same badge.
 */
export default function TaskFilter({ filters, count = 0, onToggle, onClear, extras, note }) {
  return (
    // Popover rather than a panel positioned by this component: it portals to
    // <body> and measures itself against the viewport. The hand-rolled version
    // was anchored to the trigger's RIGHT edge, which suits the all-tasks
    // toolbar — the button sits far right there — but on the projects page the
    // same button sits near the left, so 420px of panel opened leftward and
    // went under the sidebar. Anchoring left and clamping to the viewport is
    // right in both places, and drops the overflow clipping as well.
    <Popover
      className="panel at-pop"
      role="dialog"
      label="Filters"
      width="min(420px, calc(100vw - 40px))"
      trigger={(props) => (
        <button className={`btn sm ${count ? 'is-on' : ''}`} {...props}>
          <Icon name="list" size={13} /> Filters
          {count > 0 && <span className="at-count">{count}</span>}
          <Icon name="chevronDown" size={12} />
        </button>
      )}
    >
      {ALL_GROUPS.filter((g) => filters[g]).map((g) => (
        <ChipGroup key={g} label={GROUP_LABELS[g]}>
          {OPTIONS[g].map(([value, label]) => (
            <Chip key={value} on={filters[g].includes(value)} onClick={() => onToggle(g, value)}>
              {label}
            </Chip>
          ))}
        </ChipGroup>
      ))}

      {extras}

      <div className="at-pop-f">
        <span className="muted at-note">{note}</span>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={onClear}>Clear all</button>
      </div>
    </Popover>
  )
}
