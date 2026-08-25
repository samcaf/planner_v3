/**
 * The part a stub can hide: that reaching zero actually sounds, once, and that
 * the timer banks itself exactly rather than drifting past the end.
 */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const DAY = '2028-09-12'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })

try {
  // A minute long and already most of the way through, so it crosses zero
  // during the test rather than making it sit through a real minute. The
  // headroom has to outlast the page load, or it is over before anything can
  // be observed running.
  const t = await post('/api/tasks', {
    title: 'ZZ-ring', scheduled_date: DAY, estimate_min: 1, fixed_time: 1,
    timer_elapsed_ms: 54000, timer_started_at: new Date().toISOString(),
  })

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

      // Count the notes actually scheduled, so "it rang" is a measurement.
      w.__notes = []
      const gain = () => ({
        connect: (n) => n,
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      })
      w.AudioContext = function () {
        return {
          currentTime: 0, state: 'running', resume() {}, destination: {},
          createGain: gain,
          createOscillator: () => ({
            connect: (n) => n, start() {}, stop() {}, type: '',
            frequency: { set value(v) { w.__notes.push(Math.round(v)) }, get value() { return 0 } },
          }),
        }
      }
    },
  })
  const { window } = dom
  const { document } = window
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(2500)
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const row = [...document.querySelectorAll('.task')].find((r) => r.textContent.includes('ZZ-ring'))
  row.querySelector('button[title="Time and duration"]')
    ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(300)
  check('the timer is on screen and running', !!row.querySelector('.tt.is-running'),
    row.querySelector('.tt')?.className)
  check('nothing has sounded yet', window.__notes.length === 0, JSON.stringify(window.__notes))

  // Let it cross zero.
  await wait(4200)

  check('it sounds when it reaches zero', window.__notes.length > 0, 'silence')
  check('the phrase is the harmonic-minor motif',
    JSON.stringify(window.__notes) === JSON.stringify([440, 523, 659, 831, 880]),
    JSON.stringify(window.__notes))
  check('the raised seventh is there — a semitone under the octave',
    window.__notes.includes(831) && window.__notes.includes(880))

  const rung = window.__notes.length
  await wait(1500)
  check('and it sounds once, not on every repaint', window.__notes.length === rung,
    `${rung} -> ${window.__notes.length}`)

  const after = await json(`/api/tasks/${t.id}`)
  check('the timer stops itself', after.timer_started_at === null, after.timer_started_at)
  check('and banks exactly the full length rather than drifting past it',
    after.timer_elapsed_ms === 60000, `${after.timer_elapsed_ms}ms`)
  check('so the clock reads zero', /^0:00/.test(row.querySelector('.tt-clock')?.textContent || ''),
    row.querySelector('.tt-clock')?.textContent)
  check('and the bar reads as finished', !!row.querySelector('.tt.is-done'),
    row.querySelector('.tt')?.className)
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
  console.log(`cleanup: ${(await json(`/api/days/${DAY}`)).tasks.length} tasks left`)
}
