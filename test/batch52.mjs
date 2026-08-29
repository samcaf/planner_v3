/** Cards: vim moves over them, Enter opens, shift-click opens a new tab. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-04-06'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
// Recorded as they are made, so the finally can clear them even if the page
// throws before the checks are done.
const made = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const proj = await post('/api/projects', { name: 'ZZ probe alpha', color: 'blue' })
  const proj2 = await post('/api/projects', { name: 'ZZ probe beta', color: 'green' })
  made.push(proj.id, proj2.id)

  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e).slice(0, 140)))
  const opened = []
  const dom = await JSDOM.fromURL(`${BASE}/projects`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
      w.localStorage.setItem('vim_mode', '1')
      w.open = (href) => { opened.push(href); return null }
    },
  })
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3400)

  const key = (k, init = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...init,
  }))
  const onCard = () => document.querySelector('.vim-on-card')?.dataset.open || null
  const cards = () => [...document.querySelectorAll('[data-open]')].map((el) => el.dataset.open)

  check('the page has cards', cards().length >= 2, `${cards().length}`)
  for (let i = 0; i < 40 && !onCard(); i++) await wait(120)
  check('the cursor lands on a card', !!onCard(), `${onCard()}`)

  const start = onCard()
  key('j'); await wait(500)
  check('j moves', onCard() !== start, `${start} -> ${onCard()}`)
  key('k'); await wait(500)
  check('k moves back', onCard() === start, `${onCard()}`)
  key('l'); await wait(500)
  check('l moves', onCard() !== start, `${start} -> ${onCard()}`)
  key('h'); await wait(500)
  check('h moves back', onCard() === start, `${onCard()}`)
  key('G'); await wait(500)
  check('G goes to the last card', onCard() === cards()[cards().length - 1], `${onCard()}`)

  key('Enter', { shiftKey: true }); await wait(500)
  check('Shift-Enter opens a new tab', opened.length === 1, opened.join(','))
  check('at the right place', opened[0] === onCard(), `${opened[0]} vs ${onCard()}`)

  // ── shift-click opens a new tab, without also going there --------------
  const card = document.querySelector('[data-open]')
  const before = window.location.pathname
  opened.length = 0
  card.dispatchEvent(new window.MouseEvent('click', {
    bubbles: true, cancelable: true, shiftKey: true, button: 0,
  }))
  await wait(500)
  check('shift-click opens a tab', opened[0] === card.dataset.open, opened.join(','))
  check('and stays where it was', window.location.pathname === before,
    `${before} -> ${window.location.pathname}`)

  // A control inside a card owns its own clicks — shift-clicking the type
  // picker is not a way of opening the project.
  const inner = document.querySelector('[data-open] select, [data-open] button')
  if (inner) {
    opened.length = 0
    inner.dispatchEvent(new window.MouseEvent('click', {
      bubbles: true, cancelable: true, shiftKey: true, button: 0,
    }))
    await wait(400)
    check('a control inside a card is not the card', opened.length === 0, opened.join(','))
  }

  // A real link takes the same meaning: a new tab, not a new window.
  const link = document.querySelector('a[href^="/"]')
  if (link) {
    opened.length = 0
    link.dispatchEvent(new window.MouseEvent('click', {
      bubbles: true, cancelable: true, shiftKey: true, button: 0,
    }))
    await wait(400)
    check('shift-click on a link opens a tab', opened[0] === link.getAttribute('href'),
      opened.join(','))
  }

  const where = onCard()
  key('Enter'); await wait(900)
  check('Enter opens it here', window.location.pathname === where,
    `${window.location.pathname} vs ${where}`)

  check('no key threw', errors.length === 0, errors.join(' | '))
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
