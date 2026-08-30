/** Comments show on the row, are written from it, and leave the notes alone. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-04-11'
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

  // Before the page loads: jsdom has no working location.reload, so anything
  // created afterwards would never reach the client.
  await post(`/api/tasks/${src.id}/comments`, { author: 'claude', body: 'from the agent' })

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
    for (let i = 0; i < 24 && onTask() !== id; i++) { key('n'); await wait(160) }
    return onTask() === id
  }

  for (let i = 0; i < 150 && onTask() === null && onSection() === null; i++) await wait(150)

  // The count rides down with the day, so the chip can appear without asking.
  const dayNow = await json(`/api/days/${D}`)
  check('the day payload carries the count',
    dayNow.tasks.find((t) => t.id === src.id)?.comment_count === 1,
    String(dayNow.tasks.find((t) => t.id === src.id)?.comment_count))

  for (let i = 0; i < 60 && !document.querySelector(`.task[data-task-id="${src.id}"]`); i++) await wait(150)

  const row = () => document.querySelector(`.task[data-task-id="${src.id}"]`)
  const chip = () => row()?.querySelector('.task-comments .chip')
  check('a chip appears on the row', !!chip(), row() ? 'row but no chip' : 'no row')
  check('showing how many', /1/.test(chip()?.textContent || ''), chip()?.textContent)

  chip()?.click()
  await wait(900)
  const body = row()?.querySelector('.tc-body')
  check('clicking it opens the thread', !!body)
  check('the comment is there', /from the agent/.test(body?.textContent || ''), body?.textContent?.slice(0, 120))
  check('attributed', /claude/.test(body?.textContent || ''), body?.textContent?.slice(0, 120))

  // ── writing one from the app ---------------------------------------------
  const box = row()?.querySelector('.tc-add textarea')
  check('there is somewhere to write one', !!box,
    row()?.querySelector('.tc-add')?.innerHTML?.slice(0, 160))
  const setV = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setV.call(box, 'written by hand')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))
  await wait(400)
  const send = [...row().querySelectorAll('.tc-add button')].find((b) => /comment/i.test(b.textContent))
  check('and a button to send it', !!send && !send.disabled, send ? 'disabled' : 'missing')
  send?.click()
  await wait(1200)

  const stored = await json(`/api/tasks/${src.id}/comments`)
  check('it is stored', stored.some((c) => c.body === 'written by hand'),
    stored.map((c) => c.body).join(' | '))
  check('as mine, not the agent\'s',
    stored.find((c) => c.body === 'written by hand')?.author === 'me',
    stored.find((c) => c.body === 'written by hand')?.author)

  // ── and none of it touched the notes -------------------------------------
  const task = await json(`/api/tasks/${src.id}`)
  check('the notes are untouched', task.notes === 'note here', task.notes)

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
