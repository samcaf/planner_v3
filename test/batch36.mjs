/** The backlog boards drag and drop like the day view, because they share it. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
let projectId = null

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

const carrier = () => {
  const store = new Map(); const types = []
  return {
    types,
    setData: (k, v) => { store.set(k, v); if (!types.includes(k)) types.push(k) },
    getData: (k) => store.get(k) || '', effectAllowed: '', dropEffect: '',
  }
}
const fire = (window, el, type, data, extra = {}) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true })
  ev.dataTransfer = data
  Object.assign(ev, extra)
  el.dispatchEvent(ev)
  return ev
}
// jsdom does no layout, so a row's rect is all zeros and the before/nest/after
// zones cannot be told apart. Stubbing one is what makes an edge drop mean
// "reorder" rather than landing in whichever zone zero happens to select.
const stubRect = (el, top = 100, height = 40) => {
  el.getBoundingClientRect = () => ({
    top, height, bottom: top + height, left: 0, right: 200, width: 200, x: 0, y: top,
  })
}

try {
  const proj = await post('/api/projects', { name: 'ZZ BoardProj' })
  projectId = proj.id
  const mk = async (title, estimate_min) =>
    (await post('/api/tasks', { title, project_id: proj.id, estimate_min })).id
  const a = await mk('ZZ ba', 5)
  const b = await mk('ZZ bb', 120)
  const c = await mk('ZZ bc', 5)

  // ------------------------------------------------ project's backlog board
  let errors = []
  let dom = await openPage(`${BASE}/projects/${proj.id}?tab=backlog`, errors)
  doms.push(dom)
  let { window } = dom
  let { document } = window
  await wait(3200)
  check('project backlog: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const board = document.querySelector('.box-cols')
  check('the backlog draws as a three-column board', !!board)
  check('its rows are draggable, like the day view',
    [...document.querySelectorAll('.box-col .task')].every((r) => r.getAttribute('draggable') === 'true'),
    [...document.querySelectorAll('.box-col .task')].map((r) => r.getAttribute('draggable')).join(','))
  check('each column has a tail to drop onto',
    document.querySelectorAll('.box-col .box-col-tail').length === 3,
    `${document.querySelectorAll('.box-col .box-col-tail').length}`)

  // --- drop into a column ---------------------------------------------------
  const colOf = (name) => [...document.querySelectorAll('.box-col')]
    .findIndex((col) => [...col.querySelectorAll('.task-title')]
      .some((t) => t.textContent.trim() === name))
  check('a 5-minute task starts in the first column', colOf('ZZ ba') === 0, `${colOf('ZZ ba')}`)

  const third = document.querySelectorAll('.box-col')[2]
  const c1 = carrier(); c1.setData('text/task-id', String(a))
  fire(window, third, 'dragover', c1)
  fire(window, third, 'drop', c1)
  await wait(1100)
  check('dropping it in the third column moves it there',
    (await json(`/api/tasks/${a}`)).col_index === 2,
    `col_index=${(await json(`/api/tasks/${a}`)).col_index}`)
  check('and it does not pick up a date it never had',
    (await json(`/api/tasks/${a}`)).scheduled_date === null,
    `${(await json(`/api/tasks/${a}`)).scheduled_date}`)

  // --- drop onto a row to nest ---------------------------------------------
  const rowFor = (name) => [...document.querySelectorAll('.box-col .task')]
    .find((r) => r.querySelector('.task-title')?.textContent.trim() === name)
  const target = rowFor('ZZ bb')
  check('the target row is on the board', !!target)
  stubRect(target, 100, 40)
  const c2 = carrier(); c2.setData('text/task-id', String(c))
  // Mid-height is the nest zone.
  fire(window, target, 'dragover', c2, { clientY: 120 })
  await wait(150)
  fire(window, target, 'drop', c2, { clientY: 120 })
  await wait(1200)
  check('dropping one row onto the middle of another nests it',
    (await json(`/api/tasks/${c}`)).parent_id === b,
    `parent_id=${(await json(`/api/tasks/${c}`)).parent_id} want ${b}`)

  // --- and the row-level drop is what used to be missing entirely ----------
  check('the board rows accept drops at all',
    (await json(`/api/tasks/${c}`)).parent_id !== null,
    'a row drop still does nothing')

  // ------------------------------------------------- all-tasks backlog board
  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/tasks?view=backlog`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3500)
  check('all-tasks backlog: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const panel = [...document.querySelectorAll('.panel')]
    .find((p) => /ZZ BoardProj/.test(p.querySelector('.panel-h')?.textContent || ''))
  check('the project has a board there too', !!panel?.querySelector('.box-cols'))
  check('with draggable rows',
    [...(panel?.querySelectorAll('.box-col .task') || [])]
      .every((r) => r.getAttribute('draggable') === 'true'),
    'rows are not draggable')

  const cols = [...(panel?.querySelectorAll('.box-col') || [])]
  const c3 = carrier(); c3.setData('text/task-id', String(a))
  fire(window, cols[1], 'dragover', c3)
  fire(window, cols[1], 'drop', c3)
  await wait(1200)
  check('a column drop works here as well',
    (await json(`/api/tasks/${a}`)).col_index === 1,
    `col_index=${(await json(`/api/tasks/${a}`)).col_index}`)
  check('and still no date is invented',
    (await json(`/api/tasks/${a}`)).scheduled_date === null,
    `${(await json(`/api/tasks/${a}`)).scheduled_date}`)
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
  if (projectId) {
    const rows = await json(`/api/tasks?project_id=${projectId}`).catch(() => [])
    for (const t of rows) await del(`/api/tasks/${t.id}`)
    await del(`/api/projects/${projectId}`)
  }
  console.log('cleanup: probe project removed')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
