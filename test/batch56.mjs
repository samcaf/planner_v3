/**
 * The query language, on its own.
 *
 * Parsing is the one part of the MCP server that is pure: no server, no
 * database, no jsdom. Testing it here means a bad query has an exact cause
 * rather than an empty result somewhere downstream.
 */
import { parse, tokenise, today } from '../mcp/query.js'

const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const NOW = new Date('2026-08-29T10:00:00')

const p = (q) => parse(q, NOW).params
const fails = (q) => {
  try { parse(q, NOW); return null } catch (e) { return e.message }
}

try {
  check('quoted runs stay whole',
    tokenise('project:"Planner v3" is:code').join('|') === 'project:Planner v3|is:code',
    tokenise('project:"Planner v3" is:code').join('|'))

  check('bare words are text', p('drag drop bug').q === 'drag drop bug', p('drag drop bug').q)
  check('and default to open tasks', p('drag').status === 'todo,doing', p('drag').status)

  check('is:code sets the flag', p('is:code').is_code === 1)
  check('is:deep sets intensity', p('is:deep').intensity === 'deep')
  check('not:code negates it', p('not:code').is_code === 0)
  check('is:done overrides the default status', p('is:done').status === 'done', p('is:done').status)

  check('date:today is one day', p('date:today').from === '2026-08-29' && p('date:today').to === '2026-08-29',
    JSON.stringify(p('date:today')))
  check('date:tomorrow steps forward', p('date:tomorrow').from === '2026-08-30', p('date:tomorrow').from)
  check('date:week is a week', p('date:week').to === '2026-09-04', p('date:week').to)
  check('date:none is the backlog', p('date:none').backlog === 1, JSON.stringify(p('date:none')))
  check('a span parses', p('date:2026-08-01..2026-08-31').from === '2026-08-01'
    && p('date:2026-08-01..2026-08-31').to === '2026-08-31')
  check('date:overdue is bounded on both sides so the API can take it',
    !!p('date:overdue').from && p('date:overdue').to === '2026-08-28',
    JSON.stringify(p('date:overdue')))

  check('due: goes to its own fields', p('due:today').due_from === '2026-08-29'
    && p('due:today').from === undefined, JSON.stringify(p('due:today')))

  check('status takes a list', p('status:todo,doing').status === 'todo,doing')
  check('priority passes through', p('priority:high').priority === 'high')
  check('order passes through', p('order:-created').order === '-created')
  check('limit passes through', p('limit:5').limit === '5')

  check('project comes back as a name to resolve',
    parse('project:"Planner v3"', NOW).projectName === 'Planner v3',
    parse('project:"Planner v3"', NOW).projectName)
  check('has:comments is handled outside the API',
    parse('has:comments', NOW).hasComments === true)

  const combined = p('is:code date:today project:x order:priority')
  check('terms combine', combined.is_code === 1 && combined.from === '2026-08-29'
    && combined.order === 'priority', JSON.stringify(combined))

  // ── the errors are the point: a wrong query must say what is wrong --------
  check('an unknown field says so', /is not a field/.test(fails('colour:red') || ''), fails('colour:red'))
  check('and lists the real ones', /status/.test(fails('colour:red') || ''), fails('colour:red'))
  check('an unknown flag says so', /is not a flag/.test(fails('is:purple') || ''), fails('is:purple'))
  check('a bad date says so', /is not a date/.test(fails('date:soon') || ''), fails('date:soon'))
  check('an empty value says so', /needs a value/.test(fails('status:') || ''), fails('status:'))
  check('due:none is refused with a hint', /has:due/.test(fails('due:none') || ''), fails('due:none'))
  check('a nonsense negation is refused', /not supported/.test(fails('not:open') || ''), fails('not:open'))

  check('today is local, not UTC',
    today(new Date('2026-08-29T23:30:00')) === new Date('2026-08-29T23:30:00').toLocaleDateString('en-CA'))
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  process.exit(bad ? 1 : 0)
}
