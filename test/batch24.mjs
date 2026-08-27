/** The head of the rail: undo/redo sizing, and its separation from Calendar. */
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE = 'http://localhost:8787'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom

try {
  const vc = new VirtualConsole()
  const errors = []
  vc.on('jsdomError', (e) => errors.push(e.message))
  dom = await JSDOM.fromURL(`${BASE}/dashboard`, {
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
  const { document } = dom.window
  await new Promise((r) => setTimeout(r, 2500))
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const undo = document.querySelector('.sb-undo')
  const rail = document.querySelector('.sidebar')
  // Undo, then the search box, then the navigation. Search went in between
  // deliberately — it is how you reach anything that is not one of the dozen
  // places listed below it — so this checks the order rather than adjacency.
  const heading = document.querySelector('.sb-section')
  const order = [...(rail?.children || [])].map((el) => el.className.split(' ')[0])
  check('undo sits at the head of the rail', rail?.firstElementChild === undo)
  check('the search box follows it', order[1] === 'sb-search', order.slice(0, 3).join(' > '))
  check('and Calendar heads the navigation', heading?.textContent === 'Calendar', heading?.textContent)

  const raw = readdirSync('web/dist/assets')
    .filter((f) => /\.(css|js)$/.test(f))
    .map((f) => readFileSync(`web/dist/assets/${f}`, 'utf8')).join('\n')
  // Spacing is written as scale tokens now. Resolving them back to pixels keeps
  // these checks about the value the user sees — six pixels of padding — rather
  // than about which token happens to carry it, so renaming a token does not
  // fail a test that is really about the look of the rail.
  const scale = new Map(
    [...raw.matchAll(/(--space-\d+):\s*(\d+px)/g)].map((m) => [m[1], m[2]])
  )
  const css = raw
    .replace(/var\((--space-\d+)\)/g, (whole, name) => scale.get(name) ?? whole)
    .replace(/\s+/g, '')

  check('a line separates them', /\.sb-undo\{[^}]*border-bottom:1pxsolid/.test(css))
  check('the gap below undo is small', /\.sb-undo\{[^}]*padding-bottom:5px/.test(css))
  // The rail was tightened so it fits a laptop screen without scrolling, which
  // is what was hiding the mark at its foot. The exact numbers moved; what
  // matters is still that the top is barely padded.
  check('and the heading no longer takes a run-up',
    /\.sb-undo\+\.sb-section\{padding-top:6px\}/.test(css))
  check('the rail barely pads its top', /\.sidebar\{[^}]*padding:4px10px8px/.test(css))

  // 60/40 as growth factors, so the split survives the rail being resized and
  // the gap comes out of the row first. Matched against the RAW css: the
  // whitespace-stripped copy above turns `flex:6 6 0` into `flex:660`.
  check('undo takes six parts', /\.sb-undo \.btn\{[^}]*flex:6 6 0/.test(raw),
    (raw.match(/\.sb-undo \.btn\{[^}]*\}/) || ['not found'])[0])
  check('redo takes four', /\.sb-undo \.btn:last-child\{flex:4 4 0\}/.test(raw),
    (raw.match(/\.sb-undo \.btn:last-child\{[^}]*\}/) || ['not found'])[0])
  check('redo is no longer a fixed 34px', !/\.sb-undo\.btn:last-child\{flex:0034px\}/.test(css))

  // Height is pinned, so dragging the rail changes width only.
  check('their height is fixed', /\.sb-undo\.btn\{[^}]*height:26px/.test(css))
  check('and nothing sets a taller minimum', /\.sb-undo\.btn\{[^}]*min-height:0/.test(css))

  const btns = [...document.querySelectorAll('.sb-undo button')]
  check('there are exactly two', btns.length === 2, `${btns.length}`)
  check('the first is the undo', /undo/i.test(btns[0]?.textContent || btns[0]?.getAttribute('title') || ''),
    btns[0]?.getAttribute('title'))
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  dom?.window?.close()
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
