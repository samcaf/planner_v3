/** A pasted title opens selected; J/K select sections; Alt-j/k move them. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-04-04'
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
    for (let i = 0; i < 24 && onTask() !== id; i++) { key('n'); await wait(160) }
    return onTask() === id
  }

  for (let i = 0; i < 150 && onTask() === null && onSection() === null; i++) await wait(150)

  // ── a pasted task opens with its title selected ---------------------------
  check('aimed at the source', await aim(src.id, 'ZZ source'), `${onTask()}`)
  key('y'); await wait(120); key('y'); await wait(600)
  key('p'); await wait(1800)

  const field = document.querySelector('.rich-line-input')
  check('the pasted task opens for editing', !!field)
  check('with the caret in it', document.activeElement === field,
    document.activeElement?.className)
  check('and it carries the title', field?.value === 'ZZ source', field?.value)
  check('the title is SHOWN selected, not just focused',
    field?.selectionStart === 0 && field?.selectionEnd === (field?.value || '').length,
    `${field?.selectionStart}..${field?.selectionEnd} of ${(field?.value || '').length}`)
  key('Escape'); await wait(300)

  // ── J and K select the section itself -------------------------------------
  check('aimed again', await aim(src.id, 'ZZ source'), `${onTask()}`)
  key('J'); await wait(700)
  check('J selects the next section, rather than a row inside it',
    onSection() === String(two.id) && onTask() === null,
    `section=${onSection()} task=${onTask()}`)
  key('J'); await wait(700)
  check('and J again the one after', onSection() === String(three.id), onSection())
  key('K'); await wait(700)
  check('K selects the one before', onSection() === String(two.id), onSection())
  key('j'); await wait(500)
  check('j is what goes into it', onTask() !== null && onSection() === null,
    `section=${onSection()} task=${onTask()}`)

  // ── Alt-j and Alt-k move a whole section ----------------------------------
  const order = async () => (await json(`/api/days/${D}`)).sections
    .sort((a, b) => a.sort - b.sort || a.id - b.id).map((s) => s.name)
  const before = await order()
  check('the sections start in a known order', before.join(',') === 'ZZ One,ZZ Two,ZZ Three',
    before.join(','))

  // Aimed from the top rather than by stepping back: K from a task INSIDE a
  // section goes to the section before it, which is right but is not the one
  // this needs.
  key('Escape'); await wait(120)
  key('g'); await wait(90); key('g'); await wait(250)
  key('J'); await wait(700)
  check('on the second section', onSection() === String(two.id),
    `section=${onSection()} task=${onTask()}`)
  key('j', { altKey: true }); await wait(1400)
  const moved = await order()
  check('Alt-j moves the whole section down',
    moved.join(',') === 'ZZ One,ZZ Three,ZZ Two', moved.join(','))
  check('and the cursor stays with it', onSection() === String(two.id), onSection())
  key('k', { altKey: true }); await wait(1400)
  check('Alt-k moves it back', (await order()).join(',') === before.join(','),
    (await order()).join(','))
  key('u'); await wait(1200)

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
  console.log('cleanup: probe day cleared')
  for (const d of doms) { try { d.window.close() } catch {} }
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
