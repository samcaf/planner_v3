/** Flagging a task as code work, from the row and from vim. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-04-09'
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
  const one = await post('/api/sections', { date: D, name: 'ZZ One', layout: 'columns' })
  const two = await post('/api/sections', { date: D, name: 'ZZ Two', layout: 'columns' })
  const three = await post('/api/sections', { date: D, name: 'ZZ Three', layout: 'columns' })
  const src = await post('/api/tasks', {
    title: 'ZZ source', scheduled_date: D, section_id: one.id, estimate_min: 5, notes: 'note here',
  })
  await post('/api/tasks', { title: 'ZZ other', scheduled_date: D, section_id: two.id, estimate_min: 5 })

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
      Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: async (t) => { w.__clip = t } }, configurable: true,
      })
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
  const aim = async (id, title) => {
    key('Escape'); await wait(120)
    key('/'); await wait(250)
    const box = document.querySelector('.vim-cmd-input')
    if (!box) return false
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(box, title)
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    box.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await wait(600)
    for (let i = 0; i < 8 && onTask() !== id; i++) { key('n'); await wait(140) }
    return onTask() === id
  }

  for (let i = 0; i < 150 && onTask() === null && onSection() === null; i++) await wait(150)

  const openBtn = [...document.querySelectorAll(`.task[data-task-id="${src.id}"] button`)]
    .find((b) => /time and duration/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || ''))
  check('found the details button', !!openBtn,
    [...document.querySelectorAll(`.task[data-task-id="${src.id}"] button`)]
      .map((b) => b.getAttribute('title')).join(' | '))
  openBtn?.click()
  await wait(700)

  const boxes = [...document.querySelectorAll(`.task[data-task-id="${src.id}"] .task-details label`)]
  check('the details panel opened', boxes.length > 0, `${boxes.length} labels`)
  const codeBox = boxes.find((l) => /code task/i.test(l.textContent))
  check('there is a Code task checkbox', !!codeBox, boxes.map((b) => b.textContent).join(' | '))

  codeBox?.querySelector('input')?.click()
  await wait(900)
  const after = await json(`/api/tasks/${src.id}`)
  check('ticking it flags the task', after.is_code === 1, String(after.is_code))
  check('and a chip appears on the row',
    !!document.querySelector(`.task[data-task-id="${src.id}"] .chip.c-purple`),
    [...document.querySelectorAll(`.task[data-task-id="${src.id}"] .chip`)].map((c) => c.textContent).join(','))

  // ── and from the command line -------------------------------------------
  key('Escape'); await wait(200)
  check('aimed at it', await aim(src.id, 'ZZ source'), `${onTask()}`)
  key(':'); await wait(260)
  const box = document.querySelector('.vim-cmd-input')
  const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setV.call(box, 'code')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))
  box.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await wait(1000)
  const off = await json(`/api/tasks/${src.id}`)
  check(':code toggles it back off', off.is_code === 0, String(off.is_code))

  check('no key threw', errors.length === 0, errors.join(' | '))
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
