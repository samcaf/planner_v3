/** Links in note bodies are followable; the editor still opens when it should. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2029-10-01'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
const madeNotes = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function openPage(url, errors) {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(e.message))
  return JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      const node = () => ({
        connect: (n) => n, start() {}, stop() {}, type: '', frequency: { value: 0 },
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      })
      w.AudioContext = function () {
        return { currentTime: 0, state: 'running', resume() {}, destination: {},
          createOscillator: node, createGain: node }
      }
    },
  })
}

/**
 * What a browser really does when you press a link inside a focusable box:
 * mousedown, then focus (which React hears as focusin, and focusin BUBBLES),
 * then mouseup, then click. Dispatching only `click` — which is what a naive
 * test does — hides the bug entirely, because the focus is what used to swap
 * the text for a textarea before the click could land.
 */
function realClick(window, el, focusTarget) {
  const opts = { bubbles: true, cancelable: true, view: window }
  el.dispatchEvent(new window.MouseEvent('mousedown', opts))
  ;(focusTarget || el).dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }))
  el.dispatchEvent(new window.MouseEvent('mouseup', opts))
  el.dispatchEvent(new window.MouseEvent('click', opts))
}

try {
  const note = await post('/api/notebook', {
    title: 'ZZ linknote',
    body: 'See [example](https://example.invalid/nb) and [[day:2029-10-02]] and https://example.invalid/bare',
  })
  madeNotes.push(note.id)

  let errors = []
  let dom = await openPage(`${BASE}/notebook`, errors)
  doms.push(dom)
  let { window } = dom
  let { document } = window
  await wait(3000)
  check('notebook: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const item = [...document.querySelectorAll('.nb-item')]
    .find((b) => /ZZ linknote/.test(b.textContent))
  item?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(500)

  const view = () => document.querySelector('.nb-open .rich-view')
  check('the note body renders as text, not a textarea', !!view() && !document.querySelector('.nb-open textarea'))

  const anchors = [...(view()?.querySelectorAll('a') || [])]
  check('a markdown link becomes an anchor',
    anchors.some((a) => a.getAttribute('href') === 'https://example.invalid/nb'),
    anchors.map((a) => a.getAttribute('href')).join(' | '))
  check('a wiki link becomes an anchor',
    anchors.some((a) => (a.getAttribute('href') || '').startsWith('/go/day/')),
    anchors.map((a) => a.getAttribute('href')).join(' | '))
  check('a bare url is linkified too',
    anchors.some((a) => a.getAttribute('href') === 'https://example.invalid/bare'),
    anchors.map((a) => a.getAttribute('href')).join(' | '))

  // --- the bug: focus stealing the click ----------------------------------
  const wiki = anchors.find((a) => (a.getAttribute('href') || '').startsWith('/go/'))
  const before = window.location.pathname
  realClick(window, wiki, view())
  await wait(700)
  check('pressing a link does not swap the text for an editor',
    !document.querySelector('.nb-open textarea'),
    'a textarea appeared before the click could land')
  check('and the link is followed', window.location.pathname !== before,
    `${before} -> ${window.location.pathname}`)
  check('to the day it names', window.location.pathname === '/day/2029-10-02',
    window.location.pathname)

  // --- the editor must still open the ordinary way ------------------------
  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/notebook`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3000)
  const item2 = [...document.querySelectorAll('.nb-item')]
    .find((b) => /ZZ linknote/.test(b.textContent))
  item2?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(500)

  const v2 = document.querySelector('.nb-open .rich-view')
  realClick(window, v2, v2)
  await wait(400)
  check('clicking the body away from a link still opens the editor',
    !!document.querySelector('.nb-open textarea'),
    'the editor did not open')

  // --- and by keyboard, with no press at all ------------------------------
  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/notebook`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3000)
  const item3 = [...document.querySelectorAll('.nb-item')]
    .find((b) => /ZZ linknote/.test(b.textContent))
  item3?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(500)
  const v3 = document.querySelector('.nb-open .rich-view')
  // Tab arrives as focus with no mousedown before it.
  v3?.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }))
  await wait(400)
  check('tabbing into the body opens the editor, as it must for the keyboard',
    !!document.querySelector('.nb-open textarea'),
    'focus alone no longer opens it')

  // --- the same body inside a task on a day -------------------------------
  const t = await post('/api/tasks', {
    title: 'ZZ tasklinks', scheduled_date: D,
    notes: 'Body [ref](https://example.invalid/t) and [[day:2029-10-03]]',
  })
  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3200)
  check('day: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const row = [...document.querySelectorAll('.task')].find((r) => /ZZ tasklinks/.test(r.textContent))
  const noteView = row?.querySelector('.rich-view')
  const taskWiki = [...(noteView?.querySelectorAll('a') || [])]
    .find((a) => (a.getAttribute('href') || '').startsWith('/go/'))
  check('a task note renders its links', !!taskWiki,
    [...(noteView?.querySelectorAll('a') || [])].map((a) => a.getAttribute('href')).join(' | '))
  const was = window.location.pathname
  realClick(window, taskWiki, noteView)
  await wait(700)
  check('a link in a task note is followed too', window.location.pathname !== was,
    `${was} -> ${window.location.pathname}`)
  await del(`/api/tasks/${t.id}`)

  // --- titles that used to be raw markdown --------------------------------
  const t2 = await post('/api/tasks', {
    title: 'ZZ dashlink [site](https://example.invalid/d)', scheduled_date: D, status: 'todo',
  })
  for (const [page, url] of [['week', `/week/${D}`], ['month', `/month/${D}`]]) {
    dom.window.close()
    errors = []
    dom = await openPage(BASE + url, errors)
    doms.push(dom)
    await wait(3200)
    const body = dom.window.document.body.textContent
    check(`${page}: a title is rendered, not shown as raw markdown`,
      body.includes('ZZ dashlink') && !body.includes('[site]('),
      body.includes('[site](') ? 'raw markdown on screen' : 'title missing')
  }
  await del(`/api/tasks/${t2.id}`)
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  for (const d of doms) { try { d.window.close() } catch {} }
  for (const id of madeNotes) await del(`/api/notebook/${id}`)
  const day = await json(`/api/days/${D}`).catch(() => ({ tasks: [] }))
  for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
  console.log('cleanup: probe rows removed')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
