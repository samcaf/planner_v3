/** One search box over everything, with filters, and results you can click. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2030-02-10'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
const made = { tasks: [], notes: [], projects: [], people: [] }

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
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
  const proj = await post('/api/projects', { name: 'ZZ Quokka', color: 'teal' })
  made.projects.push(proj.id)
  const person = await post('/api/people', { name: 'ZZ Quokka Person', role: 'Quokka wrangler' })
  made.people.push(person.id)
  const nb = await post('/api/notebook', { title: 'ZZ Quokka notes', body: 'about quokka things' })
  made.notes.push(nb.id)
  const hi = await post('/api/tasks', {
    title: 'ZZ Quokka urgent', scheduled_date: D, priority: 'highest', project_id: proj.id,
  })
  const lo = await post('/api/tasks', {
    title: 'ZZ Quokka later', scheduled_date: D, priority: 'low', project_id: proj.id,
  })
  const other = await post('/api/tasks', { title: 'ZZ Quokka unfiled', scheduled_date: D })
  made.tasks.push(hi.id, lo.id, other.id)

  // ---------------------------------------------------------- the endpoint
  const search = (qs) => json(`/api/search?${qs}`)
  const titles = (r) => r.results.map((x) => x.title)

  const all = await search('q=Quokka&limit=50')
  const kinds = new Set(all.results.map((r) => r.kind))
  check('one query reaches tasks, notebook, projects and people',
    ['task', 'notebook', 'project', 'person'].every((k) => kinds.has(k)),
    [...kinds].join(','))

  const byKind = await search('q=Quokka&kind=task')
  check('kind narrows to one sort of thing',
    byKind.results.every((r) => r.kind === 'task') && byKind.count === 3,
    `${byKind.count}: ${[...new Set(byKind.results.map((r) => r.kind))].join(',')}`)

  const byPriority = await search('q=Quokka&kind=task&priority=highest')
  check('priority filters tasks',
    titles(byPriority).join(',') === 'ZZ Quokka urgent', titles(byPriority).join(','))

  const byProject = await search(`q=Quokka&kind=task&project_id=${proj.id}`)
  check('project filters tasks', byProject.count === 2, `${byProject.count}`)
  check('and leaves the unfiled one out',
    !titles(byProject).includes('ZZ Quokka unfiled'), titles(byProject).join(','))

  const byDate = await search(`kind=task&from=${D}&to=${D}`)
  check('a date range works with no query at all',
    byDate.count >= 3 && titles(byDate).some((t) => t.startsWith('ZZ Quokka')),
    `${byDate.count}`)

  const noQuery = await search('q=')
  check('an empty query with no filter returns nothing', noQuery.count === 0, `${noQuery.count}`)

  const oneLetter = await search('q=Z')
  check('a one-letter query is refused', oneLetter.count === 0, `${oneLetter.count}`)

  const uploadsOnly = await search('q=Quokka&kind=upload')
  check('asking only for uploads returns no tasks',
    uploadsOnly.results.every((r) => r.kind === 'upload'), `${uploadsOnly.count}`)

  const wildcards = await search('q=' + encodeURIComponent('Quokka_'))
  check('an underscore is escaped, not treated as a wildcard',
    wildcards.count === 0, `${wildcards.count} — "_" matched any character`)

  // ------------------------------------------------------------- the box
  let errors = []
  const dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3200)
  check('day: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const input = document.querySelector('.sb-search-input')
  check('the rail has a search box', !!input)
  check('it says what it searches',
    /everything/i.test(input?.getAttribute('placeholder') || ''), input?.getAttribute('placeholder'))
  check('the results panel is shut to begin with', !document.querySelector('.sb-results'))

  // React tracks the value, so setting .value alone is not seen.
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  input.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }))
  setValue(input, 'Quokka')
  await wait(1400)

  check('typing opens the results', !!document.querySelector('.sb-results'))
  const rows = [...document.querySelectorAll('.sb-res-row')]
  check('and finds things', rows.length > 0, `${rows.length} rows`)
  check('results are grouped by what they are',
    document.querySelectorAll('.sb-res-group').length > 1,
    `${document.querySelectorAll('.sb-res-group').length} groups`)
  check('every result is a link you can follow',
    rows.every((r) => r.tagName === 'A' && (r.getAttribute('href') || '').length > 0),
    rows.map((r) => `${r.tagName}:${r.getAttribute('href')}`).slice(0, 3).join(' | '))
  check('a task result points at the day it is on',
    rows.some((r) => r.getAttribute('href') === `/day/${D}`),
    rows.map((r) => r.getAttribute('href')).slice(0, 5).join(' | '))
  check('a project result points at the project',
    rows.some((r) => r.getAttribute('href') === `/projects/${proj.id}`),
    rows.map((r) => r.getAttribute('href')).slice(0, 6).join(' | '))

  // --- filters in the panel ------------------------------------------------
  const filterBtn = [...document.querySelectorAll('.sb-res-head button')]
    .find((b) => /Filters/.test(b.textContent))
  check('the panel offers filters', !!filterBtn)
  filterBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(300)
  check('opening them shows the rows', !!document.querySelector('.sb-filters'))
  const labels = [...document.querySelectorAll('.sb-f-label')].map((l) => l.textContent)
  check('you can narrow by kind, priority, status, project, date and file type',
    ['Kind', 'Priority', 'Status', 'Project', 'Scheduled', 'File type']
      .every((l) => labels.includes(l)), labels.join(','))

  const taskChip = [...document.querySelectorAll('.sb-filters .at-chip')]
    .find((c) => c.textContent.trim() === 'Tasks')
  taskChip?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(1200)
  const kindsShown = [...document.querySelectorAll('.sb-res-kind')].map((h) => h.textContent)
  check('picking a kind narrows the list to it',
    kindsShown.length === 1 && /Tasks/.test(kindsShown[0]), kindsShown.join(' | '))

  // Escape puts it away.
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await wait(300)
  check('Escape closes the panel', !document.querySelector('.sb-results'))
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
  for (const id of made.tasks) await del(`/api/tasks/${id}`)
  for (const id of made.notes) await del(`/api/notebook/${id}`)
  for (const id of made.people) await del(`/api/people/${id}`)
  for (const id of made.projects) await del(`/api/projects/${id}`)
  console.log('cleanup: probe rows removed')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
