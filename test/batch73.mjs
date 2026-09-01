/**
 * The task row on a phone, and the chip that opens the timing panel.
 *
 * The hover strip was the bug. `.task-actions` floats over the row's top-right
 * corner — a deliberate trade on a laptop, where it buys the title the width
 * the buttons would otherwise hold and costs a sliver of text only while you
 * point at it. A touch screen has no hover to make that trade with. What it has
 * is the sticky `:hover` a tap leaves behind, so the strip appeared over the
 * title and the checkbox of whichever task you last touched and stayed there.
 *
 * The second half is one control paying for itself twice: a row that already
 * says when it is or how long it takes can open the timing panel from the chip
 * that says so, and the clock button beside it is redundant. So the chip became
 * the control and the button now appears only where there is no chip.
 *
 * Layout is asserted against the BUILT stylesheet — jsdom does no layout, and a
 * media query it cannot evaluate is not worth pretending to test. Which
 * controls exist, and what clicking one does, is ordinary DOM.
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE = 'http://localhost:8787'
const D = '2035-06-12'
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

const built = readdirSync('web/dist/assets')
  .filter((f) => /\.(css|js)$/.test(f))
  .map((f) => readFileSync(`web/dist/assets/${f}`, 'utf8')).join('\n')

try {
  // ── the strip leaves the corner, but only on a phone ─────────────────────
  check('on a laptop the strip still floats over the row',
    /\.task-actions\{position:absolute;top:4px;right:6px/.test(built),
    'the width it gives back to the title is worth the sliver it covers')
  check('and is invisible until you point at the row',
    /\.task-actions\{[^}]*opacity:0\}/.test(built))

  check('on a phone it comes back into the flow',
    /@media \(max-width: *700px\)\{[^@]*\.task-actions\{position:static/.test(built),
    'a tap leaves a sticky :hover, so the strip stuck over the title')
  check('takes a row of its own under the task',
    /\.task>\.task-actions\{flex:1 0 100%/.test(built))
  check('which needs the row to wrap',
    /@media \(max-width: *700px\)\{[^@]*\.task\{flex-wrap:wrap\}/.test(built))
  check('and it drops the floating chrome it no longer needs',
    /\.task-actions\{position:static;padding:0;background:none;box-shadow:none/.test(built))

  // ── a chip that is a button was wearing the browser's default border ─────
  check('a chip has no border, whichever element it is',
    /\.chip\{[^}]*border:0\}/.test(built),
    'button.chip had 2px outset, so it sat 4px wider than every span beside it')
  check('and says it is clickable when it is one',
    /button\.chip\{cursor:pointer\}/.test(built))
  check('the timing chips light up on hover',
    /\.tm-chip:hover\{background:var\(--accent-soft\)/.test(built))
  check('and stay lit while the panel they opened is up',
    /\.tm-chip\.is-on\{background:var\(--accent\)/.test(built))

  // ── which control a row actually gets ────────────────────────────────────
  const timed = await post('/api/tasks', {
    title: 'ZZ73 has a time', scheduled_date: D, start_time: '09:00', end_time: '09:30',
  })
  const estimated = await post('/api/tasks', {
    title: 'ZZ73 has an estimate', scheduled_date: D, estimate_min: 45,
  })
  const bare = await post('/api/tasks', { title: 'ZZ73 has neither', scheduled_date: D })
  made.push(timed.id, estimated.id, bare.id)

  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e.message || e).slice(0, 140)))
  const dom = await JSDOM.fromURL(`${BASE}/day/${D}`, {
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
  await wait(3400)

  const row = (id) => document.querySelector(`.task[data-task-id="${id}"]`)
  const chip = (id) => row(id)?.querySelector('button.tm-chip')
  const clock = (id) => [...(row(id)?.querySelectorAll('button.btn') || [])]
    .find((b) => b.getAttribute('title') === 'Time and duration')

  check('all three rows drew', !!row(timed.id) && !!row(estimated.id) && !!row(bare.id))

  check('a timed task gets a chip to open the panel with', !!chip(timed.id),
    row(timed.id)?.textContent?.slice(0, 60))
  check('and no clock button beside it', !clock(timed.id),
    'the chip already opens the panel — the button is the row paying twice')

  check('an estimated task gets one too', !!chip(estimated.id))
  check('and no clock button either', !clock(estimated.id))

  check('a task with neither gets the clock button', !!clock(bare.id),
    'this is the row that has nothing else to click')
  check('and no timing chip', !chip(bare.id))

  // ── and what clicking it does ────────────────────────────────────────────
  const click = (el) => el?.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  const panelUp = (id) => !!row(id)?.querySelector('.task-details')

  check('the panel starts closed', !panelUp(timed.id))
  click(chip(timed.id))
  await wait(400)
  check('clicking the chip opens the timing panel', panelUp(timed.id))
  check('and the chip shows it is the one holding it open',
    chip(timed.id)?.className.includes('is-on'), chip(timed.id)?.className)

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
  for (const id of made) await del(`/api/tasks/${id}`)
  console.log('cleanup: probes removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  process.exit(bad ? 1 : 0)
}
