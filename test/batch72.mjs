/**
 * The phone, second pass — and the dismissal bug underneath it.
 *
 * The bug first, because it is the only one here that was not cosmetic: every
 * "click away and this closes" in the app listened for `mousedown`, which a tap
 * produces only where the browser judges the target was meant to be clicked. On
 * a phone that made dismissal depend on what happened to be under your finger.
 * `pointerdown` is dispatched for the contact itself, so both are driven here —
 * a touch-only press must close a menu, and a mouse-only press must still close
 * it, because the desktop path has to survive the fix.
 *
 * The rest is the same split batch71 uses: layout asserted against the BUILT
 * stylesheet, since jsdom does no layout, and behaviour driven for real. The
 * phone components are reachable because `useMobile` asks `matchMedia`, which a
 * test can answer — so the vim gate, the settings tabs and the month grid are
 * exercised rather than assumed.
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

const BASE = 'http://localhost:8787'
const D = '2034-05-09'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
const made = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const built = readdirSync('web/dist/assets')
  .filter((f) => /\.(css|js)$/.test(f))
  .map((f) => readFileSync(`web/dist/assets/${f}`, 'utf8')).join('\n')

/**
 * A page that believes it is a phone. `matchMedia` is the only thing
 * `useMobile` asks, so answering it is the whole of the disguise — and the
 * suites that came before stub the same call with a flat `false`, which is what
 * makes the desktop the default everywhere else.
 */
const open = async (path, { phone = false, before } = {}) => {
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e.message || e).slice(0, 140)))
  const dom = await JSDOM.fromURL(BASE + path, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = (q) => ({
        matches: phone && /max-width: *700px/.test(q),
        addEventListener() {}, removeEventListener() {},
      })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
      before?.(w)
    },
  })
  doms.push(dom)
  await wait(3400)
  return { window: dom.window, document: dom.window.document, errors }
}

