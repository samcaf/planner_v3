/** i opens the thing under the cursor for editing — a task, or a section. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-04-06'
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

  for (let i = 0; i < 60 && onTask() === null && onSection() === null; i++) await wait(150)

  // ── i on a task ----------------------------------------------------------
  // The handler that opens a title sits on the .rich-line inside .task-title.
  // A click aimed at .task-title, the parent, never reached it, so i did
  // nothing at all — on any page.
  check('aimed at the source', await aim(src.id, 'ZZ source'), `${onTask()}`)
  key('i'); await wait(900)

  const field = document.querySelector('.rich-line-input')
  check('i opens the title for editing', !!field)
  check('carrying the title', field?.value === 'ZZ source', field?.value)
  check('selected, so typing replaces it',
    field && field.selectionStart === 0 && field.selectionEnd === 'ZZ source'.length,
    `${field?.selectionStart}-${field?.selectionEnd}`)

  const setValue = (el, v) => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  setValue(field, 'ZZ renamed')
  field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await wait(900)
  const after = await json(`/api/tasks/${src.id}`)
  check('and typing renames the task', after.title === 'ZZ renamed', after.title)

  // ── Escape ends the edit, keeping what was typed --------------------------
  // Vim's reading of Escape, not the dialog-box one. The field's own Escape
  // would throw the edit away; in vim mode the layer's commit wins.
  key('i'); await wait(700)
  const again = document.querySelector('.rich-line-input')
  check('i opens it a second time', !!again)
  setValue(again, 'ZZ escaped')
  again.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await wait(900)
  const kept = await json(`/api/tasks/${src.id}`)
  check('Escape keeps what was typed', kept.title === 'ZZ escaped', kept.title)
  check('and leaves the field', !document.querySelector('.rich-line-input'))

  // ── i on a section --------------------------------------------------------
  // A section is not a task, and every key that acts on one used to be turned
  // away with "that is a section". Renaming means something for a section too.
  key('Escape'); await wait(300)
  key('g'); await wait(90); key('g'); await wait(500)
  check('landed on a section', !!onSection(), `${onSection()}`)
  const which = onSection()
  key('i'); await wait(900)

  const name = document.querySelector('.panel.section.vim-on-section input.input')
  check('i opens the section name', !!name,
    `active=${document.activeElement?.tagName}.${document.activeElement?.className}`)
  check('carrying its name', /^ZZ /.test(name?.value || ''), name?.value)
  setValue(name, 'ZZ renamed section')
  name.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await wait(900)
  const day2 = await json(`/api/days/${D}`)
  check('and typing renames the section',
    day2.sections.find((s) => String(s.id) === which)?.name === 'ZZ renamed section',
    day2.sections.map((s) => s.name).join(','))

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
