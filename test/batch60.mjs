/**
 * One exchange, seen as one thing across three columns.
 *
 * The point of the design is that nothing new renders it — the ordinary grid,
 * drag targets and cursor all ask one grading function where a task belongs.
 * So this drives the real section and asserts the meaning changed while the
 * machinery did not.
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-06-05'
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

const dt = () => {
  const store = new Map()
  return {
    types: [], setData: (k, v) => { store.set(k, v) },
    getData: (k) => store.get(k) || '', effectAllowed: '', dropEffect: '',
  }
}
const fire = (el, type, data, win) => {
  const ev = new win.Event(type, { bubbles: true, cancelable: true })
  ev.dataTransfer = data
  el.dispatchEvent(ev)
}

try {
  const ai = await post('/api/sections', { date: D, name: 'ZZ exchange', kind: 'ai' })

  // The shape the AI produces: a brief you wrote, an answer pointing back at
  // it, a follow-up under that answer, and a step the agent raised for itself.
  const brief = await post('/api/tasks', {
    title: 'ZZ rewrite the drag layer', scheduled_date: D, section_id: ai.id,
  })
  const answer = await post('/api/tasks', {
    title: 'ZZ what I did', scheduled_date: D, section_id: ai.id,
    origin: 'ai', ai_role: 'answer', answers_id: brief.id, waiting_on: 'human',
  })
  const followup = await post('/api/tasks', {
    title: 'ZZ check the drop targets yourself', scheduled_date: D, section_id: ai.id,
    origin: 'ai', ai_role: 'check', waiting_on: 'human',
  })
  await post(`/api/tasks/${followup.id}/nest`, { parent_id: answer.id })

  // A second, unrelated exchange — a tint means nothing if everything shares it.
  const other = await post('/api/tasks', {
    title: 'ZZ a separate question', scheduled_date: D, section_id: ai.id,
  })

  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e).slice(0, 140)))
  const dom = await JSDOM.fromURL(`${BASE}/day/${D}`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
      w.localStorage.setItem('vim_mode', '1')
    },
  })
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3400)
  for (let i = 0; i < 150 && !document.querySelector(`.task[data-task-id="${brief.id}"]`); i++) {
    await wait(150)
  }

  const row = (id) => document.querySelector(`.task[data-task-id="${id}"]`)
  const tintOf = (id) => (row(id)?.className.match(/thread-(\d)/) || [])[1] ?? null

  // ── the tint says they belong together ───────────────────────────────────
  check('the brief is marked as part of an exchange',
    row(brief.id)?.classList.contains('in-thread'), row(brief.id)?.className)
  check('so is the answer', row(answer.id)?.classList.contains('in-thread'))
  check('and the follow-up under it', row(followup.id)?.classList.contains('in-thread'))
  check('all three share one tint',
    tintOf(brief.id) !== null && tintOf(brief.id) === tintOf(answer.id)
      && tintOf(brief.id) === tintOf(followup.id),
    `${tintOf(brief.id)} ${tintOf(answer.id)} ${tintOf(followup.id)}`)
  check('a task on its own is not tinted at all',
    !row(other.id)?.classList.contains('in-thread'), row(other.id)?.className)

  // ── and the link says which one ──────────────────────────────────────────
  const back = row(answer.id)?.querySelector('.thread-link')
  check('the answer links back to the brief', !!back, row(answer.id)?.innerHTML?.slice(0, 200))
  check('naming it, not just pointing', /rewrite the drag layer/.test(back?.textContent || ''),
    back?.textContent)

  const fwd = row(brief.id)?.querySelector('.thread-link')
  check('the brief says it has a reply', /1 reply/.test(fwd?.textContent || ''), fwd?.textContent)

  fwd?.click()
  await wait(400)
  check('and following it marks where you land',
    row(answer.id)?.classList.contains('is-flashed'), row(answer.id)?.className)

  back?.click()
  await wait(400)
  check('the link back marks the brief', row(brief.id)?.classList.contains('is-flashed'),
    row(brief.id)?.className)

  // ── pointing at one lights the exchange ──────────────────────────────────
  row(brief.id).dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }))
  row(brief.id).dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: false }))
  await wait(500)
  check('pointing at the brief lights the answer too',
    row(answer.id)?.classList.contains('thread-lit'), row(answer.id)?.className)
  check('and the follow-up', row(followup.id)?.classList.contains('thread-lit'))
  check('but not the unrelated one',
    !row(other.id)?.classList.contains('thread-lit'), row(other.id)?.className)

  row(brief.id).dispatchEvent(new window.MouseEvent('mouseout', {
    bubbles: true, relatedTarget: document.body,
  }))
  row(brief.id).dispatchEvent(new window.MouseEvent('mouseleave', { bubbles: false }))
  await wait(500)
  check('and it goes out again', !row(answer.id)?.classList.contains('thread-lit'))

  // ── and the keyboard lights it too ───────────────────────────────────────
  // Hover is no use to someone navigating with j and k, which on this project
  // is most of the time.
  const key = (k, init = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...init,
  }))
  key('Escape'); await wait(200)
  key('/'); await wait(300)
  const box = document.querySelector('.vim-cmd-input')
  if (box) {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(box, 'rewrite the drag layer')
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    box.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await wait(900)
  }
  // Whichever end it lands on. The backlink chip carries the brief's title, so
  // searching for it finds the answer as well — which is right: an exchange
  // should be findable from either end.
  const landed = Number(document.querySelector('.task.vim-on')?.dataset.taskId)
  check('the cursor reached the exchange',
    [brief.id, answer.id, followup.id].includes(landed), String(landed))
  check('and lights the rest of the exchange with it',
    row(answer.id)?.classList.contains('thread-cursor'), row(answer.id)?.className)
  check('the unrelated task stays dark',
    !row(other.id)?.classList.contains('thread-cursor'), row(other.id)?.className)

  check('no page error', errors.length === 0, errors.join(' | '))
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
  for (const d of doms) { try { d.window.close() } catch { /* gone */ } }
  process.exit(bad ? 1 : 0)
}
