/** :namepage nicknames a page and :goto goes back to it. */
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
  const proj = await post('/api/projects', { name: 'ZZ goto probe', color: 'teal' })
  made.push(proj.id)
  const was = await json('/api/settings')
  const restore = was.page_names ?? null

  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e).slice(0, 140)))
  const dom = await JSDOM.fromURL(`${BASE}/projects/${proj.id}`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
      w.localStorage.setItem('vim_mode', '1')
    },
  })
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3400)

  const key = (k, init = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...init,
  }))
  const said = () => document.querySelector('.vim-say')?.textContent || ''

  const cmd = async (line) => {
    key('Escape'); await wait(140)
    key(':'); await wait(260)
    const box = document.querySelector('.vim-cmd-input')
    if (!box) return false
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(box, line)
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    box.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await wait(900)
    return true
  }

  check('on the project page', window.location.pathname === `/projects/${proj.id}`,
    window.location.pathname)

  // ── naming the page you are on -------------------------------------------
  check('the command line opens', await cmd('namepage ZZ Probe'))
  check('it says it named it', /named/i.test(said()), said())
  const stored = await json('/api/settings')
  const names = JSON.parse(stored.page_names || '{}')
  check('the name is stored, folded to lower case',
    names['zz probe'] === `/projects/${proj.id}`, JSON.stringify(names))

  // ── and reading it back ---------------------------------------------------
  await cmd('namepage')
  check('bare :namepage says the name', /zz probe/i.test(said()), said())

  // ── going somewhere else, then back by name -------------------------------
  await cmd('goto nothing-of-the-sort')
  check('an unknown name says so', /nothing called/i.test(said()), said())

  key('Escape'); await wait(120)
  key('g'); await wait(90); key('a'); await wait(1200)
  check('left the page', window.location.pathname !== `/projects/${proj.id}`,
    window.location.pathname)

  await cmd('goto "ZZ Probe"')
  check('quotes and case do not matter',
    window.location.pathname === `/projects/${proj.id}`, window.location.pathname)

  // ── forgetting it ---------------------------------------------------------
  await cmd('unname zz probe')
  const after = JSON.parse((await json('/api/settings')).page_names || '{}')
  check('unname removes it', !('zz probe' in after), JSON.stringify(after))

  check('no key threw', errors.length === 0, errors.join(' | '))

  // Put the user's own names back exactly as they were.
  if (restore !== null) {
    await fetch(`${BASE}/api/settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page_names: restore }),
    })
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
  for (const id of made) await del(`/api/projects/${id}`)
  console.log('cleanup: probes removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
