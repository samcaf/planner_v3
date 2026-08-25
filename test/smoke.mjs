/**
 * Loads the real built app in a DOM against the live API and asserts each route
 * renders actual data. Catches runtime errors the build cannot.
 */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
// Pick a day that actually has tasks rather than hardcoding one. The previous
// fixed date went empty when the user cleaned out old routine items, and the
// suite reported that as a failure of the app instead of a change in the data.
const days = await (await fetch(`${BASE}/api/tasks?limit=2000`)).json()
const byDay = {}
for (const t of days) if (t.scheduled_date) byDay[t.scheduled_date] = (byDay[t.scheduled_date] || 0) + 1
const DAY = Object.entries(byDay).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0]?.[0]
if (!DAY) throw new Error('no day in the database has tasks — cannot smoke-test the day view')
console.log(`using ${DAY} (${byDay[DAY]} tasks) as the populated day\n`)

const ROUTES = [
  ['/projects', ['Teleonomy', 'Personal', 'open']],
  ['/people', ['People']],
  ['/tasks', ['Teleonomy']],
  ['/routines', ['Morning', 'Evening']],
  ['/uploads', ['Uploads']],
  ['/dashboard', ['If you only do one thing']],
  ['/settings', ['Deep work', 'Appearance']],
  [`/notes/${DAY}`, ['Notes', 'Day', 'Week', 'Month']],
  [`/day/${DAY}`, ['Backlog']],
  [`/go/day/${DAY}`, ['Backlog']],               // wiki-link resolver
  ['/go/project/Teleonomy', ['Teleonomy']],       // resolves a project by name
  ['/day/2026-08-06', ['done', 'Morning']],   // a day that has completed tasks
  [`/week/${DAY}`, ['Mon', 'Sun']],
  [`/month/${DAY}`, ['Mon', 'Sun']],
]

const errors = []
let failures = 0

function injectFetch(window) {
  window.fetch = (url, opts) => fetch(new URL(url, BASE), opts)
  // jsdom implements neither of these; the app uses both.
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
}

async function load(route, theme) {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(`${route}: ${e.message}`))
  const dom = await JSDOM.fromURL(BASE + route, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      injectFetch(window)
      if (theme) window.localStorage.setItem('theme', theme)
    },
  })
  await new Promise((r) => setTimeout(r, 2500))
  return dom
}

for (const [route, expected] of ROUTES) {
  const dom = await load(route)
  const text = dom.window.document.body.textContent || ''
  const missing = expected.filter((s) => !text.includes(s))
  const katex = dom.window.document.querySelectorAll('.katex').length

  if (missing.length) {
    failures++
    console.log(`FAIL ${route}\n     missing: ${missing.join(' | ')}\n     got: ${text.slice(0, 190).replace(/\s+/g, ' ')}`)
  } else {
    console.log(`ok   ${route}  (${text.length} chars${katex ? `, ${katex} katex` : ''})`)
  }
  dom.window.close()
}

// Night mode must actually flip the theme attribute the CSS keys off.
{
  const dom = await load(`/day/${DAY}`, 'dark')
  const theme = dom.window.document.documentElement.dataset.theme
  if (theme === 'dark') console.log('ok   night mode  (data-theme="dark" applied)')
  else { failures++; console.log(`FAIL night mode — data-theme is "${theme}"`) }
  dom.window.close()
}

// Three-column box layout is a stored preference, so drive it the same way.
{
  const dom = await load(`/day/${DAY}`, null)
  dom.window.localStorage.setItem('day_layout', 'columns')
  dom.window.close()
  const dom2 = await JSDOM.fromURL(`${BASE}/day/${DAY}`, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(window) { injectFetch(window); window.localStorage.setItem('day_layout', 'columns') },
  })
  await new Promise((r) => setTimeout(r, 2500))
  const boxes = dom2.window.document.querySelectorAll('.box-cols').length
  const cols = dom2.window.document.querySelectorAll('.box-col').length
  if (boxes > 0 && cols === boxes * 3) console.log(`ok   column boxes  (${boxes} boxes x 3 columns)`)
  else { failures++; console.log(`FAIL column boxes — ${boxes} boxes, ${cols} columns`) }
  dom2.window.close()
}

console.log(errors.length ? `\nruntime errors:\n  ${errors.slice(0, 10).join('\n  ')}` : '\nno runtime errors')
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures || errors.length ? 1 : 0)
