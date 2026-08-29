/** g-prefixed views, notebook links, scroll fallback, and DAY COMPLETE. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE = 'http://localhost:8787'
const D = '2030-12-12'
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

function openPage(url, errors, vim = true) {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e).slice(0, 140)))
  return JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
      if (vim) w.localStorage.setItem('vim_mode', '1'); else w.localStorage.removeItem('vim_mode')
      Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: async (t) => { w.__clip = t } }, configurable: true,
      })
    },
  })
}

try {
  // ── g takes the dated views too --------------------------------------------
  const errors = []
  let dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  let { window } = dom
  await wait(3200)
  const key = (w, k, init = {}) => w.dispatchEvent(new w.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...init,
  }))

  const go = async (letter) => {
    key(window, 'g'); await wait(120); key(window, letter); await wait(500)
    return window.location.pathname
  }
  check('gw goes to the week, keeping the date', (await go('w')) === `/week/${D}`, window.location.pathname)
  check('gm goes to the month', (await go('m')) === `/month/${D}`, window.location.pathname)
  check('gn goes to the notes page', (await go('n')) === `/notes/${D}`, window.location.pathname)
  check('gd comes back to the day', (await go('d')) === `/day/${D}`, window.location.pathname)
  check('gb goes to the notebook', (await go('b')) === '/notebook', window.location.pathname)
  check('ga still goes to all tasks', (await go('a')) === '/tasks', window.location.pathname)

  // ── j and k scroll where there is nothing to point at ----------------------
  // The notebook has no task rows at all, which is the case this is for.
  key(window, 'g'); await wait(120); key(window, 'b'); await wait(900)
  const doc = window.document
  check('the notebook has no task rows', doc.querySelectorAll('.task[data-task-id]').length === 0,
    `${doc.querySelectorAll('.task[data-task-id]').length}`)
  const main = doc.querySelector('.main')
  let scrolledBy = 0
  if (main) main.scrollBy = ({ top }) => { scrolledBy += top }
  key(window, 'j'); await wait(200)
  check('j scrolls when there is nothing to select', scrolledBy > 0, `${scrolledBy}`)
  key(window, 'k'); await wait(200)
  check('and k scrolls back', scrolledBy === 0, `${scrolledBy}`)

  // ── a notebook entry can be linked -----------------------------------------
  const note = await post('/api/notebook', { title: 'ZZ standing list', body: 'things' })
  madeNotes.push(note.id)
  const task = await post('/api/tasks', {
    title: 'ZZ points at it', scheduled_date: D,
    notes: `see [[note:${note.id}|the standing list]]`,
  })

  dom.window.close()
  const errs2 = []
  dom = await openPage(`${BASE}/day/${D}`, errs2)
  doms.push(dom)
  window = dom.window
  await wait(3200)
  const row = [...window.document.querySelectorAll('.task')]
    .find((r) => /ZZ points at it/.test(r.textContent))
  const link = [...(row?.querySelectorAll('a') || [])]
    .find((a) => (a.getAttribute('href') || '').startsWith('/go/note/'))
  check('a [[note:…]] link renders', !!link,
    [...(row?.querySelectorAll('a') || [])].map((a) => a.getAttribute('href')).join(' | '))
  check('and reads as its title', link?.textContent === 'the standing list', link?.textContent)

  link?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await wait(1400)
  const landed = `${window.location.pathname}${window.location.search}`
  check('following it opens the notebook on that note', landed === `/notebook?note=${note.id}`,
    `got ${JSON.stringify(landed)} want ${JSON.stringify(`/notebook?note=${note.id}`)}`)
  const openTitle = window.document.querySelector('.nb-open .rich-line')?.textContent
    || window.document.querySelector('.nb-open')?.textContent || ''
  check('and that note is the one open', openTitle.includes('ZZ standing list'),
    openTitle.slice(0, 60))
  await del(`/api/tasks/${task.id}`)

  // ── yanking carries the note ------------------------------------------------
  const withNote = await post('/api/tasks', {
    title: 'ZZ yankme', scheduled_date: D, notes: 'the body of it',
  })
  dom.window.close()
  const errs3 = []
  dom = await openPage(`${BASE}/day/${D}`, errs3)
  doms.push(dom)
  window = dom.window
  await wait(3400)
  const cursorId = () => {
    const el = window.document.querySelector('.task.vim-on')
    return el ? Number(el.dataset.taskId) : null
  }
  for (let i = 0; i < 150 && cursorId() === null; i++) await wait(150)
  key(window, 'g'); await wait(90); key(window, 'g'); await wait(200)
  for (let i = 0; i < 16 && cursorId() !== withNote.id; i++) { key(window, 'j'); await wait(90) }
  check('aimed at the task with a note', cursorId() === withNote.id, `${cursorId()}`)
  key(window, 'y'); await wait(120); key(window, 'y'); await wait(700)
  check('yy carries the note as well as the title',
    window.__clip === 'ZZ yankme\nthe body of it', JSON.stringify(window.__clip))

  // ── DAY COMPLETE fires on the transition, not on arrival --------------------
  check('nothing is announced merely by opening a day',
    !window.document.querySelector('.dc'), 'the banner was already up')

  const box = window.document.querySelector(`.task[data-task-id="${withNote.id}"] .task-check`)
  // Everything else on the day must be done for the last tick to complete it.
  const day = await json(`/api/days/${D}`)
  for (const t of day.tasks) {
    if (t.id === withNote.id || t.kind === 'note') continue
    await json(`/api/tasks/${t.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
  }
  await wait(1200)
  const lastBox = window.document.querySelector(`.task[data-task-id="${withNote.id}"] .task-check`)
    || box
  lastBox?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(1400)
  check('finishing the last task announces the day',
    !!window.document.querySelector('.dc'), 'no banner')
  const words = window.document.querySelector('.dc-words')?.textContent || ''
  check('and it says so', words.replace(/\s+/g, ' ').trim() === 'DAY COMPLETE',
    `got ${JSON.stringify(words)}`)

  // ── the styles the rest of it depends on -----------------------------------
  const css = readdirSync('web/dist/assets')
    .filter((f) => /\.(css|js)$/.test(f))
    .map((f) => readFileSync(`web/dist/assets/${f}`, 'utf8')).join('\n')
  check('matched text is painted in the accent',
    /::highlight\(vim-find\)\{[^}]*background:var\(--accent\)/.test(css),
    'no highlight rule')
  check('the wash uses the accent too',
    /\.dc-glow\{[^}]*var\(--accent\)/.test(css), 'no accent in the wash')
  check('and it respects reduced motion',
    /prefers-reduced-motion[^}]*\}[\s\S]{0,400}dc-ch/.test(css)
      || /dc-letter-still/.test(css), 'no reduced-motion path')
  check('the timer sits close under the nav',
    /\.pomo\{[^}]*margin-top:var\(--space-4\)/.test(css), 'the timer still floats')
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  const day = await json(`/api/days/${D}`).catch(() => ({ tasks: [], sections: [] }))
  for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
  for (const s of day.sections) await del(`/api/sections/${s.id}`)
  for (const id of madeNotes) await del(`/api/notebook/${id}`)
  console.log('cleanup: probe rows removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
