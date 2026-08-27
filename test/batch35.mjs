/** Deleting a section takes its work; moving a task lands it open and counted. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const A = '2029-12-11', B = '2029-12-12', C = '2029-12-13'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const load = async (d) => {
  const day = await json(`/api/days/${d}`)
  const open = day.tasks.filter((t) => t.kind !== 'note' && ['todo', 'doing'].includes(t.status))
  return {
    tasks: day.tasks.length,
    open: open.length,
    minutes: open.reduce((s, t) => s + (t.estimate_min || 0), 0),
    sections: day.sections.length,
    rows: day.tasks.map((t) => `${t.title}:${t.status}`).join(','),
  }
}

try {
  // ---------------------------------------------------- deleting a section
  const sec = await post('/api/sections', { date: A, name: 'ZZ Doomed', color: 'teal' })
  const p1 = await post('/api/tasks', { title: 'ZZ dp', scheduled_date: A, section_id: sec.id })
  const c1 = await post('/api/tasks', { title: 'ZZ dc', scheduled_date: A, section_id: sec.id })
  await post(`/api/tasks/${c1.id}/nest`, { parent_id: p1.id })
  // Deliberately WITHOUT a section: a descendant that lost its section_id must
  // still go, or it survives its own parent as a loose task.
  const g1 = await post('/api/tasks', { title: 'ZZ dg', scheduled_date: A })
  await post(`/api/tasks/${g1.id}/nest`, { parent_id: c1.id })
  const note = await post('/api/tasks', { title: 'ZZ dn', kind: 'note', scheduled_date: A, section_id: sec.id })

  check('the section starts with its work', (await load(A)).tasks === 4, JSON.stringify(await load(A)))

  const gone = await json(`/api/sections/${sec.id}`, { method: 'DELETE' })
  const after = await load(A)
  check('deleting a section deletes the tasks in it', after.tasks === 0, after.rows)
  check('nothing is orphaned into the loose list', after.tasks === 0 && after.sections === 0,
    JSON.stringify(after))
  check('a descendant with no section of its own goes too',
    !(await json(`/api/tasks/${g1.id}`)).id, 'the grandchild survived')
  check('a note in the section goes as well',
    !(await json(`/api/tasks/${note.id}`)).id, 'the note survived')
  check('the reply carries every deleted row for undo',
    gone.tasks?.length === 4, `${gone.tasks?.length} rows`)
  check('and the section row itself', gone.section?.name === 'ZZ Doomed', gone.section?.name)

  // Undo: section first, then tasks parents-first.
  await post('/api/sections/restore', gone.section)
  const byId = new Map(gone.tasks.map((t) => [t.id, t]))
  const done = new Set(); const order = []
  const emit = (t) => {
    if (!t || done.has(t.id)) return
    emit(byId.get(t.parent_id))
    done.add(t.id); order.push(t)
  }
  gone.tasks.forEach(emit)
  for (const t of order) await post('/api/tasks/restore', t)

  const back = await load(A)
  check('undo puts the section and its work back', back.tasks === 4 && back.sections === 1,
    JSON.stringify(back))
  check('with the nesting intact',
    (await json(`/api/tasks/${g1.id}`)).parent_id === c1.id,
    `${(await json(`/api/tasks/${g1.id}`)).parent_id}`)
  check('and the grandchild still has no section, as before',
    (await json(`/api/tasks/${g1.id}`)).section_id === null,
    `${(await json(`/api/tasks/${g1.id}`)).section_id}`)

  await json(`/api/sections/${sec.id}`, { method: 'DELETE' })

  // ------------------------------------------------------- moving a task
  const sec2 = await post('/api/sections', { date: B, name: 'ZZ Band', layout: 'columns' })
  const m = await post('/api/tasks', { title: 'ZZ mover', scheduled_date: B, section_id: sec2.id, estimate_min: 60 })
  const mk = await post('/api/tasks', { title: 'ZZ moverkid', scheduled_date: B, section_id: sec2.id, estimate_min: 30 })
  await post(`/api/tasks/${mk.id}/nest`, { parent_id: m.id })

  const vc = new VirtualConsole()
  const errors = []
  vc.on('jsdomError', (e) => errors.push(e.message))
  dom = await JSDOM.fromURL(`${BASE}/day/${B}`, {
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
  check('day: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const row = [...document.querySelectorAll('.task')]
    .find((r) => /^ZZ mover$/.test(r.querySelector('.task-title')?.textContent.trim() || ''))
  const more = [...(row?.querySelectorAll('button') || [])].find((b) => b.getAttribute('title') === 'More')
  check('the row has an overflow menu', !!more)
  more?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(500)
  const moveTo = [...document.querySelectorAll('.menu-item')].find((b) => /Move to/.test(b.textContent))
  check('the menu offers Move to', !!moveTo)
  moveTo?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(400)
  const tomorrow = [...document.querySelectorAll('.menu-sub-body .menu-item')]
    .find((b) => /Tomorrow/.test(b.textContent))
  check('and Tomorrow inside it', !!tomorrow)
  tomorrow?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(1600)

  const from = await load(B)
  const to = await load(C)
  check('the task leaves the day it was on', from.tasks === 0, from.rows)
  check('and arrives on the next one, with its subtask', to.tasks === 2, to.rows)
  check('it arrives OPEN, not marked as moved away',
    !to.rows.includes('moved'), to.rows)
  check('so the target day counts all of its time', to.minutes === 90, `${to.minutes} minutes`)
  check('the band is rebuilt on the target day', to.sections === 1, `${to.sections}`)

  const moved = (await json(`/api/days/${C}`)).tasks.find((t) => t.title === 'ZZ mover')
  const kid = (await json(`/api/days/${C}`)).tasks.find((t) => t.title === 'ZZ moverkid')
  check('the root sits in the rebuilt band',
    moved?.section_id === (await json(`/api/days/${C}`)).sections[0]?.id,
    `${moved?.section_id}`)
  check('the subtask hangs off it', kid?.parent_id === moved?.id, `${kid?.parent_id}`)
  check('and does not still claim a section on the old day',
    kid?.section_id === null || kid?.section_id === moved?.section_id,
    `${kid?.section_id}`)
  check('moved_to_date is cleared — it arrived, it was not pushed on',
    moved?.moved_to_date === null, `${moved?.moved_to_date}`)
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
  for (const d of [A, B, C]) {
    const day = await json(`/api/days/${d}`).catch(() => ({ tasks: [], sections: [] }))
    for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
    for (const s of day.sections) await del(`/api/sections/${s.id}`)
  }
  console.log('cleanup: probe days cleared')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
