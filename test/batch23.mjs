/** Clickable links, a section that folds when finished, and the pomodoro stack. */
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE = 'http://localhost:8787'
const DAY = '2028-10-17'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom
const madeSections = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })

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
  const sec = await post('/api/sections', { date: DAY, name: 'ZZ-fold' })
  madeSections.push(sec.id)
  const a = await post('/api/tasks', { title: 'ZZ-one', scheduled_date: DAY, section_id: sec.id })
  const b = await post('/api/tasks', { title: 'ZZ-two', scheduled_date: DAY, section_id: sec.id })
  await post('/api/tasks', {
    title: 'ZZ-link [docs](https://example.com/x)', scheduled_date: DAY,
    notes: 'see [the note link](https://example.com/n)',
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
      stubAudio(w)
    },
  })
  const { window } = dom
  const { document } = window
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const click = (el) => el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(3000)
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const rowFor = (t) => [...document.querySelectorAll('.task')].find((r) => r.textContent.includes(t))
  const panel = () => [...document.querySelectorAll('section.section')].find((s) => s.textContent.includes('ZZ-fold'))

  // --- a link in a title is a link ----------------------------------------
  const linkRow = rowFor('ZZ-link')
  const anchor = linkRow?.querySelector('.rich-line a')
  check('a link in a title renders as an anchor', !!anchor, 'no anchor in the title')
  check('it points where it says', anchor?.getAttribute('href') === 'https://example.com/x',
    anchor?.getAttribute('href'))
  check('and opens away from the app', anchor?.getAttribute('target') === '_blank')

  click(anchor)
  await wait(350)
  check('clicking the link does not open the editor instead',
    !linkRow.querySelector('input.rich-line-input'), 'the editor took the click')

  // The text beside the link still opens it, or the title becomes uneditable.
  click(linkRow.querySelector('.rich-line'))
  await wait(350)
  check('clicking the text still opens the editor', !!linkRow.querySelector('input.rich-line-input'))
  linkRow.querySelector('input.rich-line-input')
    ?.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
  await wait(400)

  // --- a section folds itself when nothing is left ------------------------
  check('the section starts open', !!panel()?.querySelector('.box-cols, .task'),
    'nothing visible inside it')
  check('and is not marked complete', !panel()?.classList.contains('is-complete'))

  for (const t of ['ZZ-one', 'ZZ-two']) {
    click(rowFor(t)?.querySelector('.task-check'))
    await wait(800)
  }
  check('both are done', (await json(`/api/tasks/${a.id}`)).status === 'done'
    && (await json(`/api/tasks/${b.id}`)).status === 'done')
  check('the finished section marks itself complete', !!panel()?.classList.contains('is-complete'),
    panel()?.className)
  // "Open" cannot be measured by `.task`: once everything is done, TaskList puts
  // the finished rows behind its own "N done" toggle, so an open section with
  // nothing outstanding legitimately renders no rows. The body is the test.
  const body = () => panel()?.querySelector('.done-toggle, .box-cols, .task, .sec-empty')
  check('and folds away', !body(), 'its body is still on show')

  const beforeTwist = (await json(`/api/days/${DAY}`)).sections.find((x) => x.id === sec.id)?.collapsed
  click(panel().querySelector('.task-twist'))
  await wait(600)
  const afterTwist = (await json(`/api/days/${DAY}`)).sections.find((x) => x.id === sec.id)?.collapsed
  check('the twist opens it again', !!body(),
    `stored collapsed: ${beforeTwist} -> ${afterTwist}`)
  check('opening does not write a collapse to the server', afterTwist === 0, `collapsed=${afterTwist}`)
  await wait(700)
  check('and it stays open rather than re-folding', !!body())

  // --- the pomodoro stack --------------------------------------------------
  const pomo = document.querySelector('.pomo')
  const kids = [...pomo.children].map((c) => c.className)
  check('the fruit comes first', kids[0].includes('pomo-face'), kids.join(' | '))
  check('the clock sits under it', kids[1].includes('pomo-clock'), kids.join(' | '))
  check('then the controls', kids[2].includes('pomo-keys'), kids.join(' | '))
  check('and the phase under those', kids[3].includes('pomo-phase'), kids.join(' | '))

  const css = readdirSync('web/dist/assets')
    .filter((f) => /\.(css|js)$/.test(f))
    .map((f) => readFileSync(`web/dist/assets/${f}`, 'utf8')).join('\n').replace(/\s+/g, '')
  check('the block is centred', /\.pomo\{[^}]*align-items:center/.test(css))
  check('it is ruled off from the nav and the mark',
    /\.pomo\{[^}]*border-top:1pxsolid/.test(css) && /\.pomo\{[^}]*border-bottom:1pxsolid/.test(css))
  // Sized against the window now, so the rail fits a laptop screen without a
  // scrollbar hiding the mark at its foot.
  check('the fruit is sized against the window', /pomo-face\{[^}]*width:clamp\(/.test(css))
  check('the clock is bigger than it was', /pomo-clock\{[^}]*font-size:22px/.test(css))
  check('clock and phase share the fruit\'s colour',
    /pomo-clock\{[^}]*color:var\(--pomo-ink\)/.test(css) && /pomo-phase\{[^}]*color:var\(--pomo-ink\)/.test(css))
  check('and the clock is the brighter of the two', /pomo-clock\{[^}]*filter:brightness/.test(css))

  const icons = [...pomo.querySelectorAll('.pomo-keys svg')]
  check('the transport icons are bigger', icons.every((i) => i.getAttribute('width') === '16'),
    icons.map((i) => i.getAttribute('width')).join(','))
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
  for (const id of madeSections) await del(`/api/sections/${id}`)
  console.log(`cleanup: ${(await json(`/api/days/${DAY}`)).tasks.length} tasks left`)
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
