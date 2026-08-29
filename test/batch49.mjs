/** Cut and paste whole tasks, send one to the backlog, and land the cursor. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-03-03'
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
  const sec = await post('/api/sections', { date: D, name: 'ZZ Sec', layout: 'columns' })
  const a = await post('/api/tasks', {
    title: 'ZZ alpha', scheduled_date: D, section_id: sec.id, estimate_min: 5,
    notes: 'alpha note', priority: 'high',
  })
  const b = await post('/api/tasks', { title: 'ZZ bravo', scheduled_date: D, section_id: sec.id, estimate_min: 5 })
  const c = await post('/api/tasks', { title: 'ZZ charlie', scheduled_date: D, section_id: sec.id, estimate_min: 5 })

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
  const titles = async () => (await json(`/api/days/${D}`)).tasks
    .filter((t) => t.kind !== 'note').map((t) => t.title)
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

  // ── yy then p rebuilds the task, not one per character ---------------------
  check('aimed at alpha', await aim(a.id, 'ZZ alpha'), `${onTask()}`)
  key('y'); await wait(120); key('y'); await wait(700)
  check('yy still puts the text on the clipboard',
    window.__clip === 'ZZ alpha\nalpha note', JSON.stringify(window.__clip))

  const before = (await titles()).length
  key('p'); await wait(1600)
  const after = await titles()
  check('p makes exactly one task, not one per character',
    after.length === before + 1, `${before} -> ${after.length}`)
  const copy = (await json(`/api/days/${D}`)).tasks.find(
    (t) => t.title === 'ZZ alpha' && t.id !== a.id,
  )
  check('the copy carries the title', !!copy, after.join(','))
  check('and the note with it', copy?.notes === 'alpha note', copy?.notes)
  check('and the priority', copy?.priority === 'high', copy?.priority)
  // Left in place. Deleting it through the API would take a row off the server
  // that the page still has on screen, and the next keystroke would then aim at
  // something that no longer exists — a fault in the test, not in the app.
  // The cleanup at the end sweeps it.
  await wait(600)

  // ── DD cuts, and p puts it back --------------------------------------------
  check('aimed at bravo', await aim(b.id, 'ZZ bravo'), `${onTask()}`)
  // Whatever is actually above it in its own box — which after the paste above
  // is the copy, not the original.
  const above = (() => {
    const row = document.querySelector(`.task[data-task-id="${b.id}"]`)
    const col = row?.closest('.box-col')
    const ids = [...(col?.querySelectorAll('.task[data-task-id]') || [])]
      .map((r) => Number(r.dataset.taskId))
    const at = ids.indexOf(b.id)
    return at > 0 ? ids[at - 1] : null
  })()
  check('there is a row above it', above !== null, 'bravo is first in its box')

  key('D'); await wait(120); key('D'); await wait(1500)
  check('DD removes the task', !(await titles()).includes('ZZ bravo'), (await titles()).join(','))
  check('and the cursor lands on the row above, not nowhere',
    onTask() === above, `task=${onTask()} want=${above} section=${onSection()}`)

  key('p'); await wait(1600)
  check('p puts a cut task back', (await titles()).includes('ZZ bravo'), (await titles()).join(','))

  // ── DD on the first row falls back to the section --------------------------
  check('aimed at the first row', await aim(a.id, 'ZZ alpha'), `${onTask()}`)
  key('D'); await wait(120); key('D'); await wait(1500)
  check('with nothing above it, the section is selected',
    onSection() === String(sec.id), `task=${onTask()} section=${onSection()}`)
  key('u'); await wait(1400)
  check('u brings it back', (await titles()).includes('ZZ alpha'), (await titles()).join(','))

  // ── bb sends a task to the backlog -----------------------------------------
  check('aimed at charlie', await aim(c.id, 'ZZ charlie'), `${onTask()}`)
  key('b'); await wait(120); key('b'); await wait(1600)
  const gone = await json(`/api/tasks/${c.id}`)
  check('bb takes the date off the task', gone.scheduled_date === null, `${gone.scheduled_date}`)
  check('so it leaves the day', !(await titles()).includes('ZZ charlie'), (await titles()).join(','))
  check('and the cursor has somewhere to be',
    onTask() !== null || onSection() !== null, 'the cursor was lost')
  key('u'); await wait(1500)
  check('u brings it back to the day', (await json(`/api/tasks/${c.id}`)).scheduled_date === D,
    (await json(`/api/tasks/${c.id}`)).scheduled_date)

  check('no key threw', errors.length === 0, errors.slice(0, 2).join(' | '))
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
  // Anything bb sent to the backlog has no date, so the day sweep misses it.
  for (const t of await json('/api/tasks?backlog=1').catch(() => [])) {
    if (String(t.title).startsWith('ZZ ')) await del(`/api/tasks/${t.id}`)
  }
  console.log('cleanup: probe rows removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
