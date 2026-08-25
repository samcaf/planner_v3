/** The pomodoro, the fixed-length task timer, and the notebook. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const DAY = '2028-08-15'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom
const madeNotes = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const patch = (p, b) => json(p, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })

/** jsdom has no Web Audio; the chime must degrade rather than throw. */
function stubAudio(w) {
  const node = () => ({
    connect: (n) => n, start() {}, stop() {},
    frequency: { value: 0 }, type: '',
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
  })
  w.AudioContext = function () {
    return { currentTime: 0, state: 'running', resume() {}, destination: {},
      createOscillator: node, createGain: node }
  }
}

try {
  // --- the notebook is its own thing --------------------------------------
  const before = (await json('/api/notebook')).length
  const note = await post('/api/notebook', { title: 'ZZ-note', body: 'a standing list' })
  madeNotes.push(note.id)
  check('a note can be made', note.id > 0 && note.title === 'ZZ-note')
  check('the notebook lists it', (await json('/api/notebook')).length === before + 1)

  const backlog = await json('/api/tasks?backlog=1')
  check('a note is not a backlog task', !backlog.some((t) => t.title === 'ZZ-note'),
    'the note surfaced as work waiting to be done')

  const pinned = await patch(`/api/notebook/${note.id}`, { pinned: 1 })
  check('a note can be pinned', pinned.pinned === 1)
  check('pinned notes come first', (await json('/api/notebook'))[0].id === note.id)

  // --- a fixed-length task carries its own timer ---------------------------
  const t = await post('/api/tasks', {
    title: 'ZZ-fixed', scheduled_date: DAY, estimate_min: 25, fixed_time: 1,
  })
  check('a task can be marked fixed-length', t.fixed_time === 1)
  check('its timer starts empty', t.timer_started_at === null && t.timer_elapsed_ms === 0,
    `${t.timer_started_at} / ${t.timer_elapsed_ms}`)

  const started = await patch(`/api/tasks/${t.id}`, { timer_started_at: new Date().toISOString() })
  check('the timer records when it began', !!started.timer_started_at)
  const paused = await patch(`/api/tasks/${t.id}`, { timer_started_at: null, timer_elapsed_ms: 61000 })
  check('pausing banks what has run', paused.timer_started_at === null && paused.timer_elapsed_ms === 61000,
    `${paused.timer_started_at} / ${paused.timer_elapsed_ms}`)
  check('and it survives a re-read', (await json(`/api/tasks/${t.id}`)).timer_elapsed_ms === 61000)

  // --- the page ------------------------------------------------------------
  const vc = new VirtualConsole()
  const errors = []
  vc.on('jsdomError', (e) => errors.push(e.message))
  dom = await JSDOM.fromURL(`${BASE}/day/${DAY}`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      stubAudio(w)
    },
  })
  const { window } = dom
  const { document } = window
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const click = (el) => el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(3000)
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  // --- pomodoro in the rail ------------------------------------------------
  const pomo = document.querySelector('.pomo')
  check('the pomodoro sits in the rail', !!pomo)
  check('it draws a pomegranate', !!pomo?.querySelector('.pom'))
  check('the fruit has a crown, seeds and a heart',
    pomo?.querySelectorAll('.pom-seed').length === 6 && pomo?.querySelectorAll('.pom-ink').length === 2,
    `${pomo?.querySelectorAll('.pom-seed').length} seeds, ${pomo?.querySelectorAll('.pom-ink').length} ink paths`)

  const rail = [...document.querySelector('.sidebar').children].map((c) => c.className)
  const iPomo = rail.findIndex((c) => c.includes('pomo'))
  const iFoot = rail.findIndex((c) => c.includes('sb-foot'))
  check('it sits between the nav and the mark', iPomo > 0 && iFoot === iPomo + 1,
    rail.join(' | '))

  const clock = () => pomo.querySelector('.pomo-clock')?.textContent
  check('it shows the work length to begin with', clock() === '30:00', clock())
  check('and says which phase that is', /Work/.test(pomo.textContent))

  click(pomo.querySelector('.pomo-face'))
  await wait(700)
  check('clicking the fruit starts it', pomo.classList.contains('is-running'))
  check('and the clock moves', clock() !== '30:00', clock())
  check('the ring begins to fill', !!pomo.querySelector('.pom-arc'))

  click(pomo.querySelector('.pomo-face'))
  await wait(300)
  check('clicking again pauses it', !pomo.classList.contains('is-running'))
  const held = clock()
  await wait(900)
  check('a paused clock does not move', clock() === held, `${held} -> ${clock()}`)

  // Found by what it does, not where it sits: the row has been reordered once
  // already, and an index silently starts testing a different button.
  const keys = [...pomo.querySelectorAll('.pomo-keys button')]
  check('there are three transport controls', keys.length === 3, `${keys.length} keys`)
  const skip = keys.find((b) => /skip/i.test(b.getAttribute('title') || ''))
  check('one of them skips ahead', !!skip,
    keys.map((b) => b.getAttribute('title')).join(' | '))
  click(skip)
  await wait(300)
  check('skip moves to the break', /Break/.test(pomo.textContent), pomo.textContent)
  check('and the break is five minutes', clock() === '5:00', clock())

  // --- the task's own timer ------------------------------------------------
  const row = [...document.querySelectorAll('.task')].find((r) => r.textContent.includes('ZZ-fixed'))
  click(row.querySelector('button[title="Time and duration"]'))
  await wait(400)
  const tt = row.querySelector('.tt')
  check('a fixed-length task shows a timer', !!tt)
  check('the bar reflects what has already run',
    Number.parseFloat(tt.querySelector('.tt-bar > i').style.width) > 0,
    tt.querySelector('.tt-bar > i')?.style.width)
  check('it counts down from the length', /^2[0-4]:/.test(tt.querySelector('.tt-clock').textContent),
    tt.querySelector('.tt-clock').textContent)

  click([...tt.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Reset'))
  await wait(900)
  check('reset clears what had run', (await json(`/api/tasks/${t.id}`)).timer_elapsed_ms === 0,
    `${(await json(`/api/tasks/${t.id}`)).timer_elapsed_ms}`)

  // A task without a length has nothing to count against.
  const plain = await post('/api/tasks', { title: 'ZZ-plain', scheduled_date: DAY, fixed_time: 1 })
  const dom2 = await JSDOM.fromURL(`${BASE}/day/${DAY}`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      stubAudio(w)
    },
  })
  await wait(2500)
  const d2 = dom2.window.document
  const plainRow = [...d2.querySelectorAll('.task')].find((r) => r.textContent.includes('ZZ-plain'))
  plainRow?.querySelector('button[title="Time and duration"]')
    ?.dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }))
  await wait(400)
  check('an untimed task is told to give it a length first',
    !!plainRow?.querySelector('.tt-none') && !plainRow?.querySelector('.tt-bar'),
    'it offered a countdown against nothing')
  dom2.window.close()

  // --- the notebook page ---------------------------------------------------
  const dom3 = await JSDOM.fromURL(`${BASE}/notebook`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      stubAudio(w)
    },
  })
  await wait(2500)
  const d3 = dom3.window.document
  check('the notebook page renders', /Notebook/.test(d3.body.textContent))
  check('it lists the note', [...d3.querySelectorAll('.nb-item')].some((i) => /ZZ-note/.test(i.textContent)),
    [...d3.querySelectorAll('.nb-item')].map((i) => i.textContent).join(' | '))
  check('and opens one for editing', !!d3.querySelector('.nb-open'))
  check('the rail links to it', [...d3.querySelectorAll('.sb-link')].some((a) => /Notebook/.test(a.textContent)))
  dom3.window.close()
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  dom?.window?.close()
  for (const x of (await json(`/api/days/${DAY}`).catch(() => ({ tasks: [] }))).tasks) {
    await del(`/api/tasks/${x.id}`)
  }
  for (const id of madeNotes) await del(`/api/notebook/${id}`)
  console.log(`cleanup: ${(await json(`/api/days/${DAY}`)).tasks.length} tasks, ${(await json('/api/notebook')).filter((n) => n.title.startsWith('ZZ-')).length} probe notes left`)
}
