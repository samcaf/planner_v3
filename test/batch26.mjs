/** Moving a nested task carries its parents and its band; the aside resizes. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D1 = '2029-02-05'
const D2 = '2029-02-06'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })

async function chain(titles, date, sectionId) {
  const ids = []
  let parent = null
  for (const title of titles) {
    const t = await post('/api/tasks', {
      title, scheduled_date: date, section_id: parent ? null : sectionId,
    })
    if (parent) await post(`/api/tasks/${t.id}/nest`, { parent_id: parent })
    parent = t.id
    ids.push(t.id)
  }
  return ids
}

const paths = async (date) => {
  const { tasks } = await json(`/api/days/${date}`)
  const by = new Map(tasks.map((t) => [t.id, t]))
  const line = (t) => {
    const parts = [t.title]
    let cur = t
    while (cur.parent_id && by.has(cur.parent_id)) { cur = by.get(cur.parent_id); parts.unshift(cur.title) }
    return parts.join(' > ')
  }
  return tasks.filter((t) => !tasks.some((c) => c.parent_id === t.id)).map(line).sort()
}

try {
  const sec = await post('/api/sections', { date: D1, name: 'ZZ-band', color: 'teal', layout: 'columns' })
  const ids = await chain(['ZZ-A', 'ZZ-B', 'ZZ-C'], D1, sec.id)

  // --- moving the leaf takes its ancestry and its band --------------------
  await post(`/api/tasks/${ids[2]}/move`, { date: D2 })
  const d2 = await json(`/api/days/${D2}`)
  const moved = d2.tasks.find((t) => t.title === 'ZZ-C')
  const band = d2.sections.find((s) => s.name === 'ZZ-band')

  check('the whole path is rebuilt on the target day',
    (await paths(D2)).join(' | ') === 'ZZ-A > ZZ-B > ZZ-C', (await paths(D2)).join(' | '))
  check('its parent is a task on that day',
    d2.tasks.some((t) => t.id === moved?.parent_id), `parent_id=${moved?.parent_id}`)
  check('the band is copied across', !!band, 'no section on the target day')
  check('with its colour and layout', band?.color === 'teal' && band?.layout === 'columns',
    `${band?.color}/${band?.layout}`)
  check('the rebuilt root sits in the band',
    d2.tasks.find((t) => t.title === 'ZZ-A')?.section_id === band?.id)
  check('and the nested rows do not also claim it',
    d2.tasks.filter((t) => t.title !== 'ZZ-A').every((t) => t.section_id === null),
    d2.tasks.map((t) => `${t.title}:${t.section_id}`).join(' '))

  // --- moving a second leaf joins the tree already there ------------------
  const more = await chain(['ZZ-A', 'ZZ-B', 'ZZ-D'], D1, sec.id)
  await post(`/api/tasks/${more[2]}/move`, { date: D2 })
  const after = await paths(D2)
  check('a second arrival joins the same parents',
    after.join(' | ') === 'ZZ-A > ZZ-B > ZZ-C | ZZ-A > ZZ-B > ZZ-D', after.join(' | '))

  const d2b = await json(`/api/days/${D2}`)
  check('no duplicate ancestors were made',
    d2b.tasks.filter((t) => t.title === 'ZZ-A').length === 1
      && d2b.tasks.filter((t) => t.title === 'ZZ-B').length === 1,
    d2b.tasks.map((t) => t.title).join(' '))
  check('and no second band', d2b.sections.filter((s) => s.name === 'ZZ-band').length === 1)

  // --- copying does the same but leaves the original ----------------------
  const D3 = '2029-02-07'
  const copy = await post(`/api/tasks/${ids[2]}/move`, { date: D3, copy: true })
  check('the original stays where it was',
    (await json(`/api/tasks/${ids[2]}`)).scheduled_date === D2)
  check('the copy gets its ancestry too',
    (await paths(D3)).join(' | ') === 'ZZ-A > ZZ-B > ZZ-C', (await paths(D3)).join(' | '))
  check('and its band', (await json(`/api/days/${D3}`)).sections.some((s) => s.name === 'ZZ-band'))
  check('a copy is not flagged as pushed on', copy.moved_to_date === null)

  // --- the day's side column can be dragged -------------------------------
  const vc = new VirtualConsole()
  const errors = []
  vc.on('jsdomError', (e) => errors.push(e.message))
  dom = await JSDOM.fromURL(`${BASE}/day/${D2}`, {
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
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  await wait(3000)
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const wrap = document.querySelector('.day-wrap')
  const grip = wrap?.querySelector('.grip-v')
  check('the side column has a handle', !!grip)
  check('it announces what it does', grip?.getAttribute('aria-label') === 'Resize the side column')

  const widthOf = () => {
    const m = /minmax\(0,\s*1fr\)\s+4px\s+(\d+)px/.exec(wrap.getAttribute('style') || '')
    return m ? Number(m[1]) : null
  }
  const before = widthOf()
  check('it starts at the stored width', before !== null, wrap?.getAttribute('style'))

  const drag = (dx) => {
    grip.setPointerCapture = () => {}
    grip.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 500 }))
    window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 500 + dx }))
    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }))
  }

  // Left widens it: the handle sits on the column's inner edge.
  drag(-60)
  await wait(250)
  check('dragging left widens it', widthOf() === before + 60, `${before} -> ${widthOf()}`)

  drag(40)
  await wait(250)
  check('dragging right narrows it', widthOf() === before + 20, `${widthOf()}`)

  // It must not be draggable to nothing, nor past its cap.
  drag(-9999)
  await wait(250)
  check('it stops at a usable maximum', widthOf() === 560, `${widthOf()}`)
  drag(9999)
  await wait(250)
  check('and never collapses away', widthOf() === 240, `${widthOf()}`)

  grip.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
  await wait(250)
  check('double-click puts it back to the default', widthOf() === 340, `${widthOf()}`)

  check('the width is remembered', window.localStorage.getItem('day_aside_width') === '340',
    window.localStorage.getItem('day_aside_width'))
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  dom?.window?.close()
  for (const d of [D1, D2, '2029-02-07']) {
    const day = await json(`/api/days/${d}`).catch(() => ({ tasks: [], sections: [] }))
    for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
    for (const s of day.sections) await del(`/api/sections/${s.id}`)
  }
  console.log('cleanup: probe days cleared')
}
