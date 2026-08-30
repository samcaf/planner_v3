/**
 * The switch model, on its own.
 *
 * Inheritance is the part that is easy to get subtly wrong and hard to see
 * wrong: a task showing a chip for a value it did not actually override, or a
 * section default that stops applying the moment a task is touched. Pure
 * functions, so they are checked without a server or a browser.
 */
import {
  ALL, DECLARED, ENFORCED, isDeclared, notable, read, resolve, sources, withSwitch,
} from '../web/src/lib/aiSwitches.js'

const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])

try {
  check('every switch has a fallback among its own values',
    ALL.every((s) => s.values.includes(s.fallback)),
    ALL.filter((s) => !s.values.includes(s.fallback)).map((s) => s.key).join(','))
  check('no key appears twice',
    new Set(ALL.map((s) => s.key)).size === ALL.length)
  check('enforced and declared are disjoint',
    !ENFORCED.some((e) => DECLARED.some((d) => d.key === e.key)))
  check('model and effort are declared, not enforced',
    isDeclared('model') && isDeclared('effort') && !isDeclared('budget'))

  // ── reading ──────────────────────────────────────────────────────────────
  check('nothing stored is no settings', Object.keys(read('')).length === 0)
  check('rubbish stored is no settings', Object.keys(read('{oops')).length === 0)
  check('an array is not settings', Object.keys(read('[1,2]')).length === 0)

  // ── inheritance ──────────────────────────────────────────────────────────
  const section = { ai_switches: JSON.stringify({ mode: 'build', budget: '20' }) }
  const bare = {}
  const own = { ai_switches: JSON.stringify({ mode: 'ask' }) }

  check('a bare task takes the built-in', resolve(bare, {}).mode === 'plan', resolve(bare, {}).mode)
  check('a section default applies', resolve(bare, section).mode === 'build',
    resolve(bare, section).mode)
  check('and carries through to the others', resolve(bare, section).budget === '20')
  check('a task overrides its section', resolve(own, section).mode === 'ask',
    resolve(own, section).mode)
  check('without disturbing the rest', resolve(own, section).budget === '20',
    resolve(own, section).budget)

  const where = sources(own, section)
  check('the source of each value is known',
    where.mode === 'task' && where.budget === 'section' && where.verify === 'default',
    JSON.stringify({ m: where.mode, b: where.budget, v: where.verify }))

  // ── what a row shows ─────────────────────────────────────────────────────
  check('a task on every default shows nothing', notable(bare, {}).length === 0,
    JSON.stringify(notable(bare, {})))
  const shown = notable(own, section).map((s) => s.key)
  check('a row shows only what differs from the built-ins',
    shown.includes('mode') && shown.includes('budget') && !shown.includes('verify'),
    shown.join(','))

  // ── setting ──────────────────────────────────────────────────────────────
  const set = withSwitch(bare, section, 'verify', 'reproduce')
  check('setting a switch stores it', read(set).verify === 'reproduce', set)

  const same = withSwitch(bare, section, 'mode', 'build')
  check('setting a switch to what it already inherits stores nothing',
    read(same).mode === undefined, same)
  check('and leaves no empty blob behind', same === '', JSON.stringify(same))

  const cleared = withSwitch(own, section, 'mode', 'build')
  check('overriding back to the inherited value drops the override',
    read(cleared).mode === undefined, cleared)
  check('so the section default applies again',
    resolve({ ai_switches: cleared }, section).mode === 'build',
    resolve({ ai_switches: cleared }, section).mode)

  const kept = withSwitch({ ai_switches: JSON.stringify({ mode: 'ask', verify: 'none' }) },
    section, 'mode', 'build')
  check('dropping one override keeps the others', read(kept).verify === 'none', kept)
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
