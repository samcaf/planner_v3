/** The backlog as a day-style board: project page, all-tasks page, day aside. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
const madeTasks = []
const madeProjects = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function open(url, errors) {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(e.message))
  return JSDOM.fromURL(url, {
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
}

try {
  const pa = await post('/api/projects', { name: 'ZZ Alpha', color: 'teal' })
  const pb = await post('/api/projects', { name: 'ZZ Beta', color: 'plum' })
  madeProjects.push(pa.id, pb.id)

  // Dateless on purpose: this is what "backlog" means.
  const mk = async (title, project_id, estimate_min) => {
    const t = await post('/api/tasks', { title, project_id, estimate_min })
    madeTasks.push(t.id)
    return t.id
  }
  const quick = await mk('ZZ quick one', pa.id, 5)
  const deep = await mk('ZZ deep one', pa.id, 120)
  const beta = await mk('ZZ beta one', pb.id, 20)

  // ---------------------------------------------------------------- project
  let errors = []
  let dom = await open(`${BASE}/projects/${pa.id}?tab=backlog`, errors)
  doms.push(dom)
  let { window } = dom
  let { document } = window
  await wait(3200)
  check('project page: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const tabNames = [...document.querySelectorAll('.tab')].map((b) => b.textContent.trim())
  check('a Backlog tab exists', tabNames.some((t) => /^Backlog/.test(t)), tabNames.join(' | '))
  const activeTab = document.querySelector('.tab.active')?.textContent.trim() || ''
  check('?tab=backlog opens it directly', /^Backlog/.test(activeTab), activeTab)

  const board = document.querySelector('.box-cols')
  check('the backlog shows as a three-column board', !!board)
  const colHeads = [...document.querySelectorAll('.box-col-h')].map((e) => e.textContent.trim())
  check('with the day view’s own column names', colHeads.length === 3, colHeads.join(' | '))

  const colOf = (name) => {
    const cols = [...document.querySelectorAll('.box-col')]
    return cols.findIndex((c) => [...c.querySelectorAll('.task-title')]
      .some((t) => t.textContent.trim() === name))
  }
  check('a 5-minute task grades into the first column', colOf('ZZ quick one') === 0, `${colOf('ZZ quick one')}`)
  check('a 2-hour task grades into the third', colOf('ZZ deep one') === 2, `${colOf('ZZ deep one')}`)
  check('another project’s task is not here', colOf('ZZ beta one') === -1, `${colOf('ZZ beta one')}`)

  // The list/board switch.
  const asList = [...document.querySelectorAll('button')].find((b) => /As a list/.test(b.textContent))
  check('there is a switch back to a plain list', !!asList)
  asList?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(250)
  check('switching hides the columns', !document.querySelector('.box-cols'))
  check('but keeps the tasks',
    [...document.querySelectorAll('.task-title')].some((t) => t.textContent.trim() === 'ZZ deep one'))

  // The tab survives a refresh — the bug this replaced.
  dom.window.close()
  errors = []
  dom = await open(`${BASE}/projects/${pa.id}?tab=notes`, errors)
  doms.push(dom)
  await wait(3000)
  const notesTab = dom.window.document.querySelector('.tab.active')?.textContent.trim() || ''
  check('reloading on Notes comes back on Notes', /^Notes/.test(notesTab), notesTab)

  // -------------------------------------------------------------- all tasks
  dom.window.close()
  errors = []
  dom = await open(`${BASE}/tasks?view=backlog`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3500)
  check('all-tasks: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const panelTitles = () => [...document.querySelectorAll('.panel-h')].map((h) => h.textContent.trim())
  check('the backlog is grouped into a panel per project',
    panelTitles().some((t) => t.includes('ZZ Alpha')) && panelTitles().some((t) => t.includes('ZZ Beta')),
    panelTitles().slice(0, 6).join(' | '))

  const alphaPanel = [...document.querySelectorAll('.panel')]
    .find((p) => p.querySelector('.panel-h')?.textContent.includes('ZZ Alpha'))
  check('each project panel is a board', !!alphaPanel?.querySelector('.box-cols'))
  check('and holds only its own project’s work',
    [...alphaPanel.querySelectorAll('.task-title')].map((t) => t.textContent.trim()).sort().join(',')
      === 'ZZ deep one,ZZ quick one',
    [...alphaPanel.querySelectorAll('.task-title')].map((t) => t.textContent.trim()).join(','))

  const jump = alphaPanel?.querySelector('a[href*="tab=backlog"]')
  check('a link goes to that project’s own backlog tab', !!jump, jump?.getAttribute('href'))
  check('pointing at the right project',
    jump?.getAttribute('href') === `/projects/${pa.id}?tab=backlog`, jump?.getAttribute('href'))

  const fold = alphaPanel?.querySelector('.bl-fold')
  check('each project folds away on its own', !!fold)
  check('it starts open', fold?.getAttribute('aria-expanded') === 'true')
  fold?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(250)
  const alphaAfter = [...document.querySelectorAll('.panel')]
    .find((p) => p.querySelector('.panel-h')?.textContent.includes('ZZ Alpha'))
  check('folding hides that project’s tasks',
    alphaAfter.querySelectorAll('.task-title').length === 0,
    `${alphaAfter.querySelectorAll('.task-title').length} still shown`)
  const betaPanel = [...document.querySelectorAll('.panel')]
    .find((p) => p.querySelector('.panel-h')?.textContent.includes('ZZ Beta'))
  check('and leaves the other projects alone',
    betaPanel.querySelectorAll('.task-title').length > 0)

  // Scheduled work must NOT appear in the backlog view.
  const dated = await post('/api/tasks', {
    title: 'ZZ dated one', project_id: pa.id, scheduled_date: '2029-04-02', estimate_min: 30,
  })
  madeTasks.push(dated.id)
  dom.window.close()
  errors = []
  dom = await open(`${BASE}/tasks?view=backlog`, errors)
  doms.push(dom)
  await wait(3500)
  const shown = [...dom.window.document.querySelectorAll('.task-title')].map((t) => t.textContent.trim())
  check('a task with a day is not in the backlog', !shown.includes('ZZ dated one'), shown.join(' | '))
  check('dateless ones still are', shown.includes('ZZ quick one'), shown.join(' | '))

  // ------------------------------------------------------------- day aside
  dom.window.close()
  errors = []
  dom = await open(`${BASE}/day/2029-04-02`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3200)
  check('day: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const all = document.querySelector('.day-aside a[href*="view=backlog"]')
  check('the aside links to the whole backlog by project', !!all, all?.getAttribute('href'))

  const asideFolds = [...document.querySelectorAll('.day-aside .bl-fold')]
  check('the aside panels can be minimised', asideFolds.length >= 1, `${asideFolds.length} found`)

  const blPanel = [...document.querySelectorAll('.day-aside .panel')]
    .find((p) => /Backlog/.test(p.querySelector('.panel-h')?.textContent || ''))
  const blFold = blPanel?.querySelector('.bl-fold')
  check('the backlog panel has one', !!blFold)
  const rowsBefore = blPanel?.querySelectorAll('.bl-row').length || 0
  check('it lists backlog rows to begin with', rowsBefore > 0, `${rowsBefore}`)
  blFold?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(250)
  check('minimising empties it', (blPanel?.querySelectorAll('.bl-row').length || 0) === 0,
    `${blPanel?.querySelectorAll('.bl-row').length}`)
  check('and the choice is remembered', window.localStorage.getItem('fold_backlog') === '1',
    window.localStorage.getItem('fold_backlog'))
} catch (e) {
  check('the suite ran to the end', false, `${e.message}\n${e.stack?.split('\n')[1] || ''}`)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  for (const d of doms) { try { d.window.close() } catch {} }
  for (const id of madeTasks) await del(`/api/tasks/${id}`)
  for (const id of madeProjects) await del(`/api/projects/${id}`)
  console.log('cleanup: probe tasks and projects removed')
}
