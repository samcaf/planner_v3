/** The second round of keyboard requests: Space, Enter, sections, /, gs, clicks. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE = 'http://localhost:8787'
const D = '2030-10-10'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function openPage(url, errors) {
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
      w.localStorage.setItem('vim_mode', '1')
      Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: async (t) => { w.__clip = t } }, configurable: true,
      })
    },
  })
}

try {
  const morning = await post('/api/sections', { date: D, name: 'ZZ Morning', layout: 'columns' })
  const evening = await post('/api/sections', { date: D, name: 'ZZ Evening', layout: 'columns' })
  const parent = await post('/api/tasks', {
    title: 'ZZ parent', scheduled_date: D, section_id: morning.id, estimate_min: 5,
  })
  const child = await post('/api/tasks', {
    title: 'ZZ child', scheduled_date: D, section_id: morning.id, estimate_min: 5,
  })
  await post(`/api/tasks/${child.id}/nest`, { parent_id: parent.id })
  const later = await post('/api/tasks', {
    title: 'ZZ later', scheduled_date: D, section_id: evening.id, estimate_min: 5,
  })

  const errors = []
  const dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3400)

  const key = (k, init = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...init,
  }))
  const cursorId = () => {
    const el = document.querySelector('.task.vim-on')
    return el ? Number(el.dataset.taskId) : null
  }
  // Sections are cursor stops too, so a walk from the top passes through them —
  // the loop needs room for those as well as for the tasks.
  const aim = async (id) => {
    key('g'); await wait(90); key('g'); await wait(200)
    for (let i = 0; i < 24 && cursorId() !== id; i++) { key('j'); await wait(90) }
    return cursorId() === id
  }
  const sectionShut = (id) => document
    .querySelector(`.panel.section[data-section-id="${id}"]`)?.dataset.sectionShut === '1'

  for (let i = 0; i < 150 && cursorId() === null; i++) await wait(150)
  check('the cursor starts', cursorId() !== null, 'no cursor')

  // 1 ── Enter ticks, Space folds ------------------------------------------
  check('aimed at the parent', await aim(parent.id), `${cursorId()}`)
  key('Enter'); await wait(900)
  check('Enter is what marks a task done',
    (await json(`/api/tasks/${parent.id}`)).status === 'done',
    (await json(`/api/tasks/${parent.id}`)).status)
  check('ticking a parent carries down to its child',
    (await json(`/api/tasks/${child.id}`)).status === 'done',
    (await json(`/api/tasks/${child.id}`)).status)

  // Two entries, because a cascade is recorded as two: the children first, the
  // task itself second. One u takes back the children only.
  key('u'); await wait(1100)
  check('u takes back the children first',
    (await json(`/api/tasks/${child.id}`)).status === 'todo'
    && (await json(`/api/tasks/${parent.id}`)).status === 'done',
    `child=${(await json(`/api/tasks/${child.id}`)).status} parent=${(await json(`/api/tasks/${parent.id}`)).status}`)
  key('u'); await wait(1100)
  check('and a second u takes back the task itself',
    (await json(`/api/tasks/${parent.id}`)).status === 'todo',
    (await json(`/api/tasks/${parent.id}`)).status)

  check('back on the parent', await aim(parent.id))
  const twistState = () => document
    .querySelector(`.task[data-task-id="${parent.id}"] .task-twist[aria-expanded]`)
    ?.getAttribute('aria-expanded')
  const wasOpen = twistState()
  check('the parent has children to fold', wasOpen !== undefined, `${wasOpen}`)
  key(' '); await wait(500)
  check('Space folds what is under a task', twistState() !== wasOpen,
    `${wasOpen} -> ${twistState()}`)
  key(' '); await wait(500)
  check('and Space again unfolds it', twistState() === wasOpen, `${twistState()}`)

  // 2 ── Ctrl-Space folds the whole section ---------------------------------
  check('back on the parent', await aim(parent.id))
  check('its section starts open', !sectionShut(morning.id))
  key(' ', { ctrlKey: true }); await wait(900)
  check('Ctrl-Space folds the section it is in', sectionShut(morning.id),
    'the section is still open')
  key(' ', { ctrlKey: true }); await wait(900)
  check('and Ctrl-Space again opens it', !sectionShut(morning.id))

  // 3 ── J and K walk sections ----------------------------------------------
  check('back on the parent', await aim(parent.id))
  // The cursor may be holding the section itself rather than a row inside it.
  const sectionOfCursor = () => document.querySelector('.panel.section.vim-on-section')
    ?.dataset.sectionId
    ?? document.querySelector('.task.vim-on')?.closest('.panel.section')?.dataset.sectionId
  check('the cursor is in the first section', sectionOfCursor() === String(morning.id),
    sectionOfCursor())
  key('J'); await wait(700)
  check('J moves to the next section', sectionOfCursor() === String(evening.id),
    sectionOfCursor())
  key('K'); await wait(700)
  check('K moves back to the one before', sectionOfCursor() === String(morning.id),
    sectionOfCursor())

  // 4 ── walking into a shut section opens it, and shuts it again -----------
  // Folded from the keyboard rather than patched on the server: a PATCH the
  // page has not refetched is not folded as far as the page is concerned.
  check('into the far section', await aim(later.id), `${cursorId()}`)
  key(' ', { ctrlKey: true }); await wait(1100)
  check('the far section is shut', sectionShut(evening.id), 'it is open')

  check('back on the parent', await aim(parent.id))
  key('J'); await wait(1000)
  check('walking into a shut section opens it', !sectionShut(evening.id),
    'it stayed shut, so the cursor had nowhere to land')
  check('and the cursor is inside it', sectionOfCursor() === String(evening.id),
    sectionOfCursor())
  key('K'); await wait(1000)
  check('leaving without changing anything shuts it again', sectionShut(evening.id),
    'it was left open')

  // …but a change made inside keeps it open.
  check('back on the parent', await aim(parent.id))
  key('J'); await wait(1000)
  check('inside again', sectionOfCursor() === String(evening.id), sectionOfCursor())
  key('t'); await wait(1000)              // a change that does not remove the row
  key('K'); await wait(1000)
  check('a section changed while inside is left open', !sectionShut(evening.id),
    'it shut despite the edit')
  key('g'); await wait(90); key('g'); await wait(200)

  // 5 ── / greps this page, n walks the hits --------------------------------
  key('g'); await wait(90); key('g'); await wait(200)
  key('/'); await wait(300)
  check('/ opens a search line',
    document.querySelector('.vim-mode')?.textContent === 'SEARCH',
    document.querySelector('.vim-mode')?.textContent)
  check('marked with a slash, not a colon',
    document.querySelector('.vim-colon')?.textContent === '/',
    document.querySelector('.vim-colon')?.textContent)
  const field = document.querySelector('.vim-cmd-input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(field, 'later')
  field.dispatchEvent(new window.Event('input', { bubbles: true }))
  field.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await wait(700)
  check('/ puts the cursor on what it found', cursorId() === later.id,
    `${cursorId()} want ${later.id}`)
  check('and says how many it found', /1 of \d/.test(document.querySelector('.vim-say')?.textContent || ''),
    document.querySelector('.vim-say')?.textContent)

  // 6 ── clicking a task moves the cursor -----------------------------------
  const otherRow = document.querySelector(`.task[data-task-id="${parent.id}"]`)
  otherRow?.querySelector('.task-title')
    ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(400)
  check('clicking a task moves the cursor to it, even in this mode',
    cursorId() === parent.id, `${cursorId()} want ${parent.id}`)
  key('Escape'); await wait(200)

  // 7 ── g s goes to settings -----------------------------------------------
  key('g'); await wait(120); key('s'); await wait(600)
  check('g then s opens settings', window.location.pathname === '/settings',
    window.location.pathname)

  check('no key threw along the way', errors.length === 0, errors.slice(0, 2).join(' | '))

  // 8 ── the pomodoro fills itself, with no ring ----------------------------
  const css = readdirSync('web/dist/assets')
    .filter((f) => /\.(css|js)$/.test(f))
    .map((f) => readFileSync(`web/dist/assets/${f}`, 'utf8')).join('\n')
  check('the ring around the fruit is gone', !/pom-arc|pom-track/.test(css),
    'the progress ring is still there')
  check('the fruit itself carries the fill', /pom-body[^{]*\.is-filled|is-filled[^{]*pom/.test(css),
    'no filled body rule')
  check('the rail gives way on a short window', /@media[^{]*max-height:\s*760px/.test(css),
    'no short-window rules')
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
  console.log('cleanup: probe day cleared')
  for (const d of doms) { try { d.window.close() } catch {} }
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
