/**
 * All dates are handled as local-time YYYY-MM-DD strings. Constructing them
 * with `new Date('YYYY-MM-DD')` would parse as UTC and shift the day for
 * anyone west of Greenwich, so every conversion goes through `parse`.
 */

const pad = (n) => String(n).padStart(2, '0')

export function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parse(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function today() {
  return iso(new Date())
}

export function addDays(s, n) {
  const d = parse(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}

export function addMonths(s, n) {
  const d = parse(s)
  d.setMonth(d.getMonth() + n)
  return iso(d)
}

/** Monday-based week start. */
export function startOfWeek(s) {
  const d = parse(s)
  const shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift)
  return iso(d)
}

export function weekDays(s) {
  const start = startOfWeek(s)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** Six-week grid covering the month containing `s`, Monday-first. */
export function monthGrid(s) {
  const d = parse(s)
  const first = iso(new Date(d.getFullYear(), d.getMonth(), 1))
  const start = startOfWeek(first)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const LONG_DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']

export function longDate(s) {
  const d = parse(s)
  return `${LONG_DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function monthLabel(s) {
  const d = parse(s)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export function shortDate(s) {
  if (!s) return ''
  const d = parse(s)
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
}

export function dayNum(s) {
  return parse(s).getDate()
}

export function isSameMonth(a, b) {
  return parse(a).getMonth() === parse(b).getMonth()
}

/** "in 3 days" / "2 days ago" / "today" — for deadlines and last-touch. */
export function relative(s) {
  if (!s) return ''
  const diff = Math.round((parse(s) - parse(today())) / 86400000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  if (diff > 0) return `in ${diff} days`
  return `${-diff} days ago`
}

export function minutesLabel(total) {
  if (!total) return ''
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`
}
