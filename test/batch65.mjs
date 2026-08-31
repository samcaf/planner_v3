/**
 * The day's side column, from the keyboard.
 *
 * Routines, what is in progress and the backlog are all on the day view and
 * none of them could be reached without the mouse — so the two things you most
 * often want to do from the keys, pull a backlog item onto the day and add a
 * routine, were the two you could not. This drives the real rows: that they are
 * stops at all, that Tab and l get between the two columns, and that Enter
 * presses whichever control the row is actually offering.
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-11-12'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
const tasks = []
let routineId = null
const sections = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  // One task on the day, so the cursor has somewhere to start.
  const onDay = await post('/api/tasks', { title: 'ZZ on the day', scheduled_date: D })
  tasks.push(onDay.id)

  // A routine that applies on every weekday, so it is offered whatever day D is.
  const routine = await post('/api/routines', { name: 'ZZ side probe', weekdays: '', active: 1 })
  routineId = routine.id
  await post(`/api/routines/${routine.id}/items`, { title: 'ZZ routine step' })

  // A backlog branch: a parent with a child under it. Bringing the CHILD onto
  // the day has to bring a copy of the parent with it, or it arrives as a bare
  // title with nothing saying what it belonged to.
  const parent = await post('/api/tasks', { title: 'ZZ backlog parent' })
  const child = await post('/api/tasks', { title: 'ZZ backlog child' })
  tasks.push(parent.id, child.id)
  await post(`/api/tasks/${child.id}/nest`, { parent_id: parent.id })

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
      // The banner is fixed over the whole screen and would swallow the clicks
      // below; D is far in the future, so it never fires anyway.
      w.localStorage.setItem(`day_start:${D}`, '1')
    },
  })
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3600)

  const key = (k, init = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...init,
  }))
  const click = (el) => el?.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true }),
  )
  /** The stop the cursor is on, whichever of the four kinds it is. */
  const at = () => {
    const el = document.querySelector('.vim-on, .vim-on-section, .vim-on-card')
    if (!el) return null
    return el.dataset.act || el.dataset.taskId || (el.dataset.sectionId && `s${el.dataset.sectionId}`)
  }
  const side = () => !!document.querySelector('.day-aside .vim-on, .day-aside .vim-on-section')
  const rowSaying = (text) => [...document.querySelectorAll('.day-aside .task, .day-aside .row')]
    .find((el) => el.textContent.includes(text))

  check('the mode is on', !!document.querySelector('.vim-bar'))
  check('the cursor starts on the day', !!at() && !side(), String(at()))

  // ── getting there ---------------------------------------------------------
  key('Tab'); await wait(420)
  check('Tab steps into the side column', side(), String(at()))
  check('and lands on a row that is a button, not a task',
    String(at()).startsWith('!'), String(at()))

  key('Tab'); await wait(420)
  check('Tab comes back to the day', !side(), String(at()))

  // l walks the boxes and then out of them, which is where the side column is.
  for (let i = 0; i < 6 && !side(); i++) { key('l'); await wait(220) }
  check('l reaches the side column too', side(), String(at()))
  key('h'); await wait(320)
  check('h comes back from it', !side(), String(at()))

  // ── a routine, added from the keyboard ------------------------------------
  const routineRow = rowSaying('ZZ side probe')
  check('the routine is drawn in the side column', !!routineRow)
  check('it names itself as an action row',
    routineRow?.dataset.act === `!routine:${routine.id}`, routineRow?.dataset.act || '')

  // Clicking any stop puts the cursor on it — including one that is not a task.
  click(routineRow)
  await wait(360)
  check('clicking it moves the cursor there', at() === `!routine:${routine.id}`, String(at()))

  key('Enter'); await wait(1500)
  const dayNow = await json(`/api/days/${D}`)
  const made = dayNow.sections.find((s) => s.name === 'ZZ side probe')
  if (made) sections.push(made.id)
  check('Enter on a routine adds it to the day', !!made,
    dayNow.sections.map((s) => s.name).join(', '))

  // ── a backlog row, scheduled from the keyboard ----------------------------
  // The branch arrives folded — that is what stops one set-aside item burying
  // the rest of the backlog — so open it before reaching for the child.
  const parentRow = rowSaying('ZZ backlog parent')
  check('the backlog parent is a stop',
    parentRow?.dataset.taskId === String(parent.id), parentRow?.dataset.taskId || '')
  click(parentRow?.querySelector('.task-twist'))
  await wait(500)

  const childRow = rowSaying('ZZ backlog child')
  check('its child is a stop once it is open',
    childRow?.dataset.taskId === String(child.id), childRow?.dataset.taskId || '')

  click(childRow)
  await wait(360)
  check('the cursor goes to the backlog row', at() === String(child.id), String(at()))

  key('Enter'); await wait(1600)
  const after = await json(`/api/days/${D}`)
  const landed = after.tasks.find((t) => t.id === child.id)
  check('Enter on a backlog row brings it onto the day', !!landed,
    after.tasks.map((t) => t.title).join(', '))
  const copiedParent = after.tasks.find((t) => t.title === 'ZZ backlog parent')
  check('and a copy of its parent comes with it', !!copiedParent)
  check('with the child still under it',
    !!copiedParent && landed?.parent_id === copiedParent.id,
    `${landed?.parent_id} vs ${copiedParent?.id}`)
  for (const t of after.tasks) if (!tasks.includes(t.id)) tasks.push(t.id)

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
  // Sections first: deleting one takes its tasks with it, which is most of
  // what the routine left behind.
  for (const id of sections) await del(`/api/sections/${id}`)
  for (const id of tasks) await del(`/api/tasks/${id}`)
  if (routineId) await del(`/api/routines/${routineId}`)
  console.log('cleanup: probes removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  process.exit(bad ? 1 : 0)
}
