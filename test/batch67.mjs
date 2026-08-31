/**
 * Settings as three pages, and the mark that opens a day.
 *
 * The keyboard and AI tabs are reference rather than settings, and both are
 * GENERATED — from the tables the keys are bound in and from the switch
 * definitions themselves — so this checks the generation rather than the words:
 * every switch that exists has a row, and a key documented in one place shows
 * up in the other.
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
const tasks = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const pad = (n) => String(n).padStart(2, '0')
const now = new Date()
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

const open = async (path, before = () => {}) => {
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e).slice(0, 140)))
  const dom = await JSDOM.fromURL(BASE + path, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
      before(w)
    },
  })
  doms.push(dom)
  await wait(3200)
  return { dom, window: dom.window, document: dom.window.document, errors }
}

try {
  // ── settings, in tabs ------------------------------------------------------
  {
    const { window, document, errors } = await open('/settings')
    const click = (el) => el?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const tabs = [...document.querySelectorAll('.st-tab')]
    check('there are three tabs', tabs.length === 3, tabs.map((t) => t.textContent).join(', '))
    check('general is the one you land on', tabs[0]?.getAttribute('aria-selected') === 'true')

    const visible = () => [...document.querySelectorAll('.st-stack')]
      .filter((s) => !s.hidden)
    check('only one section is shown at a time', visible().length === 1)
    check('and it is the settings themselves',
      /Pomodoro/.test(visible()[0]?.textContent || ''))

    click(tabs[1])
    await wait(400)
    check('the keyboard tab is its own page',
      /Keys and gestures/.test(visible()[0]?.textContent || ''))
    check('and the tab is in the address', window.location.search === '?tab=keys',
      window.location.search)
    const keysText = visible()[0].textContent
    check('it lists what the app answers to', /g then t/.test(keysText))
    check('and what keyboard control answers to, whether or not it is on',
      /yank/i.test(keysText) && /side column/i.test(keysText))
    check('including the keys added with it',
      /Alt-↑/.test(keysText) && /:day/.test(keysText),
      keysText.includes(':day') ? 'no alt arrows' : 'no :day')

    click(tabs[2])
    await wait(400)
    const aiText = visible()[0].textContent
    check('the ai tab is its own page too', /How it works/.test(aiText))
    check('and the tab is in the address', window.location.search === '?tab=ai',
      window.location.search)

    // Generated, not written out: every switch the app knows about has a row,
    // and each row prints the values that switch actually takes.
    const rows = [...document.querySelectorAll('.st-switch')]
    const named = rows.map((r) => r.querySelector('code')?.textContent)
    const expected = ['mode', 'followups', 'on_done', 'depth', 'budget', 'sign_off',
      'verify', 'detail', 'model', 'effort', 'tokens']
    check('every switch has a row of its own',
      expected.every((k) => named.includes(k)), named.join(', '))
    check('with its values and what each one means',
      /plan/.test(aiText) && /Work it out and write the plan back/.test(aiText))
    check('the enforced ones are kept apart from the declared ones',
      /Enforced/.test(aiText) && /Declared/.test(aiText))
    check('the dialogue is spelled out',
      ['claim', 'ask', 'step', 'report', 'run_state'].every((m) => aiText.includes(m)))
    check('and how to point an agent at it', /claude mcp add planner/.test(aiText))

    check('nothing threw', errors.length === 0, errors.join(' | '))
  }

  // ── the mark that opens a day ---------------------------------------------
  if (now.getHours() < 6) {
    check('day start is only checked after 6am — skipped', true, 'ran before dawn')
  } else {
    const seed = await post('/api/tasks', { title: 'ZZ dawn probe', scheduled_date: TODAY })
    tasks.push(seed.id)

    const first = await open(`/day/${TODAY}`, (w) => {
      w.localStorage.removeItem(`day_start:${TODAY}`)
    })
    check('the first view of today says so',
      !!first.document.querySelector('.dc.is-start'))
    // The word is drawn a letter at a time and the space between them is a
    // non-breaking one, so this compares what it says rather than its bytes.
    check('and it is the beginning, not the completion',
      (first.document.querySelector('.dc.is-start .dc-words')?.textContent || '')
        .replace(/\s+/g, ' ') === 'DAY START',
      first.document.querySelector('.dc-words')?.textContent || '')
    check('it remembers that it has been shown',
      first.window.localStorage.getItem(`day_start:${TODAY}`) === '1')

    // The same browser, opening the same day again: a reload is not a new day.
    const again = await open(`/day/${TODAY}`, (w) => {
      w.localStorage.setItem(`day_start:${TODAY}`, '1')
    })
    check('the second view says nothing', !again.document.querySelector('.dc.is-start'))

    // A day that is not today is not a beginning, whatever you have seen.
    const other = await open('/day/2031-11-26', (w) => {
      w.localStorage.removeItem('day_start:2031-11-26')
    })
    check('and neither is next month', !other.document.querySelector('.dc.is-start'))
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
  for (const id of tasks) await del(`/api/tasks/${id}`)
  console.log('cleanup: probes removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  process.exit(bad ? 1 : 0)
}
