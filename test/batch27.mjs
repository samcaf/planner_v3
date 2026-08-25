/** Sub-section bands: grandchildren visible, drag out, recursive time, collapse. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2029-03-11'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom
const made = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function task(title, extra, parent, sectionId) {
  const t = await post('/api/tasks', {
    title, scheduled_date: D, section_id: sectionId ?? null, ...extra,
  })
  made.push(t.id)
  if (parent) await post(`/api/tasks/${t.id}/nest`, { parent_id: parent })
  return t.id
}

try {
  const sec = await post('/api/sections', { date: D, name: 'ZZ-sub', layout: 'columns' })

  //     HEAD (subsection, 5m of its own)
  //       KID   (20m)
  //         GRAND (90m)          <- must be visible, and must count
  //     OUTSIDE (5m, main body)
  const head = await task('ZZ-HEAD', { subsection: 1, estimate_min: 5 }, null, sec.id)
  const kid = await task('ZZ-KID', { estimate_min: 20 }, head, sec.id)
  const grand = await task('ZZ-GRAND', { estimate_min: 90 }, kid, sec.id)
  const outside = await task('ZZ-OUTSIDE', { estimate_min: 5 }, null, sec.id)

  const vc = new VirtualConsole()
  const errors = []
  vc.on('jsdomError', (e) => errors.push(e.message))
  dom = await JSDOM.fromURL(`${BASE}/day/${D}`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
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
  const { window } = dom
  const { document } = window
  await wait(3200)
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const band = document.querySelector('.subsec')
  check('the sub-section renders as a band', !!band)

  const titles = () => [...document.querySelectorAll('.subsec .task-title')].map((e) => e.textContent.trim())

  // --- 1. children of children are visible --------------------------------
  check('the grandchild is drawn inside the band', titles().includes('ZZ-GRAND'), titles().join(' | '))
  check('the child is drawn too', titles().includes('ZZ-KID'), titles().join(' | '))
  check('the heading appears exactly once', titles().filter((t) => t === 'ZZ-HEAD').length === 1,
    titles().join(' | '))
  check('and the grandchild is not duplicated', titles().filter((t) => t === 'ZZ-GRAND').length === 1,
    titles().join(' | '))

  // --- 2. recursive summed time on the heading ----------------------------
  const rowFor = (name) => [...document.querySelectorAll('.task')]
    .find((r) => r.querySelector('.task-title')?.textContent.trim() === name)
  // The glyph puts its figure in `title`, and rounds it to the nearest half
  // hour, so the assertion is on the rounded number the user actually sees.
  const glyphMin = (name) => {
    const t = rowFor(name)?.querySelector('.time-glyph')?.getAttribute('title') || ''
    const m = /— (\d+) minutes/.exec(t)
    return m ? Number(m[1]) : null
  }

  // Quarter-hour rounding throughout, so these are the figures on screen:
  //   HEAD  5 + 20 + 90 = 115 -> 120   (own time ON TOP of the branch)
  //   KID       20 + 90 = 110 -> 105
  //   GRAND          90        ->  90
  // HEAD and KID differing is the point: a heading blind to its grandchild
  // would read 15, and one that forgot its own 5 minutes would read 105.
  check('the heading counts its whole branch, grandchildren included',
    glyphMin('ZZ-HEAD') === 120, `${glyphMin('ZZ-HEAD')} minutes`)
  check('and adds its own time on top of it',
    glyphMin('ZZ-HEAD') !== glyphMin('ZZ-KID'),
    `head ${glyphMin('ZZ-HEAD')} vs child ${glyphMin('ZZ-KID')}`)
  check('the child counts its own branch', glyphMin('ZZ-KID') === 105, `${glyphMin('ZZ-KID')} minutes`)
  check('the leaf counts only itself', glyphMin('ZZ-GRAND') === 90, `${glyphMin('ZZ-GRAND')} minutes`)
  // 5 minutes rounds to nothing, so this one reads as "no estimate".
  check('a five-minute row outside the band reads as no estimate',
    glyphMin('ZZ-OUTSIDE') === null, `${glyphMin('ZZ-OUTSIDE')} minutes`)

  // --- 4. the band collapses ----------------------------------------------
  const twist = band?.querySelector('.subsec-twist')
  check('the band has a collapse control', !!twist)
  check('it says what it does',
    /minimis|show/i.test(twist?.getAttribute('title') || ''), twist?.getAttribute('title'))
  check('it starts expanded', twist?.getAttribute('aria-expanded') === 'true')

  twist?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(200)
  check('collapsing hides what is under it', !titles().includes('ZZ-KID'), titles().join(' | '))
  check('but keeps the heading', titles().includes('ZZ-HEAD'), titles().join(' | '))
  twist?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(200)
  check('and it opens again', titles().includes('ZZ-GRAND'), titles().join(' | '))

  // --- 3. dragging a band child out into the main body --------------------
  const dt = () => {
    const store = new Map()
    return {
      types: ['text/task-id'],
      setData: (k, v) => store.set(k, v),
      getData: (k) => store.get(k) || '',
      effectAllowed: '', dropEffect: '',
    }
  }
  const fire = (el, type, dataTransfer) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true })
    ev.dataTransfer = dataTransfer
    el.dispatchEvent(ev)
    return ev
  }

  // The section's own grid, not the band's: last .box-cols outside .subsec.
  const mainCols = [...document.querySelectorAll('.box-cols')]
    .filter((c) => !c.closest('.subsec'))
  check('the section has a main grid to drag into', mainCols.length > 0, `${mainCols.length} found`)

  const target = mainCols[0]?.querySelectorAll('.box-col')[2]
  const carrier = dt()
  carrier.setData('text/task-id', String(kid))
  fire(target, 'dragover', carrier)
  fire(target, 'drop', carrier)
  await wait(900)

  const after = await json(`/api/tasks/${kid}`)
  check('dragging a band child to the main grid detaches it',
    after.parent_id === null, `parent_id=${after.parent_id}`)
  check('it lands in the column it was dropped on', after.col_index === 2, `col_index=${after.col_index}`)
  check('it keeps the section, or it would vanish from the day',
    after.section_id === sec.id, `section_id=${after.section_id} want ${sec.id}`)

  const grandAfter = await json(`/api/tasks/${grand}`)
  check('the grandchild travels with it', grandAfter.parent_id === kid, `parent_id=${grandAfter.parent_id}`)

  // --- and back in again ---------------------------------------------------
  await wait(400)
  const band2 = document.querySelector('.subsec')
  const bandCol = band2?.querySelectorAll('.box-cols')[0]?.querySelectorAll('.box-col')[1]
  const carrier2 = dt()
  carrier2.setData('text/task-id', String(kid))
  fire(bandCol, 'dragover', carrier2)
  fire(bandCol, 'drop', carrier2)
  await wait(900)

  const back = await json(`/api/tasks/${kid}`)
  check('dropping it on the band puts it back under the heading',
    back.parent_id === head, `parent_id=${back.parent_id} want ${head}`)
  check('and it still carries the section', back.section_id === sec.id, `section_id=${back.section_id}`)

  // --- undo covers the re-parent, not just the column ---------------------
  const undoBtn = [...document.querySelectorAll('button')]
    .find((b) => /undo/i.test(b.getAttribute('aria-label') || b.title || ''))
  if (undoBtn) {
    undoBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await wait(900)
    const undone = await json(`/api/tasks/${kid}`)
    check('Ctrl-Z puts the parent back as well as the column',
      undone.parent_id === null, `parent_id=${undone.parent_id}`)
  } else {
    check('an undo control exists', false, 'not found')
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
  dom?.window?.close()
  const day = await json(`/api/days/${D}`).catch(() => ({ tasks: [], sections: [] }))
  for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
  for (const s of day.sections) await del(`/api/sections/${s.id}`)
  console.log('cleanup: probe day cleared')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
