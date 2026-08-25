/** A project's note sections can be archived rather than only deleted. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
let projectId = null

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const patch = (p, b) => json(p, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function openPage(url, errors) {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(e.message))
  return JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.confirm = () => true
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

try {
  const proj = await post('/api/projects', { name: 'ZZ ArchiveProj' })
  projectId = proj.id
  const mk = async (title) =>
    (await post('/api/tasks', { title, kind: 'note', project_id: proj.id, notes: `${title} body` })).id
  const a = await mk('ZZ Sec Alpha')
  const b = await mk('ZZ Sec Beta')
  const c = await mk('ZZ Sec Gamma')

  // --- the field itself ----------------------------------------------------
  check('a note section starts unarchived', (await json(`/api/tasks/${a}`)).archived === 0,
    `${(await json(`/api/tasks/${a}`)).archived}`)
  await patch(`/api/tasks/${b}`, { archived: 1 })
  check('it can be archived through PATCH', (await json(`/api/tasks/${b}`)).archived === 1)
  check('archiving keeps the prose',
    (await json(`/api/tasks/${b}`)).notes === 'ZZ Sec Beta body',
    (await json(`/api/tasks/${b}`)).notes)

  // --- the project page ----------------------------------------------------
  let errors = []
  let dom = await openPage(`${BASE}/projects/${proj.id}?tab=notes`, errors)
  doms.push(dom)
  let { window } = dom
  let { document } = window
  await wait(3200)
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const secTitles = () => [...document.querySelectorAll('.pj-note-sec')]
    .map((s) => s.querySelector('.pj-section-title')?.textContent.trim())
  check('an archived section is hidden by default',
    !secTitles().includes('ZZ Sec Beta'), secTitles().join(' | '))
  check('the others still show',
    secTitles().includes('ZZ Sec Alpha') && secTitles().includes('ZZ Sec Gamma'),
    secTitles().join(' | '))

  const notesTab = [...document.querySelectorAll('.tab')].find((t) => /^Notes/.test(t.textContent))
  check('the tab badge does not count what is archived',
    /Notes\s*2\s*$/.test(notesTab?.textContent.trim() || ''), notesTab?.textContent.trim())

  const toggle = () => [...document.querySelectorAll('button')]
    .find((x) => /Archived/.test(x.textContent) && x.hasAttribute('aria-pressed'))
  check('a show-archived switch appears when there is something in it', !!toggle())
  check('it says how many', /1/.test(toggle()?.textContent || ''), toggle()?.textContent.trim())
  check('it starts off', toggle()?.getAttribute('aria-pressed') === 'false')

  toggle()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(300)
  check('turning it on reveals the archived section',
    secTitles().includes('ZZ Sec Beta'), secTitles().join(' | '))
  const betaEl = [...document.querySelectorAll('.pj-note-sec')]
    .find((s) => /ZZ Sec Beta/.test(s.querySelector('.pj-section-title')?.textContent || ''))
  check('and it is marked as archived', betaEl?.className.includes('is-archived'), betaEl?.className)

  // --- archiving from the page --------------------------------------------
  const alphaEl = [...document.querySelectorAll('.pj-note-sec')]
    .find((s) => /ZZ Sec Alpha/.test(s.querySelector('.pj-section-title')?.textContent || ''))
  const archiveBtn = [...(alphaEl?.querySelectorAll('.panel-h button') || [])]
    .find((x) => x.hasAttribute('aria-pressed'))
  check('each section has an archive button', !!archiveBtn, alphaEl?.querySelector('.panel-h')?.textContent)
  check('it is distinct from delete',
    !archiveBtn?.className.includes('danger'), archiveBtn?.className)
  archiveBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(900)
  check('clicking it archives the section', (await json(`/api/tasks/${a}`)).archived === 1,
    `${(await json(`/api/tasks/${a}`)).archived}`)
  check('and does not delete it', (await json(`/api/tasks/${a}`)).title === 'ZZ Sec Alpha')

  // Un-archiving from the same control.
  const alphaAgain = [...document.querySelectorAll('.pj-note-sec')]
    .find((s) => /ZZ Sec Alpha/.test(s.querySelector('.pj-section-title')?.textContent || ''))
  const back = [...(alphaAgain?.querySelectorAll('.panel-h button') || [])]
    .find((x) => x.hasAttribute('aria-pressed'))
  check('the control is now pressed', back?.getAttribute('aria-pressed') === 'true')
  back?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(900)
  check('clicking again brings it back', (await json(`/api/tasks/${a}`)).archived === 0,
    `${(await json(`/api/tasks/${a}`)).archived}`)

  // --- reordering must not strand the hidden one ---------------------------
  await patch(`/api/tasks/${a}`, { archived: 0 })
  await post('/api/tasks/reorder', { ids: [a, b, c] })
  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/projects/${proj.id}?tab=notes`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3200)

  const titles2 = () => [...document.querySelectorAll('.pj-note-sec')]
    .map((s) => s.querySelector('.pj-section-title')?.textContent.trim())
  check('with Beta archived, only Alpha and Gamma are drawn',
    titles2().join(',') === 'ZZ Sec Alpha,ZZ Sec Gamma', titles2().join(','))

  // Drag Gamma above Alpha. Beta is hidden between them and must keep its place.
  const store = new Map(); const types = []
  const dtObj = {
    types,
    setData: (k, v) => { store.set(k, v); if (!types.includes(k)) types.push(k) },
    getData: (k) => store.get(k) || '', effectAllowed: '',
  }
  const fire = (el, type) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true })
    ev.dataTransfer = dtObj
    el.dispatchEvent(ev)
  }
  const secs = () => [...document.querySelectorAll('.pj-note-sec')]
  secs()[1]?.querySelector('.pj-note-grip')
    ?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
  await wait(150)
  fire(secs()[1], 'dragstart')
  fire(secs()[0], 'dragover')
  fire(secs()[0], 'drop')
  await wait(1100)

  const order = (await json(`/api/projects/${proj.id}`)).notes
    .filter((n) => !n.scheduled_date).map((n) => n.title)
  check('reordering the visible ones moves them',
    order.indexOf('ZZ Sec Gamma') < order.indexOf('ZZ Sec Alpha'), order.join(' | '))
  check('and the hidden one keeps a coherent position, not a stale one',
    new Set(order).size === 3 && order.includes('ZZ Sec Beta'), order.join(' | '))

  // --- an archived note does not leak into all-tasks -----------------------
  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/tasks`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3500)
  check('all-tasks: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const notesChip = [...document.querySelectorAll('button')].find((x) => /Filters/.test(x.textContent))
  notesChip?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(400)
  const notesToggle = [...document.querySelectorAll('.at-chip')].find((x) => /^Notes/.test(x.textContent))
  if (notesToggle) {
    notesToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await wait(1200)
    // A kind='note' row draws a RichEditor, not a .task-title, so the text has
    // to be read off the row itself. Checking the title alone found nothing and
    // made the "stays out" assertion below pass against an empty list.
    const rows = [...document.querySelectorAll('.at-row')].map((r) => r.textContent)
    const seen = (name) => rows.some((t) => t.includes(name))
    check('an unarchived section is in the all-tasks list', seen('ZZ Sec Gamma'),
      `${rows.length} rows, none matching`)
    check('an archived one stays out of it', !seen('ZZ Sec Beta'),
      rows.filter((t) => t.includes('ZZ Sec')).join(' | '))
  } else {
    check('a Notes include-toggle exists', false, 'not found')
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
  for (const d of doms) { try { d.window.close() } catch {} }
  if (projectId) {
    const pr = await json(`/api/projects/${projectId}`).catch(() => ({ notes: [] }))
    for (const n of pr.notes || []) await del(`/api/tasks/${n.id}`)
    await del(`/api/projects/${projectId}`)
  }
  console.log('cleanup: probe project removed')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
