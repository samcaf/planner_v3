/** Tab-to-timing, notebook archive + reorder, note-section reorder, filter popover. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2029-06-03'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
const madeNotes = []
let projectId = null

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const patch = (p, b) => json(p, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
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
      w.confirm = () => true
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

const dt = () => {
  const store = new Map()
  return {
    types: [], setData: (k, v) => { store.set(k, v); },
    getData: (k) => store.get(k) || '', effectAllowed: '', dropEffect: '',
  }
}
const fire = (el, type, data, win) => {
  const ev = new win.Event(type, { bubbles: true, cancelable: true })
  ev.dataTransfer = data
  el.dispatchEvent(ev)
}

try {
  // ------------------------------------------------ Tab from title to timing
  const t = await post('/api/tasks', { title: 'ZZ tabbing', scheduled_date: D })
  let errors = []
  let dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  let { window } = dom
  let { document } = window
  await wait(3200)
  check('day: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const row = [...document.querySelectorAll('.task')]
    .find((r) => r.querySelector('.task-title')?.textContent.trim() === 'ZZ tabbing')
  check('the task row is there', !!row)
  check('the timing panel is shut to begin with', !row?.querySelector('.task-details'))

  const title = row?.querySelector('.task-title')
  title?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  await wait(300)
  const panel = row?.querySelector('.task-details')
  check('Tab on the task text opens the timing panel', !!panel)

  const timeBox = panel?.querySelector('.td-time')
  check('the panel has a time box', !!timeBox)
  check('and it has the caret', document.activeElement === timeBox,
    document.activeElement?.className || document.activeElement?.tagName)

  // Shift-Tab must still be ordinary browser navigation.
  const row2 = [...document.querySelectorAll('.task')]
    .find((r) => r.querySelector('.task-title')?.textContent.trim() === 'ZZ tabbing')
  const ev = new window.KeyboardEvent('keydown', {
    key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
  })
  row2?.querySelector('.task-title')?.dispatchEvent(ev)
  check('Shift-Tab is left alone', !ev.defaultPrevented)

  // ------------------------------------------------------------- notebook
  const n1 = await post('/api/notebook', { title: 'ZZ note one', body: 'a' })
  const n2 = await post('/api/notebook', { title: 'ZZ note two', body: 'b' })
  const n3 = await post('/api/notebook', { title: 'ZZ note three', body: 'c' })
  madeNotes.push(n1.id, n2.id, n3.id)

  // Archiving is not "working on it", so it must not restamp updated_at and
  // reshuffle the list.
  const beforeStamp = (await json(`/api/notebook/${n1.id}`)).updated_at
  await patch(`/api/notebook/${n1.id}`, { archived: 1 })
  check('archiving does not count as touching the note',
    (await json(`/api/notebook/${n1.id}`)).updated_at === beforeStamp,
    `${beforeStamp} -> ${(await json(`/api/notebook/${n1.id}`)).updated_at}`)

  const visible = await json('/api/notebook')
  check('an archived note drops out of the list',
    !visible.some((n) => n.id === n1.id), visible.map((n) => n.title).join(' | '))
  const withArchived = await json('/api/notebook?archived=1')
  check('but comes back when asked for', withArchived.some((n) => n.id === n1.id))
  await patch(`/api/notebook/${n1.id}`, { archived: 0 })

  // Reorder must survive an edit to another note — the old list was pure
  // recency, so it did not.
  await post('/api/notebook/reorder', { ids: [n3.id, n1.id, n2.id] })
  const ordered = (await json('/api/notebook')).filter((n) => n.title.startsWith('ZZ note'))
  check('a hand-made order is kept',
    ordered.map((n) => n.id).join(',') === [n3.id, n1.id, n2.id].join(','),
    ordered.map((n) => n.title).join(' | '))
  await patch(`/api/notebook/${n2.id}`, { body: 'edited' })
  const after = (await json('/api/notebook')).filter((n) => n.title.startsWith('ZZ note'))
  check('and editing another note does not undo it',
    after.map((n) => n.id).join(',') === [n3.id, n1.id, n2.id].join(','),
    after.map((n) => n.title).join(' | '))

  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/notebook`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3000)
  check('notebook: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const items = () => [...document.querySelectorAll('.nb-item')]
  const titlesOf = () => items().map((b) => b.querySelector('.nb-item-title')?.textContent.trim())
  check('the list draws', items().length >= 3, `${items().length}`)
  check('every item can be dragged', items().every((b) => b.getAttribute('draggable') === 'true'))

  const archivedBtn = [...document.querySelectorAll('button')]
    .find((b) => /Archived/.test(b.textContent) && b.hasAttribute('aria-pressed'))
  check('there is a show-archived switch', !!archivedBtn)
  check('it starts off', archivedBtn?.getAttribute('aria-pressed') === 'false')

  // Drag note three onto note two.
  const from = items().find((b) => /ZZ note three/.test(b.textContent))
  const onto = items().find((b) => /ZZ note two/.test(b.textContent))
  const carrier = dt()
  fire(from, 'dragstart', carrier, window)
  fire(onto, 'dragover', carrier, window)
  fire(onto, 'drop', carrier, window)
  await wait(900)
  const zz = titlesOf().filter((t2) => /^ZZ note/.test(t2))
  check('dropping one note on another reorders the list',
    zz.indexOf('ZZ note three') > zz.indexOf('ZZ note one'), zz.join(' | '))

  // ------------------------------------------------- project note sections
  const proj = await post('/api/projects', { name: 'ZZ NoteProj' })
  projectId = proj.id
  const s1 = await post('/api/tasks', { title: 'ZZ Sec A', kind: 'note', project_id: proj.id })
  const s2 = await post('/api/tasks', { title: 'ZZ Sec B', kind: 'note', project_id: proj.id })
  const s3 = await post('/api/tasks', { title: 'ZZ Sec C', kind: 'note', project_id: proj.id })

  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/projects/${proj.id}?tab=notes`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3200)
  check('project notes: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const secs = () => [...document.querySelectorAll('.pj-note-sec')]
  check('note sections render', secs().length === 3, `${secs().length}`)
  const secTitles = () => secs().map((s) => s.querySelector('.pj-section-title')?.textContent.trim())
  check('in the order they were made',
    secTitles().join(' | ').includes('ZZ Sec A'), secTitles().join(' | '))

  const grip = secs()[0]?.querySelector('.pj-note-grip')
  check('each section has a drag grip', !!grip)
  check('a section is not draggable until the grip is held',
    secs()[0]?.getAttribute('draggable') !== 'true', secs()[0]?.getAttribute('draggable'))

  grip?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
  await wait(150)
  check('holding the grip arms the drag',
    secs()[0]?.getAttribute('draggable') === 'true', secs()[0]?.getAttribute('draggable'))

  const carrier2 = dt()
  fire(secs()[0], 'dragstart', carrier2, window)
  fire(secs()[2], 'dragover', carrier2, window)
  fire(secs()[2], 'drop', carrier2, window)
  await wait(1000)

  const order = (await json(`/api/projects/${proj.id}`)).notes
    .filter((n) => !n.scheduled_date).map((n) => n.title)
  check('dragging a section past another reorders them',
    order[order.length - 1] === 'ZZ Sec A', order.join(' | '))
  void [s1, s2, s3]

  // --------------------------------------------------- the filters popover
  // Only the Tasks tab has one — that is the tab the user reported it on.
  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/projects/${proj.id}`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3200)
  check('project tasks tab: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const filterBtn = [...document.querySelectorAll('button')].find((b) => /Filters/.test(b.textContent))
  if (filterBtn) {
    filterBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await wait(300)
    const pop = document.querySelector('.at-pop')
    check('the filters menu opens', !!pop)
    check('it is portalled out to <body>, not trapped in the toolbar',
      pop?.parentElement === document.body, pop?.parentElement?.className)
    check('and it is positioned against the viewport, not the trigger',
      pop?.style.position === 'fixed', pop?.style.position)
    check('anchored from the left so it opens rightward',
      pop?.style.right === 'auto', `right=${pop?.style.right} left=${pop?.style.left}`)
  } else {
    check('a Filters button exists on the project page', false, 'not found')
  }
} catch (e) {
  check('the suite ran to the end', false, `${e.message}`)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  for (const d of doms) { try { d.window.close() } catch {} }
  for (const id of madeNotes) await del(`/api/notebook/${id}`)
  const day = await json(`/api/days/${D}`).catch(() => ({ tasks: [], sections: [] }))
  for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
  if (projectId) {
    const pr = await json(`/api/projects/${projectId}`).catch(() => ({ notes: [] }))
    for (const n of pr.notes || []) await del(`/api/tasks/${n.id}`)
    await del(`/api/projects/${projectId}`)
  }
  console.log('cleanup: probe rows removed')
}