try {
  // ── the dismissal bug ────────────────────────────────────────────────────
  check('every dismissal hears the press a tap actually makes',
    /"pointerdown","mousedown"|'pointerdown','mousedown'/.test(built),
    'mousedown alone is not dispatched for a tap on a plain element')

  const t1 = await post('/api/tasks', { title: 'ZZ72 menus', scheduled_date: D })
  made.push(t1.id)

  const day = await open(`/day/${D}`)
  const { window, document } = day
  const click = (el) => el?.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  const row = () => document.querySelector(`.task[data-task-id="${t1.id}"]`)
  const popTrigger = () => [...(row()?.querySelectorAll('button') || [])]
    .find((b) => b.getAttribute('aria-haspopup') === 'true')

  const press = (type, el) => el.dispatchEvent(
    type === 'pointerdown'
      ? new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' })
      : new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))

  const openPop = async () => { click(popTrigger()); await wait(320) }
  const away = async (type) => {
    press(type, document.querySelector('.page') || document.body)
    await wait(260)
    return !document.querySelector('.pop')
  }

  check('the row has a menu to open', !!popTrigger())
  await openPop()
  check('it opens', !!document.querySelector('.pop'))
  check('a TOUCH press outside closes it — the bug', await away('pointerdown'),
    'this is what did not work on a phone')

  await openPop()
  check('and a mouse press outside still does', await away('mousedown'),
    'the desktop path must survive the fix')

  // The time panel is a second, separate dismissal with the same defect.
  const clock = [...(row()?.querySelectorAll('button') || [])]
    .find((b) => b.getAttribute('title') === 'Time and duration')
  if (clock) {
    click(clock)
    await wait(320)
    check('the time panel opens too', !!row()?.querySelector('.task-details'))
    press('pointerdown', document.querySelector('.page') || document.body)
    await wait(260)
    check('and a touch press puts it away', !row()?.querySelector('.task-details'))
  } else {
    check('the row has a time panel', false, 'no clock button found')
  }

  check('no key threw on the day', day.errors.length === 0, day.errors.join(' | '))

  // ── the top bar fits ─────────────────────────────────────────────────────
  check('the bar is one scrolling row on a phone',
    /\.topbar\{[^}]*flex-wrap:nowrap/.test(built) && /\.topbar\{[^}]*overflow-x:auto/.test(built))
  check('with the padding the notch needs and no more',
    /\.topbar\{[^}]*padding:calc\(var\(--space-1\) \+ env\(safe-area-inset-top/.test(built),
    'a second rule used to add --space-6 on top of the inset and win')
  check('and the label that was setting its height is gone',
    /\.topbar \.pri-filter-label\{display:none\}/.test(built))

  // ── the rows that ran off the side ───────────────────────────────────────
  check('label sits above value rather than beside it',
    /\.kv,\.st-raw-row\{grid-template-columns:1fr/.test(built), '200px of a 325px row went to the label')
  check('the notes heading gets its own row',
    /\.nt-title\{flex:1 0 100%\}/.test(built))
  check('a project’s name and chip may wrap',
    /\.pcard \.pname\{flex-wrap:wrap/.test(built))
  check('a routine’s select takes the width it has',
    /\.rt-field \.select\{flex:1;width:auto;min-width:0\}/.test(built))

  // ── the rail ─────────────────────────────────────────────────────────────
  check('the mark is larger in the drawer', /\.brand-mark\{max-height:24vh\}/.test(built))
  check('and the day/night switch smaller',
    /\.daynight\{width:28px;height:28px/.test(built))

  // ── no keyboard mode on a device with no keyboard ────────────────────────
  const vimPhone = await open(`/day/${D}`, {
    phone: true, before: (w) => w.localStorage.setItem('vim_mode', '1'),
  })
  check('vim mode stays off on a phone even when it is switched on',
    !vimPhone.document.querySelector('.vim-bar'),
    'a mode bar with no keyboard is a strip of screen you cannot dismiss')
  check('and the rail offers no way to turn it on',
    !vimPhone.document.querySelector('.sb-vim'))

  const vimDesk = await open(`/day/${D}`, {
    before: (w) => w.localStorage.setItem('vim_mode', '1'),
  })
  check('while a laptop still gets it', !!vimDesk.document.querySelector('.vim-bar'),
    'the preference is gated, not cleared')

  // ── settings, trimmed ────────────────────────────────────────────────────
  const setPhone = await open('/settings', { phone: true })
  const tabs = () => [...setPhone.document.querySelectorAll('.st-tab')].map((t) => t.textContent.trim())
  check('no keyboard tab on a phone', !tabs().includes('Keyboard'), tabs().join(', '))
  check('the tabs that remain are the ones worth the width',
    ['General', 'AI suite', 'Account'].every((t) => tabs().includes(t)), tabs().join(', '))
  const titles = [...setPhone.document.querySelectorAll('.panel')]
    .map((p) => p.textContent.slice(0, 40)).join(' | ')
  check('and the two nickname tables are not drawn',
    !/Page names/.test(titles) && !/Link names/.test(titles), titles.slice(0, 160))

  const setDesk = await open('/settings')
  check('a laptop keeps all four tabs',
    [...setDesk.document.querySelectorAll('.st-tab')].map((t) => t.textContent.trim()).includes('Keyboard'))

  // ── the month, as a phone calendar ───────────────────────────────────────
  const m2 = await post('/api/tasks', { title: 'ZZ72 on the ninth', scheduled_date: D })
  made.push(m2.id)
  const month = await open(`/month/${D}`, { phone: true })
  const md = month.document
  check('the month draws a summary grid', !!md.querySelector('.mgrid'))
  check('of six weeks', md.querySelectorAll('.mgrid-day').length === 42,
    String(md.querySelectorAll('.mgrid-day').length))
  check('with dots rather than unreadable pills',
    !!md.querySelector('.mgrid-dot') && !md.querySelector('.mgrid .pill'))
  check('and the chosen day listed underneath', !!md.querySelector('.magenda'))

  const cellFor = (d) => [...md.querySelectorAll('.mgrid-day')]
    .find((b) => b.textContent.trim().startsWith(String(Number(d.slice(8)))))
  const ninth = cellFor(D)
  ninth?.dispatchEvent(new month.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await wait(400)
  check('tapping a day selects it', ninth?.classList.contains('is-on'))
  check('and the list below is that day’s',
    /ZZ72 on the ninth/.test(md.querySelector('.magenda')?.textContent || ''),
    (md.querySelector('.magenda')?.textContent || '').slice(0, 90))
  check('a laptop still gets the full grid',
    !!(await open(`/month/${D}`)).document.querySelector('.month'))

  // ── the day's bar, with the room made ────────────────────────────────────
  const dayPhone = await open(`/day/${D}`, { phone: true })
  const pd = dayPhone.document
  const pbar = pd.querySelector('.topbar')
  check('the long date is out of the layout but still in the outline',
    pbar?.querySelector('h1')?.className === 'sr-only',
    pbar?.querySelector('h1')?.className)
  check('the notes link is gone from the bar',
    !pbar?.querySelector('a[href*="/notes/"]'),
    'the rail already reaches the notebook')
  const mini = pd.querySelector('.date-mini')
  check('the date is written short', /^\d\d\/\d\d\/\d\d$/.test(mini?.textContent || ''),
    mini?.textContent)
  check('and reads as the day on screen',
    mini?.textContent === `${D.slice(5, 7)}/${D.slice(8)}/${D.slice(2, 4)}`, mini?.textContent)
  check('the real input is still underneath it, so the picker still opens',
    mini?.querySelector('input[type="date"]')?.value === D,
    'display:none or visibility:hidden here would take the native picker with it')
  check('and it is transparent rather than hidden',
    /\.date-mini input\{[^}]*opacity:0\}/.test(built))

  const dayDesk = await open(`/day/${D}`)
  const dbar = dayDesk.document.querySelector('.topbar')
  check('a laptop keeps the long date', dbar?.querySelector('h1')?.className !== 'sr-only',
    dbar?.querySelector('h1')?.textContent)
  check('and the notes link', !!dbar?.querySelector('a[href*="/notes/"]'))
  check('and the plain native field',
    !!dbar?.querySelector('input.topbar-date[type="date"]') && !dayDesk.document.querySelector('.date-mini'))
  check('whose width is a class now, not an inline style',
    /\.topbar-date\{width:150px\}/.test(built)
      && !/style="width: *150px"/.test(dbar?.innerHTML || ''),
    'an inline width outranks every media query — see CLAUDE.md')

  // ── all tasks opens grouped ──────────────────────────────────────────────
  const all = await open('/tasks')
  const picker = all.document.querySelector('select.at-filter[title="Grouping"]')
    || [...all.document.querySelectorAll('select')].find((s) => s.title === 'Grouping')
  check('the grouping picker is there', !!picker)
  check('and it opens on “By project”', picker?.value === 'project', picker?.value)
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  for (const id of made) await del(`/api/tasks/${id}`)
  console.log('cleanup: probes removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  process.exit(bad ? 1 : 0)
}
