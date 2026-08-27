/** Scheme-less links, no delete dialog, the band's bar, and the rail's length. */
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE = 'http://localhost:8787'
const D = '2030-05-06'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function openPage(url, errors, onWindow) {
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
      onWindow?.(w)
    },
  })
}

try {
  // ---------------------------------------------------- links with no scheme
  const linky = await post('/api/tasks', {
    title: 'ZZ links',
    scheduled_date: D,
    notes: [
      '[bare host](google.com)',
      '[with www](www.google.com)',
      '[with scheme](https://google.com)',
      '[deep path](example.invalid/a/b?c=1)',
      '[app page](/notes/2030-05-06)',
      '[fragment](#part)',
    ].join('\n\n'),
  })

  const errors = []
  const dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3200)
  check('day: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const row = [...document.querySelectorAll('.task')]
    .find((r) => /ZZ links/.test(r.querySelector('.task-title')?.textContent || ''))
  const hrefOf = (label) => [...(row?.querySelectorAll('a') || [])]
    .find((a) => a.textContent.trim() === label)?.getAttribute('href')
  // What the browser would actually open, resolved against the page you are on.
  const opens = (label) => {
    const h = hrefOf(label)
    return h ? new URL(h, `http://localhost/day/${D}`).href : null
  }

  check('a host with no scheme is not treated as a path on this site',
    opens('bare host') === 'https://google.com/', `${hrefOf('bare host')} -> ${opens('bare host')}`)
  check('nor is a www host', opens('with www') === 'https://www.google.com/',
    `${opens('with www')}`)
  check('a host with a path either',
    opens('deep path') === 'https://example.invalid/a/b?c=1', `${opens('deep path')}`)
  check('a url that already has a scheme is untouched',
    hrefOf('with scheme') === 'https://google.com', hrefOf('with scheme'))
  check('an app page stays inside the app',
    hrefOf('app page') === '/notes/2030-05-06', hrefOf('app page'))
  check('and a fragment stays a fragment', hrefOf('fragment') === '#part', hrefOf('fragment'))
  check('outbound links open in their own tab',
    [...(row?.querySelectorAll('a') || [])]
      .filter((a) => (a.getAttribute('href') || '').startsWith('http'))
      .every((a) => a.getAttribute('target') === '_blank'),
    'an outbound link would hijack the tab')
  await del(`/api/tasks/${linky.id}`)

  // ------------------------------------------- deleting a section, no dialog
  const sec = await post('/api/sections', { date: D, name: 'ZZ Quiet', layout: 'columns' })
  const inside = await post('/api/tasks', { title: 'ZZ inside', scheduled_date: D, section_id: sec.id })

  dom.window.close()
  const errs2 = []
  let asked = false
  const dom2 = await openPage(`${BASE}/day/${D}`, errs2, (w) => {
    // If anything calls confirm, the test fails rather than silently passing
    // because jsdom returns false and the delete never happened.
    w.confirm = () => { asked = true; return true }
  })
  doms.push(dom2)
  await wait(3200)
  const doc2 = dom2.window.document
  const panel = [...doc2.querySelectorAll('.panel.section')]
    .find((p) => /ZZ Quiet/.test(p.querySelector('.section-h')?.textContent || ''))
  const trash = [...(panel?.querySelectorAll('button') || [])]
    .find((b) => /Delete this section/.test(b.getAttribute('title') || ''))
  check('the section has a delete control', !!trash)
  trash?.dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }))
  await wait(1200)

  check('deleting a section asks no dialog', !asked, 'a confirm() was raised')
  check('it deletes all the same',
    (await json(`/api/days/${D}`)).sections.length === 0,
    `${(await json(`/api/days/${D}`)).sections.length} sections left`)
  check('and takes its work with it',
    !(await json(`/api/tasks/${inside.id}`)).id, 'the task survived')
  const toast = doc2.querySelector('.toast')
  check('offering Undo instead', !!toast && /Undo/.test(toast.textContent), toast?.textContent)

  // --------------------------------------------------- the band's own bar
  const sec2 = await post('/api/sections', {
    date: D, name: 'ZZ Band Sec', layout: 'columns', color: 'plum',
  })
  const head = await post('/api/tasks', {
    title: 'ZZ head', scheduled_date: D, section_id: sec2.id, subsection: 1,
  })
  const k1 = await post('/api/tasks', { title: 'ZZ k1', scheduled_date: D, section_id: sec2.id })
  const k2 = await post('/api/tasks', { title: 'ZZ k2', scheduled_date: D, section_id: sec2.id })
  for (const k of [k1, k2]) await post(`/api/tasks/${k.id}/nest`, { parent_id: head.id })

  dom2.window.close()
  const errs3 = []
  const dom3 = await openPage(`${BASE}/day/${D}`, errs3)
  doms.push(dom3)
  await wait(3200)
  const doc3 = dom3.window.document
  check('day with a band: no runtime errors', errs3.length === 0, errs3.slice(0, 2).join(' | '))

  const band = doc3.querySelector('.subsec')
  const bar = band?.querySelector('.subsec-prog')
  check('the band has a progress bar', !!bar)
  check('it is no longer inside the heading row',
    !band?.querySelector('.subsec-head .subsec-prog'), 'the bar is still in the head row')
  check('it sits under the heading',
    [...(band?.children || [])].indexOf(bar) > [...(band?.children || [])]
      .indexOf(band.querySelector('.subsec-head')),
    'the bar is above the heading')
  // Progress paints the colour as an inline background on the fill, not as a
  // class on the wrapper, so that is where it has to be read from.
  const fill = bar?.querySelector('.prog-bar i')
  check('and carries the section’s colour',
    (fill?.getAttribute('style') || '').includes('var(--plum)'),
    fill?.getAttribute('style') || '(no fill)')

  // -------------------------------------------------------- the rail's length
  const rail = doc3.querySelector('.sidebar')
  const railHrefs = [...(rail?.querySelectorAll('a') || [])].map((a) => a.getAttribute('href'))
  check('the notebook is off the rail', !railHrefs.includes('/notebook'), railHrefs.join(' '))
  check('so are people and uploads',
    !railHrefs.includes('/people') && !railHrefs.includes('/uploads'), railHrefs.join(' '))

  const dash = await openPage(`${BASE}/dashboard`, [])
  doms.push(dash)
  await wait(2600)
  const elsewhere = [...dash.window.document.querySelectorAll('.db-else-row')]
    .map((a) => a.getAttribute('href'))
  check('and all three are on the dashboard instead',
    ['/notebook', '/people', '/uploads'].every((h) => elsewhere.includes(h)),
    elsewhere.join(' '))

  // ----------------------------------------------------------------- styles
  const css = readdirSync('web/dist/assets')
    .filter((f) => /\.(css|js)$/.test(f))
    .map((f) => readFileSync(`web/dist/assets/${f}`, 'utf8')).join('\n')
  check('the toast reads light on its dark ground in both themes',
    /\.toast\{[^}]*color:\s*#f4f6fb/i.test(css), 'the toast still takes --panel')
  check('the day header can wrap instead of overflowing',
    /\.topbar\{[^}]*flex-wrap:\s*wrap/.test(css), 'no flex-wrap on .topbar')
  check('the middle column never scrolls sideways',
    /\.main\{[^}]*overflow-x:\s*hidden/.test(css), 'no overflow-x guard on .main')
  check('the search panel is placed against the viewport, not the rail',
    /\.sb-results\{[^}]*position:\s*fixed/.test(css), '.sb-results is not fixed')
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
  console.log('cleanup: probe day cleared')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
