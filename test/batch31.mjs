/** Sub-section bands reorder relative to one another. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2029-07-08'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const sec = await post('/api/sections', { date: D, name: 'ZZ-bands', layout: 'columns' })
  const mk = async (title, extra = {}) =>
    (await post('/api/tasks', { title, scheduled_date: D, section_id: sec.id, ...extra })).id

  const bandA = await mk('ZZ Band A', { subsection: 1, estimate_min: 10 })
  const bandB = await mk('ZZ Band B', { subsection: 1, estimate_min: 10 })
  const bandC = await mk('ZZ Band C', { subsection: 1, estimate_min: 10 })
  const kidA = await mk('ZZ Kid A', { estimate_min: 20 })
  await post(`/api/tasks/${kidA}/nest`, { parent_id: bandA })
  const plain = await mk('ZZ Plain', { estimate_min: 45 })

  const vc = new VirtualConsole()
  const errors = []
  vc.on('jsdomError', (e) => errors.push(e.message))
  dom = await JSDOM.fromURL(`${BASE}/day/${D}`, {
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
  const { window } = dom
  const { document } = window
  await wait(3200)
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const bands = () => [...document.querySelectorAll('.subsec')]
  const headOf = (el) => el.querySelector('.subsec-head .task-title')?.textContent.trim()
  const order = () => bands().map(headOf)

  check('all three bands render', bands().length === 3, `${bands().length}`)
  check('in the order they were made',
    order().join(' | ') === 'ZZ Band A | ZZ Band B | ZZ Band C', order().join(' | '))

  const grip = bands()[0]?.querySelector('.subsec-grip')
  check('each band has a drag grip', !!grip)
  check('a band is not draggable until the grip is held',
    bands()[0]?.getAttribute('draggable') !== 'true', bands()[0]?.getAttribute('draggable'))
  grip?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
  await wait(150)
  check('holding the grip arms it', bands()[0]?.getAttribute('draggable') === 'true')

  const carrier = () => {
    const store = new Map()
    const types = []
    return {
      types,
      setData: (k, v) => { store.set(k, v); if (!types.includes(k)) types.push(k) },
      getData: (k) => store.get(k) || '',
      effectAllowed: '', dropEffect: '',
    }
  }
  const fire = (el, type, data) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true })
    ev.dataTransfer = data
    el.dispatchEvent(ev)
    return ev
  }

  // Drag A onto C.
  const c1 = carrier()
  fire(bands()[0], 'dragstart', c1)
  check('the dragged band puts its id on the dataTransfer',
    c1.getData('text/band-id') === String(bandA), c1.getData('text/band-id'))
  fire(bands()[2], 'dragover', c1)
  fire(bands()[2], 'drop', c1)
  await wait(1000)

  check('dropping one band on another reorders them',
    order().join(' | ') === 'ZZ Band B | ZZ Band C | ZZ Band A', order().join(' | '))

  const stored = (await json(`/api/days/${D}`)).tasks
    .filter((t) => t.subsection).sort((a, b) => a.sort - b.sort).map((t) => t.title)
  check('and the new order is what the server has',
    stored.join(' | ') === 'ZZ Band B | ZZ Band C | ZZ Band A', stored.join(' | '))

  check('the band keeps its child through the move',
    (await json(`/api/tasks/${kidA}`)).parent_id === bandA)
  check('an ordinary task is still in the grid',
    [...document.querySelectorAll('.box-cols')].some((g) => !g.closest('.subsec')
      && [...g.querySelectorAll('.task-title')].some((t) => t.textContent.trim() === 'ZZ Plain')),
    'ZZ Plain not found in the main grid')

  // Ctrl-Z must put it back.
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
  await wait(1200)
  check('Ctrl-Z restores the previous order',
    order().join(' | ') === 'ZZ Band A | ZZ Band B | ZZ Band C', order().join(' | '))

  // A task drag must not be mistaken for a band drag. defaultPrevented is not
  // the test — the section's own drop zone is an ancestor and legitimately
  // accepts task drops, so it is prevented either way. What matters is that the
  // band order does not change.
  const wasOrder = order().join(' | ')
  const taskCarrier = carrier()
  taskCarrier.setData('text/task-id', String(plain))
  fire(bands()[0], 'dragover', taskCarrier)
  fire(bands()[0], 'drop', taskCarrier)
  await wait(900)
  check('a plain task drag does not reorder the bands',
    order().join(' | ') === wasOrder, `${wasOrder} -> ${order().join(' | ')}`)
  check('and the task is not swallowed as a band',
    (await json(`/api/tasks/${plain}`)).subsection !== 1)
  void bandB; void bandC
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  dom?.window?.close()
  const day = await json(`/api/days/${D}`).catch(() => ({ tasks: [], sections: [] }))
  for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
  for (const s of day.sections) await del(`/api/sections/${s.id}`)
  console.log('cleanup: probe day cleared')
}
