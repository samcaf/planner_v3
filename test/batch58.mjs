/**
 * The switch model, on its own.
 *
 * Four layers — task, section, your settings, built-in — each storing only
 * what it differs from the one below. That is easy to get subtly wrong and
 * hard to see wrong: a chip for a value nobody set, a section default that
 * stops applying the moment a task is touched, or a second click that drops
 * the first. Pure functions, so they are checked without a server or a browser.
 */
import {
  ALL, BUILT_IN, DECLARED, ENFORCED, clean, isDeclared, notable, read, resolve,
  setSwitch, sources, stack,
} from '../web/src/lib/aiSwitches.js'

const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])

try {
  // ── the shape of the table ───────────────────────────────────────────────
  check('every switch has a fallback among its own values',
    ALL.every((s) => s.values.includes(s.fallback)),
    ALL.filter((s) => !s.values.includes(s.fallback)).map((s) => s.key).join(','))
  check('no key appears twice', new Set(ALL.map((s) => s.key)).size === ALL.length)
  check('enforced and declared are disjoint',
    !ENFORCED.some((e) => DECLARED.some((d) => d.key === e.key)))
  check('model and effort are declared, not enforced',
    isDeclared('model') && isDeclared('effort') && !isDeclared('budget'))

  check('every option says what it means',
    ALL.every((s) => s.values.every((v) => typeof s.about?.[v] === 'string' && s.about[v].length > 8)),
    ALL.filter((s) => !s.values.every((v) => s.about?.[v])).map((s) => s.key).join(','))
  check('and every switch says what it is',
    ALL.every((s) => typeof s.hint === 'string' && s.hint.length > 12))
  check('depth and budget explain themselves at length',
    ALL.find((s) => s.key === 'depth').hint.length > 80
      && ALL.find((s) => s.key === 'budget').hint.length > 80)

  // ── the defaults asked for ───────────────────────────────────────────────
  check('mode defaults to ask', BUILT_IN.mode === 'ask', BUILT_IN.mode)
  check('follow-ups to always', BUILT_IN.followups === 'always', BUILT_IN.followups)
  check('on finishing to stop', BUILT_IN.on_done === 'stop', BUILT_IN.on_done)
  check('sign-off to required', BUILT_IN.sign_off === 'required', BUILT_IN.sign_off)
  check('verify to test', BUILT_IN.verify === 'test', BUILT_IN.verify)
  check('and the rest are unchanged',
    BUILT_IN.detail === 'normal' && BUILT_IN.depth === '2' && BUILT_IN.budget === '12'
      && BUILT_IN.model === 'inherit' && BUILT_IN.effort === 'inherit' && BUILT_IN.tokens === 'none',
    JSON.stringify(BUILT_IN))
  check('the largest token ceiling is 1M',
    ALL.find((s) => s.key === 'tokens').values.includes('1M')
      && !ALL.find((s) => s.key === 'tokens').values.includes('1m'),
    ALL.find((s) => s.key === 'tokens').values.join(','))

  // ── reading ──────────────────────────────────────────────────────────────
  check('nothing stored is no settings', Object.keys(read('')).length === 0)
  check('rubbish stored is no settings', Object.keys(read('{oops')).length === 0)
  check('an array is not settings', Object.keys(read('[1,2]')).length === 0)
  check('an unknown key is dropped', clean({ nonsense: 'x', mode: 'build' }).nonsense === undefined)
  check('an impossible value is dropped', clean({ mode: 'sideways' }).mode === undefined,
    JSON.stringify(clean({ mode: 'sideways' })))

  // ── four layers ──────────────────────────────────────────────────────────
  const defaults = JSON.stringify({ mode: 'build', verify: 'reproduce' })
  const section = { ai_switches: JSON.stringify({ budget: '20' }) }
  const bare = {}
  const own = { ai_switches: JSON.stringify({ mode: 'plan' }) }

  check('with nothing set the built-ins apply', resolve(bare, {}, '').mode === 'ask')
  check('your settings sit under everything', resolve(bare, {}, defaults).mode === 'build',
    resolve(bare, {}, defaults).mode)
  check('a section overrides your settings', resolve(bare, section, defaults).budget === '20')
  check('and inherits what it does not set', resolve(bare, section, defaults).verify === 'reproduce')
  check('a task overrides the section', resolve(own, section, defaults).mode === 'plan',
    resolve(own, section, defaults).mode)
  check('without disturbing the rest',
    resolve(own, section, defaults).budget === '20'
      && resolve(own, section, defaults).verify === 'reproduce')

  const where = sources(own, section, defaults)
  check('each value knows which layer it came from',
    where.mode === 'task' && where.budget === 'section' && where.verify === 'settings'
      && where.depth === 'default',
    JSON.stringify(where))

  // ── what a row shows ─────────────────────────────────────────────────────
  const belowTask = stack(defaults, section.ai_switches)
  check('a task that sets nothing shows nothing', notable('', belowTask).length === 0)
  check('a task shows only what it differs from ITS conversation on',
    notable(own.ai_switches, belowTask).map((s) => s.key).join(',') === 'mode',
    notable(own.ai_switches, belowTask).map((s) => s.key).join(','))
  check('a task agreeing with the section shows no chip',
    notable(JSON.stringify({ budget: '20' }), belowTask).length === 0,
    JSON.stringify(notable(JSON.stringify({ budget: '20' }), belowTask)))

  // ── setting, one layer at a time ─────────────────────────────────────────
  const set1 = setSwitch('', belowTask, 'depth', '4')
  check('setting a switch stores it', read(set1).depth === '4', set1)

  const same = setSwitch('', belowTask, 'mode', 'build')
  check('setting it to what it inherits stores nothing', same === '', same)

  const cleared = setSwitch(own.ai_switches, belowTask, 'mode', 'build')
  check('overriding back to the inherited value drops the override', cleared === '', cleared)
  check('so the layer below applies again', stack(belowTask, cleared).mode === 'build')

  // The bug: two clicks in a row, each computed from what the last one wrote
  // rather than from the row as it was before either.
  let v = ''
  v = setSwitch(v, belowTask, 'verify', 'none')
  v = setSwitch(v, belowTask, 'depth', '0')
  v = setSwitch(v, belowTask, 'sign_off', 'none')
  check('three switches in a row all stick',
    read(v).verify === 'none' && read(v).depth === '0' && read(v).sign_off === 'none',
    v)
  check('and none of them invented a fourth', Object.keys(read(v)).length === 3, v)

  const dropOne = setSwitch(v, belowTask, 'depth', '2')
  check('dropping one back to inherited keeps the others',
    read(dropOne).verify === 'none' && read(dropOne).sign_off === 'none'
      && read(dropOne).depth === undefined,
    dropOne)
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
