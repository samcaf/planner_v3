/** Keyboard control: a cursor, the keys that move it, and the ones that act. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2030-06-10'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function openPage(url, errors, onWindow) {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(e.message))
  return JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      // jsdom has no layout, so this would otherwise throw on every move.
      w.Element.prototype.scrollIntoView = function () {}
      w.localStorage.setItem('vim_mode', '1')
      onWindow?.(w)
    },
  })
}

try {
  const a = await post('/api/tasks', { title: 'ZZ one', scheduled_date: D, estimate_min: 10 })
  const b = await post('/api/tasks', { title: 'ZZ two', scheduled_date: D, estimate_min: 10 })
  const c = await post('/api/tasks', { title: 'ZZ three', scheduled_date: D, estimate_min: 10 })

  const errors = []
  const dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3400)
  check('day: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const key = (k, init = {}) => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: k, bubbles: true, cancelable: true, ...init,
    }))
  }
  const cursorId = () => {
    const el = document.querySelector('.task.vim-on')
    return el ? Number(el.dataset.taskId) : null
  }
  const titleAt = () => document.querySelector('.task.vim-on .task-title')?.textContent.trim()

  // ------------------------------------------------------------- the basics
  check('rows carry their id for the cursor to find',
    document.querySelectorAll('.task[data-task-id]').length >= 3,
    `${document.querySelectorAll('.task[data-task-id]').length}`)
  check('the mode bar is showing', !!document.querySelector('.vim-bar'))
  check('it starts in normal mode',
    document.querySelector('.vim-mode')?.textContent === 'NORMAL',
    document.querySelector('.vim-mode')?.textContent)
  await wait(300)
  check('the cursor starts on the first row', cursorId() !== null, 'no cursor')

  // ------------------------------------------------------------- navigation
  const first = cursorId()
  key('j'); await wait(120)
  const second = cursorId()
  check('j moves down', second !== first && second !== null, `${first} -> ${second}`)
  key('k'); await wait(120)
  check('k moves back up', cursorId() === first, `${cursorId()} want ${first}`)
  key('G'); await wait(200)
  const last = cursorId()
  check('G goes to the last row', last !== null && last !== first, `${last}`)
  key('g'); await wait(90); key('g'); await wait(250)
  check('gg goes back to the first', cursorId() === first, `${cursorId()} want ${first}`)

  // --------------------------------------------------------------- actions
  // Each of these acts on whatever the cursor is holding and checks THAT task,
  // rather than walking to one by name. Acting on a task moves it — ticking it
  // folds it into "N done" — so a test that assumed the cursor stayed put was
  // testing the choreography rather than the binding.
  const act = async (keys, ms = 900) => {
    const id = cursorId()
    for (const k of [].concat(keys)) { key(k); await wait(90) }
    await wait(ms)
    return id == null ? null : json(`/api/tasks/${id}`)
  }
  const aim = async () => {
    key('g'); await wait(90); key('g'); await wait(200)
    return cursorId()
  }

  await aim()
  let target = cursorId()
  check('the cursor holds a real task', target != null, 'no cursor')

  let after = await act(' ')
  check('space ticks the task under the cursor', after?.status === 'done', after?.status)

  // A ticked or dropped task folds itself away into "N done", so reaching it
  // again means opening that fold first. Ensure-open, not toggle: clicking a
  // fold that was already open from a previous step shuts it again.
  const ensureFoldOpen = async (id) => {
    if (document.querySelector(`.task[data-task-id="${id}"]`)) return
    const f = [...document.querySelectorAll('.done-toggle')]
      .find((x) => /\d+ done/.test(x.textContent) && x.getAttribute('aria-expanded') !== 'true')
    f?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await wait(400)
  }
  // There is no public setter, so aim by walking until the id matches.
  const walkTo = async (id) => {
    await ensureFoldOpen(id)
    await aim()
    for (let i = 0; i < 16 && cursorId() !== id; i++) { key('j'); await wait(80) }
    return cursorId() === id
  }
  check('the ticked task can be reached again', await walkTo(target), `${cursorId()} want ${target}`)
  after = await act(' ')
  check('and space unticks it', after?.status === 'todo', after?.status)

  check('back on it', await walkTo(target))
  after = await act('t')
  check('t makes it optional', after?.optional === 1, `${after?.optional}`)
  check('back on it', await walkTo(target))
  after = await act('t')
  check('and again makes it committed', after?.optional === 0, `${after?.optional}`)

  check('back on it', await walkTo(target))
  after = await act(['d', 'd'])
  check('dd drops it', after?.status === 'dropped', after?.status)
  check('back on it', await walkTo(target))
  after = await act(['d', 'd'])
  check('dd again undrops it', after?.status === 'todo', after?.status)

  // --------------------------------------------------------- the command line
  check('back on it', await walkTo(target))
  key(':'); await wait(300)
  check('a colon opens the command line',
    document.querySelector('.vim-mode')?.textContent === 'COMMAND',
    document.querySelector('.vim-mode')?.textContent)
  const input = document.querySelector('.vim-cmd-input')
  check('with a field to type in', !!input)

  const send = async (line) => {
    const box2 = document.querySelector('.vim-cmd-input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(box2, line)
    box2.dispatchEvent(new window.Event('input', { bubbles: true }))
    box2.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await wait(1200)
  }

  await send('t 45')
  check(':t sets the estimate', (await json(`/api/tasks/${target}`)).estimate_min === 45,
    `${(await json(`/api/tasks/${target}`)).estimate_min}`)

  check('back on it', await walkTo(target))
  key(':'); await wait(250)
  await send('mv tomorrow')
  const moved = await json(`/api/tasks/${target}`)
  check(':mv tomorrow moves the task off this day', moved.scheduled_date === '2030-06-11',
    moved.scheduled_date)
  check('and it arrives open, like any other move', moved.status === 'todo', moved.status)

  // ---------------------------------------------------------- the pomodoro
  const pomo = () => document.querySelector('[data-pomo="toggle"]')
  check('the pomodoro has a hook the keyboard can find', !!pomo())
  const wasRunning = pomo()?.getAttribute('title')
  key('z'); await wait(500)
  check('z works the pomodoro', pomo()?.getAttribute('title') !== wasRunning,
    `${wasRunning} -> ${pomo()?.getAttribute('title')}`)
  key('z'); await wait(500)
  check('and z again puts it back', pomo()?.getAttribute('title') === wasRunning,
    `${pomo()?.getAttribute('title')}`)

  // ------------------------------------------------------------- the help
  key('?'); await wait(300)
  check('? opens the key sheet', !!document.querySelector('.vim-help'))
  const sheet = document.querySelector('.vim-help')?.textContent || ''
  check('which lists the movement keys', /j \/ k/.test(sheet))
  check('and the commands', /:mv/.test(sheet))
  key('Escape'); await wait(200)
  check('Escape closes it', !document.querySelector('.vim-help'))

  // ------------------------------------------ keys stay out of text fields
  const box = document.querySelector('.quick-add input')
  if (box) {
    box.focus()
    const before = cursorId()
    key('j'); await wait(150)
    check('typing j in a field does not move the cursor', cursorId() === before,
      `${before} -> ${cursorId()}`)
    box.blur()
  } else {
    check('there is a quick-add field to test against', false, 'not found')
  }

  // --------------------------------------------------------------- toggling
  key('v', { ctrlKey: true, altKey: true }); await wait(300)
  // Checked at the END as well as the start: a key handler that throws does so
  // when the key is pressed, not when the page loads, and an error there is
  // invisible to a check that ran before any key was sent.
  check('no key threw along the way', errors.length === 0, errors.slice(0, 2).join(' | '))

  check('Ctrl-Alt-V turns it off', !document.querySelector('.vim-bar'))
  check('and clears the cursor', !document.querySelector('.task.vim-on'))
  key('v', { ctrlKey: true, altKey: true }); await wait(300)
  check('and turns it back on', !!document.querySelector('.vim-bar'))

  void [a, c]
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  for (const d of doms) { try { d.window.close() } catch {} }
  for (const day of [D, '2030-06-11']) {
    const got = await json(`/api/days/${day}`).catch(() => ({ tasks: [], sections: [] }))
    for (const t of got.tasks) await del(`/api/tasks/${t.id}`)
    for (const s of got.sections) await del(`/api/sections/${s.id}`)
  }
  console.log('cleanup: probe days cleared')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
