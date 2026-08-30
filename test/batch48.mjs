/** j and k keep to their column, then step out of the grid entirely. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-02-02'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  // Two sections. The first has work in two different boxes: quick things in
  // the first, a long thing in the third.
  const one = await post('/api/sections', { date: D, name: 'ZZ First', layout: 'columns' })
  const two = await post('/api/sections', { date: D, name: 'ZZ Second', layout: 'columns' })
  const q1 = await post('/api/tasks', { title: 'ZZ q1', scheduled_date: D, section_id: one.id, estimate_min: 5 })
  const q2 = await post('/api/tasks', { title: 'ZZ q2', scheduled_date: D, section_id: one.id, estimate_min: 5 })
  const deep = await post('/api/tasks', { title: 'ZZ deep', scheduled_date: D, section_id: one.id, estimate_min: 120 })
  const later = await post('/api/tasks', { title: 'ZZ later', scheduled_date: D, section_id: two.id, estimate_min: 5 })

  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e).slice(0, 140)))
  const dom = await JSDOM.fromURL(`${BASE}/day/${D}`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
      w.localStorage.setItem('vim_mode', '1')
    },
  })
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3400)

  const key = (k, init = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...init,
  }))
  const onTask = () => {
    const el = document.querySelector('.task.vim-on')
    return el ? Number(el.dataset.taskId) : null
  }
  const onSection = () => document.querySelector('.panel.section.vim-on-section')?.dataset.sectionId || null
  const colOf = () => {
    const el = document.querySelector('.task.vim-on')?.closest('.box-col')
    if (!el) return null
    return [...el.parentElement.children].filter((c) => c.classList.contains('box-col')).indexOf(el)
  }
  const walkTo = async (id) => {
    key('g'); await wait(90); key('g'); await wait(200)
    for (let i = 0; i < 24 && onTask() !== id; i++) { key('j'); await wait(160) }
    return onTask() === id
  }

  for (let i = 0; i < 150 && onTask() === null && onSection() === null; i++) await wait(150)

  check('the two quick tasks are in the first box', await walkTo(q1.id) && colOf() === 0,
    `col ${colOf()}`)
  key('j'); await wait(250)
  check('j moves down inside that box', onTask() === q2.id && colOf() === 0,
    `task ${onTask()} col ${colOf()}`)

  // The long task is in the third box; plain j must NOT walk into it.
  key('j'); await wait(300)
  check('j at the foot of a box does not slide into the box beside it',
    onTask() !== deep.id, `landed on ${onTask()} in col ${colOf()}`)
  check('it leaves the section instead', onSection() === String(two.id) || onTask() === later.id,
    `section=${onSection()} task=${onTask()}`)

  // h and l are what cross boxes.
  check('back on a quick task', await walkTo(q1.id), `${onTask()}`)
  key('l'); await wait(300)
  check('l is what reaches the box beside it', onTask() === deep.id && colOf() === 2,
    `task ${onTask()} col ${colOf()}`)
  key('h'); await wait(300)
  check('and h comes back', colOf() === 0, `col ${colOf()}`)

  // Upward, the same: out of the box to the heading above it, not sideways.
  check('on the long task', await walkTo(q1.id) && (key('l'), await wait(250), onTask() === deep.id),
    `${onTask()}`)
  key('k'); await wait(300)
  check('k at the top of a box leaves the grid rather than crossing it',
    onSection() === String(one.id) || onTask() === null,
    `section=${onSection()} task=${onTask()}`)

  // ── > and < step the priority ---------------------------------------------
  const pri = async () => (await json(`/api/tasks/${q1.id}`)).priority
  check('back on a quick task for the priority', await walkTo(q1.id), `${onTask()}`)
  check('it starts at medium', (await pri()) === 'medium', await pri())
  key('>'); await wait(1000)
  check('> raises the priority', (await pri()) === 'high', await pri())
  key('>'); await wait(1000)
  check('and again to the top', (await pri()) === 'highest', await pri())
  key('>'); await wait(900)
  check('but never past it', (await pri()) === 'highest', await pri())

  key('<'); await wait(1000)
  check('< lowers it again', (await pri()) === 'high', await pri())
  for (let i = 0; i < 4; i++) { key('<'); await wait(700) }
  check('down to the bottom and no further', (await pri()) === 'lowest', await pri())

  // ── the brackets took the day-shifting -------------------------------------
  check('still on it', await walkTo(q1.id), `${onTask()}`)
  key(']'); await wait(1400)
  check('] moves the task to the next day',
    (await json(`/api/tasks/${q1.id}`)).scheduled_date === '2031-02-03',
    (await json(`/api/tasks/${q1.id}`)).scheduled_date)

  check('no key threw', errors.length === 0, errors.slice(0, 2).join(' | '))
  void later
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  for (const when of [D, '2031-02-03']) {
    const day = await json(`/api/days/${when}`).catch(() => ({ tasks: [], sections: [] }))
    for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
    for (const s of day.sections) await del(`/api/sections/${s.id}`)
  }
  console.log('cleanup: probe day cleared')
  for (const d of doms) { try { d.window.close() } catch {} }
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
