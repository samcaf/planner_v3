/** Rail slimmed, toasts contained, sections coloured, bands measured. */
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE = 'http://localhost:8787'
const D = '2030-01-15'
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
  const proj = await post('/api/projects', { name: 'ZZ ColourProj', color: 'plum' })
  projectId = proj.id

  // --------------------------------------------------------------- the rail
  let errors = []
  let dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  let { window } = dom
  let { document } = window
  await wait(3200)
  check('day: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const railLinks = () => [...document.querySelectorAll('.sidebar a')]
    .map((a) => a.getAttribute('href'))
  check('People is off the rail', !railLinks().includes('/people'), railLinks().join(' '))
  check('Uploads is off the rail', !railLinks().includes('/uploads'), railLinks().join(' '))
  check('the views you plan in are still there',
    ['/tasks', '/projects', '/notebook', '/routines', '/settings']
      .every((h) => railLinks().includes(h)),
    railLinks().join(' '))

  // ------------------------------------------------- a section takes a colour
  const sec = await post('/api/sections', {
    date: D, name: 'ZZ Filed', project_id: proj.id, layout: 'columns',
  })
  const head = await post('/api/tasks', {
    title: 'ZZ band', scheduled_date: D, section_id: sec.id, subsection: 1, estimate_min: 10,
  })
  const k1 = await post('/api/tasks', { title: 'ZZ k1', scheduled_date: D, section_id: sec.id })
  const k2 = await post('/api/tasks', { title: 'ZZ k2', scheduled_date: D, section_id: sec.id })
  await post(`/api/tasks/${k1.id}/nest`, { parent_id: head.id })
  await post(`/api/tasks/${k2.id}/nest`, { parent_id: k1.id })
  await patch(`/api/tasks/${k1.id}`, { status: 'done' })

  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3200)
  check('day with a section: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const panel = [...document.querySelectorAll('.panel.section')]
    .find((p) => /ZZ Filed/.test(p.querySelector('.section-h')?.textContent || ''))
  check('the section renders', !!panel)
  check('it wears its project’s colour', panel?.className.includes('c-plum'), panel?.className)

  // A colour set on the section itself must still win.
  await patch(`/api/sections/${sec.id}`, { color: 'green' })
  dom.window.close()
  errors = []
  dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  window = dom.window
  document = window.document
  await wait(3200)
  const panel2 = [...document.querySelectorAll('.panel.section')]
    .find((p) => /ZZ Filed/.test(p.querySelector('.section-h')?.textContent || ''))
  check('a colour chosen for the section beats the project’s',
    panel2?.className.includes('c-green') && !panel2?.className.includes('c-plum'),
    panel2?.className)

  // --------------------------------------------------- band progress bar
  const band = document.querySelector('.subsec')
  check('the band renders', !!band)
  const prog = band?.querySelector('.subsec-prog')
  check('a sub-section has a progress bar', !!prog)
  check('it sits with the heading, inside the head row',
    !!band?.querySelector('.subsec-head .subsec-prog'),
    'the bar is not in the head row')
  // One of the two children is done, so it must not read as empty or as full.
  const pct = prog?.querySelector('[style*="width"]')?.getAttribute('style') || ''
  check('and it reflects the work under it, not the heading',
    /width:\s*(?!0%)(?!100%)\d/.test(pct) || /width:\s*50/.test(pct), pct || '(no width)')

  // ------------------------------------------------------------- the toast
  // Read off disk rather than out of the page: the bundle may inline its CSS
  // in a <style> tag, and fetching only <link> elements then yields nothing —
  // which makes every rule below "missing" whatever the stylesheet says.
  //
  // Whitespace is NOT stripped. `.toast .toast-action` and `.toast.toast-action`
  // are different selectors, and collapsing spaces makes them identical, so a
  // descendant rule would match a test written for a compound one.
  // .js as well as .css: the test build is an IIFE with its stylesheet inlined
  // into the bundle, so looking only for a .css file finds nothing and every
  // rule below reads as missing whatever the stylesheet actually says.
  const cssFiles = readdirSync('web/dist/assets').filter((f) => /\.(css|js)$/.test(f))
  const css = cssFiles.map((f) => readFileSync(`web/dist/assets/${f}`, 'utf8')).join('\n')
  check('the built styles are on disk', /\.toast-host\{/.test(css),
    `${cssFiles.length} files, no .toast-host rule in them`)
  check('the toast is bounded by the viewport',
    /\.toast-host\{[^}]*max-width:\s*min\(560px,\s*calc\(100vw\s*-\s*32px\)\)/.test(css),
    'no max-width on .toast-host')
  check('and is not a pill that a second line would break',
    /\.toast\{[^}]*border-radius:\s*14px/.test(css), 'still a 99px pill')
  check('its message is allowed to wrap',
    /\.toast-msg\{[^}]*overflow-wrap:\s*anywhere/.test(css), 'no wrapping rule')
  check('while the action keeps its width',
    /\.toast \.toast-action\s*\{\s*flex:\s*none/.test(css), 'the action can be squeezed')
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
  const day = await json(`/api/days/${D}`).catch(() => ({ tasks: [], sections: [] }))
  for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
  for (const s of day.sections) await del(`/api/sections/${s.id}`)
  if (projectId) await del(`/api/projects/${projectId}`)
  console.log('cleanup: probe rows removed')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
