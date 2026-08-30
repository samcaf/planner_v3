/** Every keyboard-control request, checked one at a time. */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2030-09-09'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const patch = (p, b) => json(p, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function openPage(url, errors) {
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
      w.localStorage.setItem('vim_mode', '1')
      // jsdom has no clipboard; a yank must not fall over for want of one.
      Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: async (t) => { w.__clip = t } }, configurable: true,
      })
    },
  })
}

let sec
try {
  sec = await post('/api/sections', { date: D, name: 'ZZ Morning', layout: 'columns' })
  const one = await post('/api/tasks', {
    title: 'ZZ one', scheduled_date: D, section_id: sec.id, estimate_min: 5,
    notes: 'first note', priority: 'high',
  })
  const two = await post('/api/tasks', {
    title: 'ZZ two', scheduled_date: D, section_id: sec.id, estimate_min: 5,
  })
  const deep = await post('/api/tasks', {
    title: 'ZZ deep', scheduled_date: D, section_id: sec.id, estimate_min: 120,
  })
  // Made before the page loads: rows added afterwards are not on screen until
  // something makes it refetch, and the cursor can only reach what is drawn.
  const band = await post('/api/tasks', {
    title: 'ZZ band', scheduled_date: D, section_id: sec.id, subsection: 1,
  })
  const inBand = await post('/api/tasks', {
    title: 'ZZ under it', scheduled_date: D, section_id: sec.id, notes: 'band note',
  })
  await post(`/api/tasks/${inBand.id}/nest`, { parent_id: band.id })

  const errors = []
  const dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3400)

  const key = (k, init = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...init,
  }))
  const keys = async (str, gap = 110) => {
    for (const k of str) { key(k); await wait(gap) }
  }
  const cursorId = () => {
    const el = document.querySelector('.task.vim-on')
    return el ? Number(el.dataset.taskId) : null
  }
  const titleAt = () => document.querySelector('.task.vim-on .task-title')?.textContent.trim()
  const colOfCursor = () => {
    const el = document.querySelector('.task.vim-on')?.closest('.box-col')
    if (!el) return null
    return [...el.parentElement.children].filter((c) => c.classList.contains('box-col')).indexOf(el)
  }
  const clip = () => window.__clip
  /**
   * Aim with `/`, not by walking.
   *
   * j and k keep to their own box now — at the foot of one they leave the grid
   * rather than sliding into the box beside it, which is what h and l are for.
   * So a walk from the top cannot reach a task in the second or third box at
   * all, and searching for it by name is both shorter and the thing a person
   * would actually do.
   */
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
    for (let i = 0; i < 24 && cursorId() !== id; i++) { key('n'); await wait(160) }
    return cursorId() === id
  }

  for (let i = 0; i < 150 && cursorId() === null; i++) await wait(150)
  check('the cursor starts somewhere', cursorId() !== null, 'no cursor')

  // 1 ── counts before a movement -------------------------------------------
  key('g'); await wait(90); key('g'); await wait(220)
  const top = cursorId()
  await keys('2j')
  const twoDown = cursorId()
  key('g'); await wait(90); key('g'); await wait(200)
  key('j'); await wait(140); key('j'); await wait(200)
  check('a count repeats a movement — 2j is two js',
    twoDown === cursorId() && twoDown !== top, `${top} -> ${twoDown} vs ${cursorId()}`)

  // 2 ── h and l cross the three boxes ---------------------------------------
  check('a 5-minute task sits in the first box', (await aim(one.id, 'ZZ one')) && colOfCursor() === 0,
    `col ${colOfCursor()}`)
  key('l'); await wait(250)
  check('l moves to a box on the right', colOfCursor() > 0, `col ${colOfCursor()}`)
  check('and lands on a task that is really there', cursorId() !== one.id, `${cursorId()}`)
  const rightCol = colOfCursor()
  key('h'); await wait(250)
  check('h moves back to the left', colOfCursor() < rightCol, `col ${colOfCursor()}`)

  // 3 ── Alt-j and Alt-k move the task itself (J and K walk sections) --------
  const orderNow = async () => (await json(`/api/days/${D}`)).tasks
    .filter((t) => t.section_id === sec.id && t.kind !== 'note')
    .sort((a, b) => a.sort - b.sort || a.id - b.id).map((t) => t.title)
  const before = await orderNow()
  check('the section starts in a known order', before.length >= 3, before.join(','))
  check('aimed at the first task', await aim(one.id, 'ZZ one'), `${cursorId()}`)
  key('j', { altKey: true }); await wait(1100)
  const after = await orderNow()
  check('Alt-j moves the task itself down, not the cursor',
    after.indexOf('ZZ one') > before.indexOf('ZZ one'), `${before.join(',')} -> ${after.join(',')}`)
  check('the cursor stays with the task it moved', cursorId() === one.id, `${cursorId()}`)
  key('k', { altKey: true }); await wait(1100)
  check('Alt-k moves it back up', (await orderNow()).join(',') === before.join(','),
    (await orderNow()).join(','))

  // 4 ── u undoes, Ctrl-r redoes --------------------------------------------
  check('aimed', await aim(two.id, 'ZZ two'))
  key('Enter'); await wait(900)
  check('Enter ticks it', (await json(`/api/tasks/${two.id}`)).status === 'done',
    (await json(`/api/tasks/${two.id}`)).status)
  key('u'); await wait(1100)
  check('u undoes the last change', (await json(`/api/tasks/${two.id}`)).status === 'todo',
    (await json(`/api/tasks/${two.id}`)).status)
  key('r', { ctrlKey: true }); await wait(1100)
  check('Ctrl-r redoes it', (await json(`/api/tasks/${two.id}`)).status === 'done',
    (await json(`/api/tasks/${two.id}`)).status)
  await patch(`/api/tasks/${two.id}`, { status: 'todo' })
  await wait(500)

  // 5 ── visual mode starts on the text -------------------------------------
  check('aimed at a task with a note', await aim(one.id, 'ZZ one'))
  key('v'); await wait(250)
  check('v enters visual mode',
    document.querySelector('.vim-mode')?.textContent === 'VISUAL',
    document.querySelector('.vim-mode')?.textContent)
  check('and starts by selecting the task’s own text',
    String(window.getSelection() || '').includes('ZZ one'),
    `"${String(window.getSelection() || '')}"`)

  // 6 ── j in visual switches to whole tasks --------------------------------
  key('j'); await wait(300)
  check('pressing j switches the selection to whole tasks',
    String(window.getSelection() || '') === '', `"${String(window.getSelection() || '')}"`)
  check('and more than one task is marked',
    document.querySelectorAll('.task.vim-sel').length >= 2,
    `${document.querySelectorAll('.task.vim-sel').length} marked`)
  key('Escape'); await wait(250)

  // 7 ── yy yanks the text ---------------------------------------------------
  check('aimed', await aim(one.id, 'ZZ one'))
  await keys('yy', 130)
  await wait(500)
  check('yy yanks the title and its note',
    clip() === 'ZZ one\nfirst note', JSON.stringify(clip()))

  check('aimed at one without a note', await aim(two.id, 'ZZ two'))
  await keys('yy', 130)
  await wait(500)
  check('a task with no note yanks just its title', clip() === 'ZZ two', JSON.stringify(clip()))

  // 8 ── y over several tasks separates them --------------------------------
  check('aimed', await aim(one.id, 'ZZ one'))
  key('V'); await wait(200)
  key('j'); await wait(250)
  key('y'); await wait(600)
  check('yanking two tasks separates them with a blank line',
    (clip() || '').split('\n\n').length === 2, JSON.stringify(clip()))

  // 9 ── yt yanks markdown ---------------------------------------------------
  check('aimed', await aim(one.id, 'ZZ one'))
  await keys('yt', 130)
  await wait(600)
  const md = clip() || ''
  check('yt heads it with the section', md.startsWith('# ZZ Morning'), md.slice(0, 60))
  check('and the task as a second-level heading', /\n## ZZ one/.test(md), md.slice(0, 90))
  check('with a line of metadata', /\*[^*]*5m[^*]*\*/.test(md), md.slice(0, 160))
  check('and the note underneath', md.includes('first note'), md.slice(0, 200))

  // 9b ── a band head yanks the whole band ----------------------------------
  check('aimed at the band head', await aim(band.id, 'ZZ band'), `${cursorId()}`)
  await keys('yy', 130)
  await wait(600)
  check('yanking a sub-section takes what is under it too',
    (clip() || '').includes('ZZ band') && (clip() || '').includes('ZZ under it'),
    JSON.stringify(clip()))
  check('including that task’s own note', (clip() || '').includes('band note'),
    JSON.stringify(clip()))

  // 10 ── za folds, zp is the pomodoro ---------------------------------------
  const pomo = () => document.querySelector('[data-pomo="toggle"]')
  const was = pomo()?.getAttribute('title')
  await keys('zp', 130)
  await wait(500)
  check('zp works the pomodoro', pomo()?.getAttribute('title') !== was,
    `${was} -> ${pomo()?.getAttribute('title')}`)
  await keys('zp', 130)
  await wait(400)

  // 11 ── :note opens the note ----------------------------------------------
  check('aimed', await aim(deep.id, 'ZZ deep'))
  key(':'); await wait(300)
  const field = document.querySelector('.vim-cmd-input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(field, 'note')
  field.dispatchEvent(new window.Event('input', { bubbles: true }))
  field.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await wait(900)
  const row = document.querySelector(`.task[data-task-id="${deep.id}"]`)
  check(':note opens the note for editing',
    !!row?.querySelector('textarea') || document.querySelector('.vim-mode')?.textContent === 'INSERT',
    `mode=${document.querySelector('.vim-mode')?.textContent}`)
  key('Escape'); await wait(300)

  check('no key threw along the way', errors.length === 0, errors.slice(0, 2).join(' | '))
  void titleAt
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
