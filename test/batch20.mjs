/**
 * This round: section drags ignored by task rows, move/copy submenus that
 * recreate the section on the far day, arrow-key navigation, subtasks opening
 * ready to type, and one time panel giving way to another in a single click.
 */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const DAY = '2028-07-11'
const NEXT = '2028-07-12'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom
const madeSections = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })

try {
  const sec = await post('/api/sections', { date: DAY, name: 'ZZ-band', color: 'teal', layout: 'columns' })
  madeSections.push(sec.id)
  const inBand = await post('/api/tasks', {
    title: 'ZZ-in-band', scheduled_date: DAY, section_id: sec.id, estimate_min: 30,
  })

  // --- move recreates the band on the far day -----------------------------
  await post(`/api/tasks/${inBand.id}/move`, { date: NEXT })
  const next = await json(`/api/days/${NEXT}`)
  const landed = next.tasks.find((t) => t.id === inBand.id)
  const band = next.sections.find((s) => s.name === 'ZZ-band')
  check('moving carries the task to the far day', landed?.scheduled_date === NEXT)
  check('and makes its section there', !!band, 'no section was created')
  check('the task lands in it', landed?.section_id === band?.id,
    `section_id=${landed?.section_id} band=${band?.id}`)
  check('the section keeps its colour and layout',
    band?.color === 'teal' && band?.layout === 'columns',
    `${band?.color}/${band?.layout}`)
  // This used to assert status === 'moved' and a moved_to_date, which was the
  // bug rather than the behaviour: that pair marks work pushed OFF a day, so
  // the task arrived on the target already closed — out of its open count and
  // out of its minutes — while nothing was left on the day it came from.
  check('it arrives open, not marked as having moved away',
    landed?.status === 'todo' && landed?.moved_to_date === null,
    `${landed?.status} ${landed?.moved_to_date}`)

  // Moving back should reuse the original band rather than making a second.
  await post(`/api/tasks/${inBand.id}/move`, { date: DAY })
  const backDay = await json(`/api/days/${DAY}`)
  check('moving back reuses the band it came from',
    backDay.sections.filter((s) => s.name === 'ZZ-band').length === 1,
    `${backDay.sections.filter((s) => s.name === 'ZZ-band').length} bands`)

  // --- copy leaves the original where it is -------------------------------
  const copy = await post(`/api/tasks/${inBand.id}/move`, { date: NEXT, copy: true })
  const orig = await json(`/api/tasks/${inBand.id}`)
  check('copying leaves the original in place', orig.scheduled_date === DAY,
    `original is on ${orig.scheduled_date}`)
  check('the copy is a different row on the far day',
    copy.id !== inBand.id && copy.scheduled_date === NEXT, `${copy.id} on ${copy.scheduled_date}`)
  check('a copy is not marked as pushed on', copy.moved_to_date === null,
    `moved_to_date=${copy.moved_to_date}`)

  // The move checks above left it flagged `moved`, which the Day page files
  // into a collapsed bucket — so it would not be on screen to drive.
  await fetch(`${BASE}/api/tasks/${inBand.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'todo', moved_to_date: null }),
  })
  await del(`/api/tasks/${copy.id}`)

  // --- the page -----------------------------------------------------------
  const vc = new VirtualConsole()
  const errors = []
  vc.on('jsdomError', (e) => errors.push(e.message))
  dom = await JSDOM.fromURL(`${BASE}/day/${DAY}`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.open = (...a) => { w.__opened = a; return null }
    },
  })
  const { window } = dom
  const { document } = window
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const click = (el, init = {}) => el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...init }))
  await wait(3000)
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const rowFor = (t) => [...document.querySelectorAll('.task')].find((r) => r.textContent.includes(t))

  // --- a section drag must not light up task rows -------------------------
  const dt = {
    _d: new Map([['text/section-id', String(sec.id)]]),
    types: ['text/section-id'],
    getData(k) { return this._d.get(k) || '' },
    setData(k, v) { this._d.set(k, v) },
  }
  const fire = (el, type, extra = {}) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    Object.assign(ev, extra)
    el.dispatchEvent(ev)
  }
  const row = rowFor('ZZ-in-band')
  fire(row, 'dragover', { clientY: 10 })
  await wait(200)
  check('a task row ignores a section being dragged over it',
    !/drop-(before|after|nest)/.test(row.className), row.className)
  check('and no column arms for it', !document.querySelector('.box-col.is-armed'))

  // --- move/copy are submenus ---------------------------------------------
  const more = [...rowFor('ZZ-in-band').querySelectorAll('button')]
    .find((b) => b.getAttribute('title') === 'More')
  click(more)
  await wait(350)
  const entries = [...document.querySelectorAll('.menu-item')].map((b) => b.textContent.trim())
  check('there is one Move to entry', entries.filter((t) => /^Move to/.test(t)).length === 1,
    entries.join(' | '))
  check('and a Copy to beside it', entries.some((t) => /^Copy to/.test(t)), entries.join(' | '))
  check('"Move to tomorrow" is no longer its own entry',
    !entries.some((t) => /Move to tomorrow/.test(t)), entries.join(' | '))

  const moveBtn = [...document.querySelectorAll('.menu-item')].find((b) => /^Move to/.test(b.textContent))
  click(moveBtn)
  await wait(300)
  const body = document.querySelector('.menu-sub-body')
  check('opening it offers Tomorrow and a date field',
    !!body && /Tomorrow/.test(body.textContent) && !!body.querySelector('input[type="date"]'),
    body?.textContent)
  click(more)
  await wait(200)

  // --- ctrl-click the day arrow opens a tab -------------------------------
  const nextBtn = [...document.querySelectorAll('button')]
    .find((b) => b.getAttribute('aria-label') === 'Next day')
  click(nextBtn, { ctrlKey: true })
  await wait(200)
  check('ctrl-click on the day arrow opens a new tab',
    Array.isArray(window.__opened) && window.__opened[0] === `/day/${NEXT}`,
    JSON.stringify(window.__opened))

  // --- adding a subtask opens it ready to type ----------------------------
  const addKid = [...rowFor('ZZ-in-band').querySelectorAll('button')]
    .find((b) => b.getAttribute('title') === 'Add subtask')
  click(addKid)
  await wait(1600)
  const fresh = [...document.querySelectorAll('input.rich-line-input')]
    .find((i) => i.value === 'New subtask')
  check('a new subtask opens with its name selected',
    fresh && fresh.selectionStart === 0 && fresh.selectionEnd === 'New subtask'.length,
    fresh ? `sel ${fresh.selectionStart}..${fresh.selectionEnd}` : 'no open editor')
  fresh?.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
  await wait(600)

  // --- one time panel gives way to another in a single click --------------
  const rows = [...document.querySelectorAll('.task')]
    .filter((r) => r.querySelector('button[title="Time and duration"]'))
  check('there are two rows to compare', rows.length >= 2, `${rows.length} rows`)
  click(rows[0].querySelector('button[title="Time and duration"]'))
  await wait(350)
  check('the first time panel opens', !!rows[0].querySelector('.task-details'))

  const second = rows[1].querySelector('button[title="Time and duration"]')
  second.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
  click(second)
  await wait(400)
  check('pressing another row\'s clock closes the first', !rows[0].querySelector('.task-details'))
  check('and opens the second in the same click', !!rows[1].querySelector('.task-details'),
    'the second panel did not open')
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  dom?.window?.close()
  for (const d of [DAY, NEXT]) {
    const day = await json(`/api/days/${d}`).catch(() => ({ tasks: [], sections: [] }))
    for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
    for (const s of day.sections) await del(`/api/sections/${s.id}`)
  }
  console.log(`cleanup: ${(await json(`/api/days/${DAY}`)).tasks.length} + ${(await json(`/api/days/${NEXT}`)).tasks.length} tasks left`)
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
