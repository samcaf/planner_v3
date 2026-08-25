/** Bands and runs of ordinary tasks interleave in one order. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2029-08-19'
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
  const sec = await post('/api/sections', { date: D, name: 'ZZ-weave', layout: 'columns' })
  const mk = async (title, extra = {}) =>
    (await post('/api/tasks', { title, scheduled_date: D, section_id: sec.id, ...extra })).id

  const t1 = await mk('ZZ One', { estimate_min: 5 })
  const t2 = await mk('ZZ Two', { estimate_min: 45 })
  const band = await mk('ZZ Band', { subsection: 1, estimate_min: 10 })
  const t3 = await mk('ZZ Three', { estimate_min: 45 })
  const band2 = await mk('ZZ Band Two', { subsection: 1, estimate_min: 10 })

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

  const panel = () => [...document.querySelectorAll('.panel')]
    .find((p) => /ZZ-weave/.test(p.querySelector('.panel-h')?.textContent || ''))

  // Blocks in document order: a band is .subsec, a run is a .box-cols that is
  // not inside one.
  const layout = () => {
    const body = panel()
    if (!body) return []
    const out = []
    for (const el of body.querySelectorAll('.subsec, .box-cols')) {
      if (el.classList.contains('subsec')) {
        out.push(`band:${el.querySelector('.subsec-head .task-title')?.textContent.trim()}`)
      } else if (!el.closest('.subsec')) {
        const names = [...el.querySelectorAll('.task-title')].map((t) => t.textContent.trim()).sort()
        out.push(`grid:[${names.join(',')}]`)
      }
    }
    return out
  }

  check('a run of tasks renders before the band that follows it',
    layout()[0]?.startsWith('grid:') && layout()[1] === 'band:ZZ Band',
    layout().join(' | '))
  check('and a second run renders after it',
    layout()[2]?.includes('ZZ Three'), layout().join(' | '))
  check('the two runs are separate grids, not one',
    layout().filter((b) => b.startsWith('grid:')).length === 2, layout().join(' | '))
  check('the first run holds only what precedes the band',
    layout()[0] === 'grid:[ZZ One,ZZ Two]', layout()[0])
  check('the second holds only what follows it',
    layout()[2] === 'grid:[ZZ Three]', layout()[2])
  check('the second band comes last', layout()[3] === 'band:ZZ Band Two', layout().join(' | '))

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
  const topOrder = async () => (await json(`/api/days/${D}`)).tasks
    .filter((t) => t.parent_id == null && t.kind !== 'note')
    .sort((a, b) => a.sort - b.sort || a.id - b.id).map((t) => t.title)

  // --- a task onto a band's TOP edge lands above it ------------------------
  const bandEl = () => [...document.querySelectorAll('.subsec')]
    .find((el) => el.querySelector('.subsec-head .task-title')?.textContent.trim() === 'ZZ Band')
  const topStrip = bandEl()?.querySelector('.subsec-edge.is-top')
  check('a band has a top edge strip', !!topStrip)

  const c1 = carrier()
  c1.setData('text/task-id', String(t3))
  const overEv = fire(topStrip, 'dragover', c1)
  check('the strip accepts a task drag', overEv.defaultPrevented)
  // The lit class comes from a state update, so it is a render away.
  await wait(200)
  const litStrip = bandEl()?.querySelector('.subsec-edge.is-top')
  check('and lights up while it is over', litStrip.className.includes('is-lit'), litStrip.className)
  fire(topStrip, 'drop', c1)
  await wait(1100)

  check('a task dropped on the top edge moves above the band',
    (await topOrder()).indexOf('ZZ Three') < (await topOrder()).indexOf('ZZ Band'),
    (await topOrder()).join(' | '))
  check('and joins the run above it',
    layout()[0] === 'grid:[ZZ One,ZZ Three,ZZ Two]', layout()[0])

  // --- a task onto the BOTTOM edge lands below -----------------------------
  const bottomStrip = bandEl()?.querySelector('.subsec-edge.is-bottom')
  check('a band has a bottom edge strip', !!bottomStrip)
  const c2 = carrier()
  c2.setData('text/task-id', String(t1))
  fire(bottomStrip, 'dragover', c2)
  fire(bottomStrip, 'drop', c2)
  await wait(1100)
  const ord = await topOrder()
  check('a task dropped on the bottom edge moves below the band',
    ord.indexOf('ZZ One') > ord.indexOf('ZZ Band'), ord.join(' | '))
  check('and the section now reads run, band, run',
    layout().filter((b) => b.startsWith('grid:')).length === 2
      && layout()[1] === 'band:ZZ Band', layout().join(' | '))

  // --- a band dropped on a run lands above that run ------------------------
  const grids = () => [...document.querySelectorAll('.box-cols')].filter((g) => !g.closest('.subsec'))
  const c3 = carrier()
  c3.setData('text/band-id', String(band2))
  const gridEv = fire(grids()[0], 'dragover', c3)
  check('a run accepts a band drag', gridEv.defaultPrevented)
  fire(grids()[0], 'drop', c3)
  await wait(1100)
  check('a band dropped on a run moves above it',
    (await topOrder())[0] === 'ZZ Band Two', (await topOrder()).join(' | '))
  check('so the band now leads the section',
    layout()[0] === 'band:ZZ Band Two', layout().join(' | '))

  // --- undo -----------------------------------------------------------------
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
  await wait(1200)
  check('Ctrl-Z puts the band back where it was',
    (await topOrder())[0] !== 'ZZ Band Two', (await topOrder()).join(' | '))

  // --- a band dropped on a band still reorders -----------------------------
  const c4 = carrier()
  c4.setData('text/band-id', String(band2))
  const b1 = [...document.querySelectorAll('.subsec')]
    .find((el) => el.querySelector('.subsec-head .task-title')?.textContent.trim() === 'ZZ Band')
  fire(b1, 'dragover', c4)
  fire(b1, 'drop', c4)
  await wait(1100)
  const ord2 = await topOrder()
  check('a band dropped on a band lands before it',
    ord2.indexOf('ZZ Band Two') < ord2.indexOf('ZZ Band'), ord2.join(' | '))

  check('nothing was accidentally nested',
    (await json(`/api/days/${D}`)).tasks.every((t) => t.parent_id == null),
    'a top-level row acquired a parent')
  void t2
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
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
