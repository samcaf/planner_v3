/**
 * Writing instructions for the agent, from the row and from the conversation.
 *
 * The point of the design is that nothing new renders it — the ordinary grid,
 * drag targets and cursor all ask one grading function where a task belongs.
 * So this drives the real section and asserts the meaning changed while the
 * machinery did not.
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-08-09'
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
  const sec = await post('/api/sections', {
    date: D, name: 'ZZ prompt ui', kind: 'ai',
    ai_prompt: 'ZZ conversation-wide instruction',
  })
  const task = await post('/api/tasks', {
    title: 'ZZ a task', scheduled_date: D, section_id: sec.id,
  })
  const plain = await post('/api/sections', { date: D, name: 'ZZ ordinary', layout: 'columns' })
  const plainTask = await post('/api/tasks', {
    title: 'ZZ ordinary work', scheduled_date: D, section_id: plain.id,
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
    },
  })
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3400)
  for (let i = 0; i < 150 && !document.querySelector(`.task[data-task-id="${task.id}"]`); i++) {
    await wait(150)
  }

  const row = (id) => document.querySelector(`.task[data-task-id="${id}"]`)
  const panel = (id) => document.querySelector(`.panel.section[data-section-id="${id}"]`)

  check('a conversational row offers a prompt', !!row(task.id)?.querySelector('.aip-open'))
  check('an ordinary row does not', !row(plainTask.id)?.querySelector('.aip-open'))
  check('and the conversation offers one of its own',
    !!panel(sec.id)?.querySelector('.section-h .aip-open'))
  check('marked as already having something',
    panel(sec.id)?.querySelector('.section-h .aip-open')?.classList.contains('is-set'),
    panel(sec.id)?.querySelector('.section-h .aip-open')?.className)
  check('while the task has nothing yet',
    !row(task.id)?.querySelector('.aip-open')?.classList.contains('is-set'))

  // ── writing one from the row ---------------------------------------------
  row(task.id).querySelector('.aip-open').click()
  await wait(600)
  const box = row(task.id)?.querySelector('.aip-text')
  check('it opens a box to write in', !!box, row(task.id)?.querySelector('.ai-prompt')?.innerHTML?.slice(0, 120))

  check('showing what already applies from above',
    /conversation-wide instruction/.test(row(task.id)?.querySelector('.aip-body')?.textContent || ''),
    row(task.id)?.querySelector('.aip-body')?.textContent?.slice(0, 160))
  check('and saying they stack rather than replace',
    /stack/.test(row(task.id)?.querySelector('.aip-hint')?.textContent || ''),
    row(task.id)?.querySelector('.aip-hint')?.textContent)

  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  set.call(box, 'ZZ only for this task')
  box.dispatchEvent(new window.Event('input', { bubbles: true }))
  // React listens for focusout, not blur — a bare 'blur' event never reaches
  // its onBlur, and the field would look as though it had refused to save.
  box.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
  await wait(1200)

  const stored = await json(`/api/tasks/${task.id}`)
  check('what is typed is stored on the task', stored.ai_prompt === 'ZZ only for this task',
    stored.ai_prompt)
  check('and the notes are untouched', !stored.notes, JSON.stringify(stored.notes))
  check('the conversation keeps its own',
    (await json(`/api/days/${D}`)).sections.find((x) => x.id === sec.id)?.ai_prompt
      === 'ZZ conversation-wide instruction')

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
