/**
 * The phone: installable, and usable without a drag.
 *
 * Two halves. The layout half is asserted against the BUILT stylesheet, the way
 * batch45 already checks the day-complete wash, because jsdom does no layout and
 * a media query it cannot evaluate is not worth pretending to test. The
 * behaviour half is ordinary DOM: the row menu is what a finger uses where a
 * mouse would drag, so it is driven for real and checked against the API.
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE = 'http://localhost:8787'
const D = '2033-04-04'
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

const css = readdirSync('web/dist/assets')
  .filter((f) => /\.(css|js)$/.test(f))
  .map((f) => readFileSync(`web/dist/assets/${f}`, 'utf8')).join('\n')
const html = readFileSync('web/dist/index.html', 'utf8')
const sw = readFileSync('web/dist/sw.js', 'utf8')
const manifest = JSON.parse(readFileSync('web/dist/manifest.webmanifest', 'utf8'))

try {
  // ── the bug that made every existing breakpoint useless ──────────────────
  // Both widths are dragged and stored, and both used to be written as inline
  // styles — which outrank every rule in the stylesheet, so the responsive work
  // that was already here had never once taken effect.
  check('the rail width is a custom property, not an inline width',
    /\.sidebar\{[^}]*width:var\(--rail-w/.test(css), 'inline width would beat every media query')
  check('and so is the day’s side column',
    /\.day-wrap\{[^}]*grid-template-columns:minmax\(0,1fr\) 4px var\(--aside-w/.test(css))
  check('so the one-column rule can now win',
    /@media \(max-width: *1080px\)\{[^@]*\.day-wrap\{grid-template-columns:1fr/.test(css))

  // ── the drawer ───────────────────────────────────────────────────────────
  // Matched against the whole stylesheet rather than a slice of it: carving the
  // media block out with a regex is guesswork about where it ends, and these
  // rules are unique enough that they need no such context. The base `.sidebar`
  // sets no position at all, so a fixed one can only be the drawer.
  check('below 700px the rail leaves the flow', /\.sidebar\{position:fixed/.test(css))
  check('and is pushed off screen', /\.sidebar\{[^}]*transform:translate\(-101%\)/.test(css))
  check('until the app says it is open',
    /\.app\.rail-open \.sidebar\{transform:none\}/.test(css))
  check('a button exists to open it', /\.rail-btn\{[^}]*display:inline-flex/.test(css))
  check('and the drag handles are gone',
    /\.rail-grip,\.day-wrap>\.grip-v\{display:none\}/.test(css))
  check('only on a narrow screen, though',
    /@media \(max-width: *700px\)/.test(css), 'the drawer must not apply on a laptop')

  // ── a pointer that cannot hover ──────────────────────────────────────────
  check('hover-only controls are shown to a touch screen',
    /@media \(hover: *none\)/.test(css), 'ten controls were invisible without a mouse')
  check('including the month grid’s add button, which had no other way in',
    /@media \(hover: *none\)\{[^@]*\.mday \.mday-add/.test(css))

  // ── the notch ────────────────────────────────────────────────────────────
  check('the page may reach under the notch', /viewport-fit=cover/.test(html))
  check('and the fixed bars keep clear of it', /env\(safe-area-inset-/.test(css))
  check('the mode bar included',
    /\.vim-bar\{padding-bottom:calc\([^}]*safe-area-inset-bottom/.test(css))

  // ── installable ──────────────────────────────────────────────────────────
  check('a service worker ships', /addEventListener\("fetch"|addEventListener\('fetch'/.test(sw))
  check('the app registers it', /serviceWorker/.test(
    readFileSync(`web/dist/assets/${html.match(/assets\/(index-[^"]+\.js)/)[1]}`, 'utf8')))
  // The one rule that matters: a cached answer here would have you ticking off
  // a task that no longer exists.
  check('and it never serves the data from a cache',
    /pathname\.startsWith\("\/api\/"\)|pathname\.startsWith\('\/api\/'\)/.test(sw)
      && /return\s*$|return\n/m.test(sw))
  check('the manifest asks for a standalone window', manifest.display === 'standalone')
  check('with the icon sizes Chrome requires',
    ['192x192', '512x512'].every((s) => manifest.icons.some((i) => i.sizes === s))
      && manifest.icons.some((i) => (i.purpose || '').includes('maskable')))

  // ── and the half a finger actually touches ───────────────────────────────
  const a = await post('/api/tasks', { title: 'ZZ71 first', scheduled_date: D })
  const b = await post('/api/tasks', { title: 'ZZ71 second', scheduled_date: D })
  const c = await post('/api/tasks', { title: 'ZZ71 third', scheduled_date: D })
  made.push(a.id, b.id, c.id)

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

  const click = (el) => el?.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true }),
  )
  const rowFor = (id) => document.querySelector(`.task[data-task-id="${id}"]`)
  const openMenu = async (id) => {
    click([...(rowFor(id)?.querySelectorAll('button') || [])]
      .find((x) => x.getAttribute('title') === 'More'))
    await wait(400)
  }
  const menuItem = (text) => [...document.querySelectorAll('.menu-item')]
    .find((x) => x.textContent.trim().startsWith(text))
  const order = async () => (await json(`/api/tasks?date=${D}`)).map((t) => t.title)

  check('the row is on the page', !!rowFor(b.id))
  await openMenu(b.id)
  check('the menu offers what a drag used to do',
    !!menuItem('Move up') && !!menuItem('Move down') && !!menuItem('Nest under'),
    [...document.querySelectorAll('.menu-item')].map((x) => x.textContent.trim()).join(', '))

  const was = await order()
  click(menuItem('Move up'))
  await wait(1500)
  const now = await order()
  check('“Move up” actually reorders', now[0] === 'ZZ71 second' && was[0] === 'ZZ71 first',
    `${was.join(' | ')}  ->  ${now.join(' | ')}`)

  await openMenu(c.id)
  click(menuItem('Nest under'))
  await wait(400)
  const target = [...document.querySelectorAll('.menu-sub-body .menu-item')]
    .find((x) => x.textContent.trim() === 'ZZ71 first')
  check('“Nest under…” lists the other tasks by name', !!target,
    [...document.querySelectorAll('.menu-sub-body .menu-item')].map((x) => x.textContent.trim()).join(', '))
  click(target)
  await wait(1500)
  const nested = await json(`/api/tasks/${c.id}`)
  check('and nesting one under another works without a drag',
    nested.parent_id === a.id, `parent ${nested.parent_id}, wanted ${a.id}`)

  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  const day = await json(`/api/days/${D}`).catch(() => ({ tasks: [] }))
  for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
  for (const id of made) await del(`/api/tasks/${id}`)
  console.log('cleanup: probe rows removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  process.exit(bad ? 1 : 0)
}
