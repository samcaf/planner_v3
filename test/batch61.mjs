/** AI defaults in Settings sit under every conversation and task. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-04-06'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
const made = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const was = await json('/api/settings')
  const restore = was.ai_switch_defaults ?? null

  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e).slice(0, 140)))
  const dom = await JSDOM.fromURL(`${BASE}/settings`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
    },
  })
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3000)

  const panelOf = (title) => [...document.querySelectorAll('.panel')]
    .find((p) => p.textContent.startsWith(title))
  const defaults = panelOf('AI defaults')
  check('Settings has an AI defaults panel', !!defaults,
    [...document.querySelectorAll('.panel')].map((p) => p.textContent.slice(0, 18)).join(' | '))

  defaults?.querySelector('.ais-open')?.click()
  await wait(700)

  const option = (name, want) => {
    const r = [...document.querySelectorAll('.ais-menu .ais-row')]
      .find((x) => x.querySelector('.ais-name')?.textContent === name)
    return [...(r?.querySelectorAll('button') || [])].find((b) => b.textContent.trim() === want)
  }

  // The defaults asked for, showing as the ones already in force.
  check('mode starts on ask', option('Mode', 'ask')?.getAttribute('aria-checked') === 'true',
    option('Mode', 'ask')?.getAttribute('aria-checked'))
  check('follow-ups on always',
    option('Follow-ups', 'always')?.getAttribute('aria-checked') === 'true')
  check('sign-off on required',
    option('Sign-off', 'required')?.getAttribute('aria-checked') === 'true')
  check('verify on test', option('Verify', 'test')?.getAttribute('aria-checked') === 'true')
  check('the token ceiling is spelled 1M', !!option('Tokens', '1M') && !option('Tokens', '1m'),
    [...document.querySelectorAll('.ais-menu .ais-row')]
      .find((x) => x.querySelector('.ais-name')?.textContent === 'Tokens')?.textContent)

  check('depth explains itself on hover',
    ([...document.querySelectorAll('.ais-menu .ais-name')]
      .find((n) => n.textContent === 'Depth')?.getAttribute('title') || '').length > 80,
    [...document.querySelectorAll('.ais-menu .ais-name')]
      .find((n) => n.textContent === 'Depth')?.getAttribute('title'))
  check('and so does each of its positions',
    (option('Depth', '0')?.getAttribute('title') || '').length > 20,
    option('Depth', '0')?.getAttribute('title'))

  option('Mode', 'build')?.click()
  option('Verify', 'reproduce')?.click()
  await wait(1500)
  const saved = JSON.parse((await json('/api/settings')).ai_switch_defaults || '{}')
  check('changing a default stores it', saved.mode === 'build' && saved.verify === 'reproduce',
    JSON.stringify(saved))

  option('Mode', 'ask')?.click()
  await wait(1200)
  const back = JSON.parse((await json('/api/settings')).ai_switch_defaults || '{}')
  check('setting it back to the built-in removes the entry', back.mode === undefined,
    JSON.stringify(back))
  check('leaving the other alone', back.verify === 'reproduce', JSON.stringify(back))

  check('no page error', errors.length === 0, errors.join(' | '))

  // Put it back exactly. Where there was no row at all, leave none — an empty
  // one behaves the same but is residue the next reader has to interpret.
  if (restore !== null) {
    await fetch(`${BASE}/api/settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ai_switch_defaults: restore }),
    })
  } else {
    await del('/api/settings/ai_switch_defaults').catch(() => {})
  }
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  console.log('cleanup: probes removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
