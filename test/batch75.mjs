/**
 * The day's bar on a phone, and the gesture that replaces its arrows.
 *
 * The bar had to scroll sideways to hold everything. Four things came off it —
 * the day arrows, the Today chip, the five-icon priority strip, and half the
 * word "New meeting" — and one gesture replaces the first of them. This checks
 * that what left is gone, that what replaced it works, and that a laptop kept
 * all of it.
 *
 * The swipe is worth testing for what it must NOT do. A day view that changes
 * date because you scrolled a list at an angle loses your place with no visible
 * cause, so the negative cases here matter more than the positive one: slow,
 * short, diagonal, and mouse-driven gestures must all do nothing.
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2036-07-15'
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

const open = async (path, { phone = false } = {}) => {
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e.message || e).slice(0, 140)))
  const dom = await JSDOM.fromURL(BASE + path, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = (q) => ({
        matches: phone && /max-width: *700px/.test(q),
        addEventListener() {}, removeEventListener() {},
      })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
    },
  })
  doms.push(dom)
  await wait(3400)
  return { window: dom.window, document: dom.window.document, errors }
}

try {
  const t = await post('/api/tasks', { title: 'ZZ75 something', scheduled_date: D, priority: 'high' })
  made.push(t.id)

  // ── the phone's bar ──────────────────────────────────────────────────────
  const p = await open(`/day/${D}`, { phone: true })
  const pbar = p.document.querySelector('.topbar')

  check('the day arrows are gone', !pbar.querySelector('.daynav'),
    'a swipe does this, and the date field jumps anywhere')
  check('and the Today chip with them',
    !pbar.querySelector('.chip.c-blue'), pbar.textContent.slice(0, 60))
  check('the priority strip is not drawn', !pbar.querySelector('.pri-filter'),
    'five icons and a label was the widest thing in the bar')
  check('a dropdown stands in for it',
    [...pbar.querySelectorAll('button')].some((b) => /^Priority/.test(b.textContent.trim())),
    [...pbar.querySelectorAll('button')].map((b) => b.textContent.trim()).join(' | '))
  check('and the meeting button says just Meeting',
    [...pbar.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Meeting'))

  // the dropdown is the filter, not a decoration
  const trigger = [...pbar.querySelectorAll('button')].find((b) => /^Priority/.test(b.textContent.trim()))
  trigger.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await wait(400)
  const menu = p.document.querySelector('.pri-menu')
  check('it opens on to the five levels', menu?.querySelectorAll('.pri-filter-btn').length === 5,
    String(menu?.querySelectorAll('.pri-filter-btn').length))
  check('each one named, not just drawn',
    /highest/.test(menu?.textContent || ''), (menu?.textContent || '').slice(0, 60))

  const rows = () => p.document.querySelectorAll('.task').length
  const before = rows()
  ;[...menu.querySelectorAll('.pri-filter-btn')]
    .find((b) => b.className.includes('pri-highest'))
    ?.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await wait(500)
  check('and picking one actually filters the day', rows() < before, `${before} → ${rows()}`)
  check('the trigger counts what is on',
    /Priority · 1/.test(pbar.textContent), pbar.textContent.slice(0, 40))

  check('nothing threw on the phone', p.errors.length === 0, p.errors.join(' | '))

  // ── the gesture that replaces the arrows ─────────────────────────────────
  const swipe = async (dom, dx, dy, ms, pointerType = 'touch') => {
    const w = dom.window
    const target = dom.document.querySelector('.day-col') || dom.document.querySelector('.main')
    const fire = (type, x, y) => target.dispatchEvent(new w.PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType, pointerId: 1,
    }))
    const from = w.location.pathname
    fire('pointerdown', 200, 400)
    await wait(ms)
    fire('pointerup', 200 + dx, 400 + dy)
    await wait(900)
    return { from, to: w.location.pathname }
  }

  const fwd = await swipe(p, -150, 0, 60)
  check('a strong swipe left goes to the next day', fwd.to.endsWith('2036-07-16'), `${fwd.from} → ${fwd.to}`)
  const back = await swipe(p, 150, 0, 60)
  check('and a strong swipe right goes back', back.to.endsWith('2036-07-15'), `${back.from} → ${back.to}`)

  const slow = await swipe(p, -150, 0, 900)
  check('a slow drag does not — that is a pan, not a page turn',
    slow.to === slow.from, `${slow.from} → ${slow.to}`)
  const short = await swipe(p, -60, 0, 60)
  check('nor a short one — that is a tap that slipped',
    short.to === short.from, `${short.from} → ${short.to}`)
  const diagonal = await swipe(p, -150, 120, 60)
  check('nor a diagonal one — that is a scroll with a lean on it',
    diagonal.to === diagonal.from, `${diagonal.from} → ${diagonal.to}`)
  const mouse = await swipe(p, -150, 0, 60, 'mouse')
  check('and a mouse drag never does', mouse.to === mouse.from, `${mouse.from} → ${mouse.to}`)

  // ── the laptop keeps all of it ───────────────────────────────────────────
  const d = await open(`/day/${D}`)
  const dbar = d.document.querySelector('.topbar')
  check('a laptop keeps the arrows', !!dbar.querySelector('.daynav'))
  check('and the priority strip, all five of it',
    dbar.querySelectorAll('.pri-filter-btn').length === 5,
    String(dbar.querySelectorAll('.pri-filter-btn').length))
  check('and the longer button label',
    [...dbar.querySelectorAll('button')].some((b) => b.textContent.trim() === 'New meeting'))
  const deskSwipe = await swipe(d, -150, 0, 60)
  check('and ignores the swipe, because the arrows are right there',
    deskSwipe.to === deskSwipe.from, `${deskSwipe.from} → ${deskSwipe.to}`)
  check('nothing threw on the laptop', d.errors.length === 0, d.errors.join(' | '))
} catch (e) {
  check('the suite ran to the end', false, e.stack?.split('\n').slice(0, 2).join(' | ') || e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  for (const id of made) await del(`/api/tasks/${id}`)
  console.log('cleanup: probes removed')
  for (const x of doms) { try { x.window.close() } catch {} }
  process.exit(bad ? 1 : 0)
}
