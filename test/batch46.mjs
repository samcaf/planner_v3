/** Sections as cursor stops, and the arrows on the notes page. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-01-14'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function openPage(url, errors, vim = true) {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e).slice(0, 140)))
  return JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
      if (vim) w.localStorage.setItem('vim_mode', '1'); else w.localStorage.removeItem('vim_mode')
      Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: async (t) => { w.__clip = t } }, configurable: true,
      })
    },
  })
}

try {
  // ── the arrows on the notes page -------------------------------------------
  const errs0 = []
  let dom = await openPage(`${BASE}/notes/${D}`, errs0, false)
  doms.push(dom)
  await wait(2800)
  const arrow = (w, k) => w.dispatchEvent(new w.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true,
  }))
  arrow(dom.window, 'ArrowRight'); await wait(500)
  check('the right arrow walks the notes page forward a day',
    dom.window.location.pathname === '/notes/2031-01-15', dom.window.location.pathname)
  arrow(dom.window, 'ArrowLeft'); await wait(500)
  arrow(dom.window, 'ArrowLeft'); await wait(500)
  check('and the left arrow walks it back',
    dom.window.location.pathname === '/notes/2031-01-13', dom.window.location.pathname)
  dom.window.close()

  // ── sections as cursor stops ------------------------------------------------
  const morning = await post('/api/sections', { date: D, name: 'ZZ Morning', layout: 'columns' })
  const evening = await post('/api/sections', { date: D, name: 'ZZ Evening', layout: 'columns' })
  const m1 = await post('/api/tasks', {
    title: 'ZZ m one', scheduled_date: D, section_id: morning.id, notes: 'a note',
  })
  const m2 = await post('/api/tasks', { title: 'ZZ m two', scheduled_date: D, section_id: morning.id })
  const e1 = await post('/api/tasks', { title: 'ZZ e one', scheduled_date: D, section_id: evening.id })

  const errors = []
  dom = await openPage(`${BASE}/day/${D}`, errors)
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
  const where = () => (onSection() ? `s${onSection()}` : onTask())

  for (let i = 0; i < 20 && where() == null; i++) await wait(150)
  check('the cursor starts on a task, not a heading', onTask() !== null && onSection() === null,
    `task=${onTask()} section=${onSection()}`)

  // Walk to the top of the list, then up once more.
  // gg is the top of the page, and on a day that begins with a section the top
  // IS that section — the same way vim's gg is line one whatever is on it.
  key('g'); await wait(90); key('g'); await wait(250)
  check('gg lands on the first stop, which here is a section',
    onSection() === String(morning.id), `${where()}`)
  check('the whole section is marked, not a line in it',
    !!document.querySelector('.panel.section.vim-on-section') && !document.querySelector('.task.vim-on'),
    'a row was marked as well')

  key('j'); await wait(300)
  const firstTask = onTask()
  check('j from a section goes into its first task', firstTask !== null, `${where()}`)
  key('k'); await wait(300)
  check('and k off that task comes back to the section',
    onSection() === String(morning.id), `${where()}`)
  key('j'); await wait(300)
  check('back on the first task', onTask() === firstTask, `${where()}`)

  // Down past the last task of the first section, onto the next section.
  let guard = 0
  while (onSection() === null && guard++ < 10) { key('j'); await wait(120) }
  check('walking down eventually reaches the next section', onSection() === String(evening.id),
    `${where()} after ${guard} steps`)

  // ── Space folds a section under the cursor ---------------------------------
  const shut = (id) => document
    .querySelector(`.panel.section[data-section-id="${id}"]`)?.dataset.sectionShut === '1'
  check('it is open to begin with', !shut(evening.id))
  key(' '); await wait(1000)
  check('Space folds the section under the cursor', shut(evening.id), 'still open')
  key(' '); await wait(1000)
  check('and Space again opens it', !shut(evening.id), 'still shut')

  // ── yanking a section takes everything in it -------------------------------
  key('g'); await wait(90); key('g'); await wait(250)
  key('k'); await wait(300)
  check('back on the first section', onSection() === String(morning.id), `${where()}`)
  key('y'); await wait(120); key('y'); await wait(700)
  const clip = window.__clip || ''
  check('yanking a section takes both its tasks',
    clip.includes('ZZ m one') && clip.includes('ZZ m two'), JSON.stringify(clip))
  check('and the note on one of them', clip.includes('a note'), JSON.stringify(clip))
  check('but nothing from the other section', !clip.includes('ZZ e one'), JSON.stringify(clip))

  // ── a key that needs a task says so ----------------------------------------
  key('t'); await wait(400)
  check('a task key on a section explains itself',
    /section/i.test(document.querySelector('.vim-say')?.textContent || ''),
    document.querySelector('.vim-say')?.textContent)

  check('no key threw along the way', errors.length === 0, errors.slice(0, 2).join(' | '))
  void [m1, m2, e1]
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
