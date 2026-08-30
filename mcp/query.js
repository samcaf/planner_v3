/**
 * The planner's answer to JQL.
 *
 * A written query, because that is what makes Jira's MCP usable: one search
 * tool that can express any question, rather than a tool per question. The
 * grammar is deliberately small — terms separated by spaces, ANDed together,
 * each either `field:value` or bare text that matches the title or the notes.
 *
 *   is:code date:today status:open
 *   project:"Planner v3" priority:high order:-created limit:10
 *   drag date:2026-08-01..2026-08-31 has:notes
 *
 * Values may be quoted, and a comma inside one means OR (`status:todo,doing`).
 * Everything resolves to ordinary query parameters on GET /api/tasks, so the
 * database does the work and this file only has to agree with it.
 */

/** today, in the local timezone — a planner's day is the one on the wall. */
export const today = (now = new Date()) => now.toLocaleDateString('en-CA')

const shift = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA')
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Words, keeping quoted runs whole. */
export function tokenise(input) {
  const out = []
  let cur = ''
  let quote = null
  for (const ch of String(input || '')) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = '' }
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out
}

/**
 * A date word to a from/to pair.
 *
 * `none` is the backlog — a task with no date at all, which is a different
 * thing from a task dated in the past and must not silently become one.
 */
function dateRange(value, now) {
  const v = value.toLowerCase()
  if (v === 'none' || v === 'backlog') return { backlog: true }
  if (v === 'today') return { from: today(now), to: today(now) }
  if (v === 'tomorrow') return { from: shift(today(now), 1), to: shift(today(now), 1) }
  if (v === 'yesterday') return { from: shift(today(now), -1), to: shift(today(now), -1) }
  if (v === 'week') return { from: today(now), to: shift(today(now), 6) }
  if (v === 'overdue') return { to: shift(today(now), -1) }
  const span = v.split('..')
  if (span.length === 2 && span.every((d) => ISO.test(d))) return { from: span[0], to: span[1] }
  if (ISO.test(v)) return { from: v, to: v }
  throw new Error(`"${value}" is not a date. Use today, tomorrow, week, overdue, none, `
    + 'YYYY-MM-DD, or YYYY-MM-DD..YYYY-MM-DD.')
}

const OPEN = 'todo,doing'
const CLOSED = 'done,dropped,moved'

const FLAGS = {
  code: { is_code: 1 },
  // Whose move it is, in a conversation. The three most useful questions an
  // agent can ask of a board it is working: what is mine, what is theirs, what
  // is settled.
  mine: { waiting_on: 'ai' },
  theirs: { waiting_on: 'human' },
  settled: { waiting_on: 'none' },
  deep: { intensity: 'deep' },
  light: { intensity: 'light' },
  optional: { optional: 1 },
  committed: { optional: 0 },
  open: { status: OPEN },
  done: { status: 'done' },
  closed: { status: CLOSED },
  archived: { archived: 1 },
}

/**
 * `is:mine` reads from the agent's side of the table.
 *
 * A task waiting on the AI is the agent's to do — so from a tool server, "mine"
 * is `waiting_on: ai`. Named for the caller rather than the column, because the
 * caller is who has to get it right at three in the morning.
 */
export const FIELDS = [
  'is', 'status', 'priority', 'project', 'section', 'date', 'due', 'has',
  'order', 'limit', 'offset', 'parent', 'text',
]

/**
 * A query to query parameters, plus the bits the API cannot express.
 *
 * `project` and `section` come back as names because the API takes ids: the
 * caller resolves them, which is also where a helpful "no project called that"
 * belongs.
 */
export function parse(input, now = new Date()) {
  const params = {}
  const post = { projectName: null, sectionName: null, hasComments: null }
  const text = []

  for (const token of tokenise(input)) {
    const at = token.indexOf(':')
    if (at <= 0) { text.push(token); continue }

    const field = token.slice(0, at).toLowerCase()
    const value = token.slice(at + 1)
    if (!value) throw new Error(`${field}: needs a value`)

    switch (field) {
      case 'is':
      case 'not': {
        const flag = FLAGS[value.toLowerCase()]
        if (!flag) {
          throw new Error(`"${value}" is not a flag. One of: ${Object.keys(FLAGS).join(', ')}.`)
        }
        if (field === 'is') Object.assign(params, flag)
        else {
          // Only the boolean flags can be negated — "not:open" would have to
          // mean a status set, and saying so plainly beats guessing.
          const [key, val] = Object.entries(flag)[0]
          if (!['is_code', 'optional', 'archived'].includes(key)) {
            throw new Error(`not:${value} is not supported — use status: or is: instead`)
          }
          params[key] = val ? 0 : 1
        }
        break
      }
      case 'status': params.status = value; break
      case 'priority': params.priority = value; break
      case 'project': post.projectName = value; break
      case 'section': post.sectionName = value; break
      case 'parent': params.parent_id = value; break
      case 'date': {
        const range = dateRange(value, now)
        if (range.backlog) params.backlog = 1
        else { if (range.from) params.from = range.from; if (range.to) params.to = range.to }
        // from/to on their own are not a range the API understands; it wants
        // both, or neither.
        if (range.from && !range.to) params.to = '9999-12-31'
        if (range.to && !range.from) params.from = '0000-01-01'
        break
      }
      case 'due': {
        const range = dateRange(value, now)
        if (range.backlog) throw new Error('due:none is not a thing — try has:due')
        if (range.from) params.due_from = range.from
        if (range.to) params.due_to = range.to
        break
      }
      case 'has': {
        const what = value.toLowerCase()
        if (what === 'notes') params.has_notes = 1
        else if (what === 'comments') post.hasComments = true
        else throw new Error(`has:${value} is not supported — has:notes or has:comments`)
        break
      }
      case 'order': params.order = value; break
      case 'limit': params.limit = value; break
      case 'offset': params.offset = value; break
      default:
        throw new Error(`"${field}:" is not a field. One of: ${FIELDS.join(', ')}.`)
    }
  }

  if (text.length) params.q = text.join(' ')
  // Nothing said about status means the open ones, which is what "my tasks"
  // means every time anyone says it.
  if (!params.status && params.archived === undefined) params.status = OPEN
  return { params, ...post }
}
