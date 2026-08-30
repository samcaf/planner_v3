/**
 * An AI section: the three boxes are the turn, and rows carry terms.
 *
 * The point of the design is that nothing new renders it — the ordinary grid,
 * drag targets and cursor all ask one grading function where a task belongs.
 * So this drives the real section and asserts the meaning changed while the
 * machinery did not.
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-06-02'
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
  const ai = await post('/api/sections', { date: D, name: 'ZZ conversation', kind: 'ai' })
  const work = await post('/api/sections', { date: D, name: 'ZZ ordinary', layout: 'columns' })
  // A second conversation whose terms are set from the start. The app does not
  // poll, so anything created after the page loads would never reach it.
  const termed = await post('/api/sections', {
    date: D, name: 'ZZ with terms', kind: 'ai',
    ai_switches: JSON.stringify({ mode: 'build' }),
  })

  check('an AI section is three-box without being asked', ai.layout === 'columns', ai.layout)

  const brief = await post('/api/tasks', {
    title: 'ZZ the brief', scheduled_date: D, section_id: ai.id, notes: 'what I want',
  })
  check('a task written into it is the AI\'s move', brief.waiting_on === 'ai', brief.waiting_on)

  const question = await post('/api/tasks', {
    title: 'ZZ a question', scheduled_date: D, section_id: ai.id,
    waiting_on: 'human', origin: 'ai', ai_role: 'question', seen: 0,
  })
  const settled = await post('/api/tasks', {
    title: 'ZZ settled', scheduled_date: D, section_id: ai.id, waiting_on: null, status: 'done',
  })
  const under = await post('/api/tasks', {
    title: 'ZZ under terms', scheduled_date: D, section_id: termed.id,
  })
  // An ordinary task, to prove nothing changed for the rest of the day.
  const plain = await post('/api/tasks', {
    title: 'ZZ plain work', scheduled_date: D, section_id: work.id, estimate_min: 5,
  })
  check('an ordinary section still leaves the turn alone', plain.waiting_on === null,
    String(plain.waiting_on))

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
  for (let i = 0; i < 150 && !document.querySelector(`.task[data-task-id="${brief.id}"]`); i++) {
    await wait(150)
  }

  const panel = (id) => document.querySelector(`.panel.section[data-section-id="${id}"]`)
  const row = (id) => document.querySelector(`.task[data-task-id="${id}"]`)
  const colOf = (id) => {
    const el = row(id)?.closest('.box-col')
    if (!el) return null
    return [...el.parentElement.children].filter((c) => c.classList.contains('box-col')).indexOf(el)
  }

  // ── the boxes mean the turn ──────────────────────────────────────────────
  check('the conversation is on the page', !!panel(ai.id))
  check('and marked as one', panel(ai.id)?.classList.contains('is-dialogue'),
    panel(ai.id)?.className)

  const heads = [...panel(ai.id).querySelectorAll('.box-col')]
    .map((c) => c.textContent.slice(0, 24))
  check('its boxes are labelled by turn',
    /Yours/.test(heads[0] || '') && /Theirs/.test(heads[1] || '') && /Settled/.test(heads[2] || ''),
    heads.join(' | '))

  check('a task waiting on the AI sits in Theirs', colOf(brief.id) === 1, String(colOf(brief.id)))
  check('a question sits in Yours', colOf(question.id) === 0, String(colOf(question.id)))
  check('and a finished one in Settled', colOf(settled.id) === 2, String(colOf(settled.id)))

  const workHeads = [...panel(work.id).querySelectorAll('.box-col')]
    .map((c) => c.textContent.slice(0, 24))
  check('an ordinary section keeps its own labels',
    !/Yours/.test(workHeads.join('')), workHeads.join(' | '))
  check('and still grades by duration — 5m is Quick', colOf(plain.id) === 0, String(colOf(plain.id)))

  // ── who wrote it ─────────────────────────────────────────────────────────
  check('an AI-written row says so', !!row(question.id)?.querySelector('.ai-badge'))
  check('and shows its part in the exchange',
    /question/.test(row(question.id)?.querySelector('.ai-role')?.textContent || ''),
    row(question.id)?.querySelector('.ai-role')?.textContent)
  check('an unread one is marked', row(question.id)?.classList.contains('is-unread'),
    row(question.id)?.className)
  check('a row you wrote is not badged', !row(brief.id)?.querySelector('.ai-badge'))

  // ── terms instead of times ───────────────────────────────────────────────
  check('a conversational row offers terms', !!row(brief.id)?.querySelector('.ais-open'))
  check('and shows no clock', !row(brief.id)?.querySelector('.task-meta .chip.c-blue'))
  check('an ordinary row does not offer terms', !row(plain.id)?.querySelector('.ais-open'))

  check('nothing is set, so nothing is shown',
    row(brief.id).querySelectorAll('.ais-chip').length === 0,
    String(row(brief.id).querySelectorAll('.ais-chip').length))

  // A conversation's terms are stated once, on the conversation. Stamping them
  // on every row in it would be noise: what a row shows is what is unusual
  // about THAT row.
  const sectionChips = [...(panel(termed.id)?.querySelectorAll('.section-h .ais-chip') || [])]
    .map((c) => c.textContent)
  check('the conversation states its own terms', sectionChips.includes('build'),
    sectionChips.join(','))
  const chips = [...(row(under.id)?.querySelectorAll('.ais-chip') || [])].map((c) => c.textContent)
  check('and a row inheriting them shows nothing', chips.length === 0, chips.join(','))
  const stored = await json(`/api/tasks/${under.id}`)
  check('and nothing was written on the task itself', !stored.ai_switches, stored.ai_switches)

  // ── setting from the row, several in a row ───────────────────────────────
  row(under.id).querySelector('.ais-open').click()
  await wait(700)

  const pick = (name, want) => [...document.querySelectorAll('.ais-menu .ais-row')]
    .find((r) => r.querySelector('.ais-name')?.textContent === name)
    ?.querySelector(`button[aria-checked="false"]${want ? '' : ''}`)
  const pickValue = (name, want) => [...document.querySelectorAll('.ais-menu .ais-row')]
    .find((r) => r.querySelector('.ais-name')?.textContent === name)
    ?.querySelector([...document.querySelectorAll('.ais-menu button')].length ? 'button' : 'button')

  const option = (name, want) => {
    const r = [...document.querySelectorAll('.ais-menu .ais-row')]
      .find((x) => x.querySelector('.ais-name')?.textContent === name)
    return [...(r?.querySelectorAll('button') || [])].find((b) => b.textContent.trim() === want)
  }

  check('the terms open for editing', !!option('Verify', 'reproduce'),
    [...document.querySelectorAll('.ais-menu .ais-name')].map((r) => r.textContent).join('|'))
  check('every option carries its own explanation',
    (option('Depth', '0')?.getAttribute('title') || '').length > 20,
    option('Depth', '0')?.getAttribute('title'))
  check('and the switch itself explains what it is',
    ([...document.querySelectorAll('.ais-menu .ais-name')]
      .find((n) => n.textContent === 'Budget')?.getAttribute('title') || '').length > 60,
    [...document.querySelectorAll('.ais-menu .ais-name')]
      .find((n) => n.textContent === 'Budget')?.getAttribute('title'))

  // Three clicks with no pause. Each used to be computed from the row as the
  // server last described it, so the second wiped the first.
  option('Verify', 'reproduce')?.click()
  option('Depth', '0')?.click()
  option('Sign-off', 'none')?.click()
  await wait(1800)

  const afterSet = await json(`/api/tasks/${under.id}`)
  const stored2 = JSON.parse(afterSet.ai_switches || '{}')
  check('three clicked in a row all stick',
    stored2.verify === 'reproduce' && stored2.depth === '0' && stored2.sign_off === 'none',
    afterSet.ai_switches)
  check('and none copied the inherited ones down', stored2.mode === undefined,
    afterSet.ai_switches)

  // ── dragging hands the turn over ─────────────────────────────────────────
  // The same gesture that re-times a task in an ordinary section. Nothing here
  // is new code — the drop target is the one the day already had.
  const yours = [...panel(ai.id).querySelectorAll('.box-col')][0]
  const carrier = dt()
  fire(row(brief.id), 'dragstart', carrier, window)
  fire(yours, 'dragover', carrier, window)
  fire(yours, 'drop', carrier, window)
  await wait(1400)

  const handed = await json(`/api/tasks/${brief.id}`)
  check('dragging a card into Yours makes it your move', handed.waiting_on === 'human',
    String(handed.waiting_on))
  check('and does not write a duration behind your back', handed.col_index === null,
    String(handed.col_index))
  check('the card moved with it', colOf(brief.id) === 0, String(colOf(brief.id)))

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
