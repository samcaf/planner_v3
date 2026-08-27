/** Every page loads without throwing, and says what it is in the tab. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let projectId = null
let personId = null

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Pages are loaded twice over: once plain, once with keyboard control on.
 *
 * Every page that lends the keyboard its handlers does so through a hook, and a
 * hook placed after an early return is a hard React error that white-screens
 * the page. That has happened four times in this codebase and was invisible to
 * a check that only ever loaded pages with the mode off.
 */
function openPage(url, errors, vim = false) {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(e.message))
  return JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.Element.prototype.scrollIntoView = function () {}
      if (vim) w.localStorage.setItem('vim_mode', '1')
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      const node = () => ({
        connect: (n) => n, start() {}, stop() {}, type: '', frequency: { value: 0 },
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      })
      w.AudioContext = function () {
        return { currentTime: 0, state: 'running', resume() {}, destination: {},
          createOscillator: node, createGain: node }
      }
    },
  })
}

// Local date parts, not toISOString(): the app works in the user's own
// timezone, and west of UTC "today" in UTC is already tomorrow — which made
// every relative URL look one day out when the app was right.
const iso = (d) => [
  d.getFullYear(),
  String(d.getMonth() + 1).padStart(2, '0'),
  String(d.getDate()).padStart(2, '0'),
].join('-')
const todayIso = iso(new Date())

try {
  const proj = await post('/api/projects', { name: 'ZZ TitleProj' })
  projectId = proj.id
  const person = await post('/api/people', { name: 'ZZ TitlePerson' })
  personId = person.id

  const PAGES = [
    ['/day/2029-04-05',      'day',            '05-04-29'],
    ['/week/2029-04-05',     'week',           null],
    ['/month/2029-04-05',    'month',          null],
    ['/notes/2029-04-05',    'notes',          'Notes 05-04-29'],
    ['/tasks',               'all tasks',      'All tasks'],
    ['/notebook',            'notebook',       'Notebook'],
    ['/projects',            'projects',       'Projects'],
    [`/projects/${proj.id}`, 'project detail', 'ZZ TitleProj'],
    ['/people',              'people',         'People'],
    [`/people/${person.id}`, 'person detail',  'ZZ TitlePerson'],
    ['/routines',            'routines',       'Routines'],
    ['/uploads',             'uploads',        'Uploads'],
    ['/dashboard',           'dashboard',      'Dashboard'],
  ]

  for (const [path, label, wantTitle] of PAGES) {
    const errors = []
    const dom = await openPage(BASE + path, errors)
    await wait(2600)
    const { document } = dom.window
    const crashed = !!document.querySelector('.crash')
    check(`${label}: renders without throwing`, !crashed && errors.length === 0,
      crashed ? 'the error boundary caught something' : errors.slice(0, 1).join(''))
    check(`${label}: the tab is not just "Planner"`,
      document.title !== 'Planner' && document.title.length > 0, document.title)
    if (wantTitle) {
      check(`${label}: the tab names it`, document.title.startsWith(wantTitle),
        `"${document.title}" does not start with "${wantTitle}"`)
    }
    dom.window.close()

    // The same page again, with keyboard control on.
    const vimErrors = []
    const vimDom = await openPage(BASE + path, vimErrors, true)
    await wait(2600)
    const vimDoc = vimDom.window.document
    check(`${label}: renders with keyboard control on`,
      !vimDoc.querySelector('.crash') && vimErrors.length === 0,
      vimDoc.querySelector('.crash')
        ? 'the error boundary caught something'
        : vimErrors.slice(0, 1).join(''))
    vimDom.window.close()
  }

  // ------------------------------------------- relative day urls
  const RELATIVE = [['0', 0], ['+1', 1], ['-1', -1], ['7', 7], ['-30', -30]]
  for (const [frag, offset] of RELATIVE) {
    const errors = []
    const dom = await openPage(`${BASE}/day/${encodeURIComponent(frag)}`, errors)
    await wait(2600)
    const d = new Date(`${todayIso}T00:00:00`)
    d.setDate(d.getDate() + offset)
    const want = iso(d)
    check(`/day/${frag} resolves to ${want}`,
      dom.window.location.pathname === `/day/${want}`,
      dom.window.location.pathname)
    check(`/day/${frag}: no runtime errors`, errors.length === 0, errors.slice(0, 1).join(''))
    dom.window.close()
  }

  // A real date must still be left alone.
  {
    const errors = []
    const dom = await openPage(`${BASE}/day/2029-04-05`, errors)
    await wait(2400)
    check('a concrete date is not treated as an offset',
      dom.window.location.pathname === '/day/2029-04-05', dom.window.location.pathname)
    dom.window.close()
  }
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  if (projectId) await del(`/api/projects/${projectId}`)
  if (personId) await del(`/api/people/${personId}`)
  console.log('cleanup: probe rows removed')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
