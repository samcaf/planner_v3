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

/**
 * The many ways of naming a day, for `:day`.
 *
 * Typing a date should not mean remembering which order this app wants it in.
 * Everything here resolves against TODAY rather than against whatever day you
 * happen to be looking at: `0` means today, `+3` means three days from now, and
 * a bare `14` means the fourteenth of this month — all of which would drift
 * under you if they counted from the page instead.
 *
 *   2026-09-01   09/01/2026   09-01-2026   9/1        the date itself
 *   14           the 14th of this month
 *   0  +0  -0    today
 *   +3  -2       days from today
 *   today  tomorrow  yesterday
 *
 * Returns null for anything it does not recognise, so the caller can say what
 * it could not read rather than navigating somewhere arbitrary.
 */
export function parseDay(text, from = today()) {
  const s = String(text || '').trim().toLowerCase()
  if (!s) return null

  if (s === 'today' || s === 'now') return from
  if (s === 'tomorrow' || s === 'tom') return addDays(from, 1)
  if (s === 'yesterday' || s === 'yest') return addDays(from, -1)

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  // Signed, or a bare zero: an offset in days. A bare zero cannot be a day of
  // the month, so it is unambiguous — and it is the shortest way to say today.
  if (/^[+-]\d+$/.test(s) || s === '0') return addDays(from, Number(s))

  // mm/dd/yyyy and mm-dd-yyyy, and the same without the year.
  const parts = s.split(/[/-]/)
  if (parts.length >= 2 && parts.every((p) => /^\d+$/.test(p))) {
    const base = parse(from)
    const [m, d, y] = parts.map(Number)
    const year = parts.length >= 3 ? (y < 100 ? 2000 + y : y) : base.getFullYear()
    if (m < 1 || m > 12 || d < 1 || d > 31) return null
    const made = new Date(year, m - 1, d)
    // A day the month does not have rolls over into the next one, which is not
    // what "the 31st of February" meant.
    return made.getMonth() === m - 1 && made.getDate() === d ? iso(made) : null
  }

  // A bare day of the month, in the month you are in.
  if (/^\d{1,2}$/.test(s)) {
    const base = parse(from)
    const d = Number(s)
    const made = new Date(base.getFullYear(), base.getMonth(), d)
    return made.getMonth() === base.getMonth() ? iso(made) : null
  }

  return null
}
