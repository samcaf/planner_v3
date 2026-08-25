/** Pomodoro rewind, the toolbar paperclip, image expansion, and the uploads viewer. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const DAY = '2028-11-21'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom
let uploaded = null

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function stubAudio(w) {
  const node = () => ({
    connect: (n) => n, start() {}, stop() {}, type: '', frequency: { value: 0 },
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
  })
  w.AudioContext = function () {
    return { currentTime: 0, state: 'running', resume() {}, destination: {},
      createOscillator: node, createGain: node }
  }
}

try {
  uploaded = await post('/api/uploads', { data: PNG, filename: 'zz-shot.png' })
  await post('/api/tasks', {
    title: 'ZZ-pic', scheduled_date: DAY,
    notes: `a picture:\n\n![shot](${uploaded.url})`,
  })

  // --- the server's inline rule -------------------------------------------
  const img = await fetch(BASE + uploaded.url)
  check('an image is served for viewing', !img.headers.get('content-disposition'),
    img.headers.get('content-disposition'))
  check('and with its real type', img.headers.get('content-type') === 'image/png',
    img.headers.get('content-type'))

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
  const click = (el, init = {}) => el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...init }))
  await wait(3000)
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  // --- an image in a note opens out and folds back ------------------------
  const shot = document.querySelector('.task-notes .rich img, .rich img')
  check('the note renders its image', !!shot, 'no img in the note')
  check('it starts as a thumbnail', !shot?.classList.contains('is-open'))
  click(shot)
  await wait(250)
  check('clicking opens it', !!shot?.classList.contains('is-open'))
  click(shot)
  await wait(250)
  check('clicking again folds it back', !shot?.classList.contains('is-open'))

  // Clicking the image must not open the note's editor underneath it.
  check('and does not open the editor beneath it',
    !document.querySelector('.task-notes textarea'), 'the editor took the click')

  // --- the toolbar offers attach ------------------------------------------
  const view = document.querySelector('.task-notes .rich-view')
  click(view)
  await wait(500)
  const clip = [...document.querySelectorAll('.nt-tb-btn')]
    .find((b) => b.getAttribute('title') === 'Attach a file')
  check('the toolbar offers a paperclip', !!clip, 'no attach button in the toolbar')
  check('the footer still offers it too',
    [...document.querySelectorAll('.rich-hint button')].some((b) => /attach/i.test(b.textContent)))
  document.querySelector('.task-notes textarea')
    ?.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
  await wait(400)

  // --- the pomodoro's rewind ----------------------------------------------
  const keys = () => [...document.querySelectorAll('.pomo-keys button')]
  // Three, not four: rewind absorbs what reset did — part-way through a stretch
  // it takes you back to its start, which is the same act.
  check('there are three transport controls', keys().length === 3, `${keys().length}`)
  check('rewind comes first, as on a music player',
    /back/i.test(keys()[0]?.getAttribute('title') || ''),
    keys().map((b) => b.getAttribute('title')).join(' | '))
  const rewind = () => keys().find((b) => /back/i.test(b.getAttribute('title') || ''))
  check('one of them is a rewind', !!rewind(), keys().map((b) => b.getAttribute('title')).join(' | '))
  check('at the start it offers to step back a round',
    /back one round/i.test(rewind()?.getAttribute('title') || ''),
    rewind()?.getAttribute('title'))

  const phase = () => document.querySelector('.pomo-phase')?.textContent || ''
  // Skip forward twice: work -> break -> work, with one round banked.
  const skip = () => keys().find((b) => /skip/i.test(b.getAttribute('title') || ''))
  click(skip()); await wait(200)
  check('skipping reaches a break', /break/i.test(phase()), phase())
  click(skip()); await wait(200)
  check('and then work again, one round in', /work/i.test(phase()) && /1/.test(phase()), phase())

  click(rewind()); await wait(200)
  check('rewinding steps back to that break', /break/i.test(phase()), phase())
  click(rewind()); await wait(200)
  check('and again to the first stretch', /work/i.test(phase()) && !/\d/.test(phase()), phase())
  click(rewind()); await wait(200)
  check('pressing past the start stays at round one', /work/i.test(phase()) && !/\d/.test(phase()),
    phase())

  // --- the uploads page views rather than downloads -----------------------
  const up = await JSDOM.fromURL(`${BASE}/uploads`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      stubAudio(w)
    },
  })
  const ud = up.window.document
  await wait(2500)

  const card = [...ud.querySelectorAll('.ex-up')].find((c) => c.textContent.includes('zz-shot'))
  const link = card?.querySelector('.ex-up-thumb')
  check('the image card is on the page', !!card)
  check('its link no longer forces a download', !link?.hasAttribute('download'),
    `download=${link?.getAttribute('download')}`)
  check('and says it will show it', /view/i.test(link?.getAttribute('title') || ''),
    link?.getAttribute('title'))

  link?.dispatchEvent(new up.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await wait(400)
  check('clicking it opens the viewer', !!ud.querySelector('.ex-view'))
  check('the viewer shows that image',
    ud.querySelector('.ex-view img')?.getAttribute('src') === uploaded.url)

  ud.querySelector('.ex-view')?.dispatchEvent(new up.window.MouseEvent('click', { bubbles: true }))
  await wait(300)
  check('clicking it again closes the viewer', !ud.querySelector('.ex-view'))
  up.window.close()
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  dom?.window?.close()
  for (const t of (await json(`/api/days/${DAY}`).catch(() => ({ tasks: [] }))).tasks) {
    await del(`/api/tasks/${t.id}`)
  }
  if (uploaded?.name) await del(`/api/uploads/${uploaded.name}`)
  console.log('cleanup: probe task and upload removed')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
