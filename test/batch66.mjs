/**
 * The sheet is a page of its own, and everywhere else agrees about `g`.
 *
 * Four things that were each a small lie. `/` and `j` reached past the help
 * overlay to the day underneath, which you cannot see; `t` meant "today" in one
 * mode and "optional" in the other; `o` left the cursor on the row above the
 * task it had just made; and there was no way to say "go to the fourteenth".
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-11-19'
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

const open = async (path, vim) => {
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
      w.localStorage.setItem('vim_mode', vim ? '1' : '0')
      w.localStorage.setItem(`day_start:${TODAY}`, '1')
      w.localStorage.setItem(`day_start:${D}`, '1')
    },
  })
  doms.push(dom)
  await wait(3400)
  return { dom, window: dom.window, document: dom.window.document, errors }
}

try {
  const seed = await post('/api/tasks', {
    title: 'ZZ sheet probe', scheduled_date: D, priority: 'medium',
  })
  tasks.push(seed.id)

  // ── with keyboard control on ----------------------------------------------
  {
    const { window, document, errors } = await open(`/day/${D}`, true)
    const key = (k, init = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: k, bubbles: true, cancelable: true, ...init,
    }))
    const at = () => {
      const el = document.querySelector('.vim-on, .vim-on-section, .vim-on-card')
      return el ? (el.dataset.act || el.dataset.taskId) : null
    }
    const said = () => document.querySelector('.vim-say')?.textContent || ''

    // ── the sheet keeps its own keys ---------------------------------------
    const before = at()
    key('?'); await wait(400)
    check('? puts the sheet up', !!document.querySelector('.vim-help-b'))

    key('j'); key('j'); await wait(400)
    check('j scrolls the sheet rather than walking the day', at() === before,
      `${before} -> ${at()}`)

    key('/'); await wait(300)
    check('/ goes to the sheet’s own filter, not the page’s find',
      document.activeElement?.className?.includes('vim-help-find'),
      document.activeElement?.className || '')
    check('and the page’s find is not open', !document.querySelector('.vim-cmd-input'))

    const box = document.querySelector('.vim-help-find')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(box, 'backlog')
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    await wait(360)
    const shown = [...document.querySelectorAll('.vim-help-b dt')].map((el) => el.textContent)
    check('typing narrows it', shown.length > 0 && shown.length < 20, shown.join(' | '))
    check('to rows that actually mention it',
      document.querySelector('.vim-help-b').textContent.toLowerCase().includes('backlog'))

    key('Escape'); await wait(300)
    check('one Escape clears the filter and leaves the sheet up',
      !!document.querySelector('.vim-help-b')
        && document.querySelector('.vim-help-find')?.value === '')
    key('Escape'); await wait(300)
    check('the next one closes it', !document.querySelector('.vim-help-b'))

    // ── o lands the cursor on what it made ---------------------------------
    key('Escape'); await wait(200)
    const wasOn = at()
    key('o'); await wait(1800)
    const day = await json(`/api/days/${D}`)
    const fresh = day.tasks.find((t) => t.title === 'New task')
    for (const t of day.tasks) if (!tasks.includes(t.id)) tasks.push(t.id)
    check('o makes a task', !!fresh, day.tasks.map((t) => t.title).join(', '))
    check('and the cursor is on it, not on the row above',
      !!fresh && at() === String(fresh.id), `${wasOn} -> ${at()} (made ${fresh?.id})`)

    // ── alt-arrows step the priority ---------------------------------------
    key('Escape'); await wait(200)
    // Back onto the seeded row, whose priority is known.
    const seedRow = document.querySelector(`.task[data-task-id="${seed.id}"]`)
    seedRow?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(400)
    check('the cursor is on the seeded task', at() === String(seed.id), String(at()))
    key('ArrowUp', { altKey: true }); await wait(1200)
    check('Alt-Up raises the priority',
      (await json(`/api/tasks/${seed.id}`)).priority === 'high', said())
    key('ArrowDown', { altKey: true }); await wait(1200)
    key('ArrowDown', { altKey: true }); await wait(1200)
    check('Alt-Down lowers it',
      (await json(`/api/tasks/${seed.id}`)).priority === 'low',
      (await json(`/api/tasks/${seed.id}`)).priority)

    // ── :day ---------------------------------------------------------------
    const cmd = async (line) => {
      key('Escape'); await wait(160)
      key(':'); await wait(280)
      const input = document.querySelector('.vim-cmd-input')
      if (!input) return false
      set.call(input, line)
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      input.closest('form').dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true }),
      )
      await wait(1100)
      return true
    }

    await cmd('day 2031-12-25')
    check(':day takes a date outright', window.location.pathname === '/day/2031-12-25',
      window.location.pathname)
    await cmd('day 0')
    check(':day 0 is today', window.location.pathname === `/day/${TODAY}`,
      window.location.pathname)
    await cmd('day +3')
    const three = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3)
    const iso3 = `${three.getFullYear()}-${pad(three.getMonth() + 1)}-${pad(three.getDate())}`
    check(':day +3 counts from today', window.location.pathname === `/day/${iso3}`,
      window.location.pathname)
    await cmd('day 14')
    check(':day 14 is the fourteenth of this month',
      window.location.pathname === `/day/${TODAY.slice(0, 8)}14`, window.location.pathname)
    await cmd('day 12/25/2031')
    check(':day takes mm/dd/yyyy', window.location.pathname === '/day/2031-12-25',
      window.location.pathname)
    await cmd('day 12-25-2031')
    check(':day takes mm-dd-yyyy', window.location.pathname === '/day/2031-12-25',
      window.location.pathname)
    await cmd('day nonsense')
    check('and says so when it cannot read one', /not a day/i.test(said()), said())

    // ── g goes to the same places ------------------------------------------
    key('Escape'); await wait(200)
    key('g'); key('w'); await wait(1000)
    check('gw is the week, keeping the date', window.location.pathname.startsWith('/week/'),
      window.location.pathname)
    key('g'); key('t'); await wait(1000)
    check('gt is today', window.location.pathname === `/day/${TODAY}`, window.location.pathname)
    key('g'); key('a'); await wait(1000)
    check('ga is all tasks', window.location.pathname === '/tasks', window.location.pathname)

    check('no key threw', errors.length === 0, errors.join(' | '))
  }

  // ── the same chord over a selection, with the mode off --------------------
  {
    await fetch(`${BASE}/api/tasks/${seed.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ priority: 'medium' }),
    })
    const { window, document } = await open(`/day/${D}`, false)
    const key = (k, init = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: k, bubbles: true, cancelable: true, ...init,
    }))
    const row = document.querySelector(`.task[data-task-id="${seed.id}"]`)
    const pick = row?.querySelector('.time-glyph')
    pick?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(500)
    check('a task can be picked without the mode on', !!document.querySelector('.sel-on'))

    key('ArrowUp', { altKey: true }); await wait(1400)
    check('Alt-Up raises the priority of what is picked',
      (await json(`/api/tasks/${seed.id}`)).priority === 'high',
      (await json(`/api/tasks/${seed.id}`)).priority)
    check('and the selection survives, so it can be pressed again',
      !!document.querySelector('.sel-on'))
    key('ArrowUp', { altKey: true }); await wait(1400)
    check('twice gets to the top',
      (await json(`/api/tasks/${seed.id}`)).priority === 'highest',
      (await json(`/api/tasks/${seed.id}`)).priority)
  }

  // ── and the same letters with it off --------------------------------------
  {
    const { window, document, errors } = await open('/week/2031-11-19', false)
    const key = (k) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: k, bubbles: true, cancelable: true,
    }))

    key('t'); await wait(700)
    check('a bare t is no longer a shortcut',
      window.location.pathname === '/week/2031-11-19', window.location.pathname)

    key('g'); await wait(60); key('t'); await wait(1000)
    check('gt is today here too', window.location.pathname === `/day/${TODAY}`,
      window.location.pathname)

    key('g'); await wait(60); key('m'); await wait(1000)
    check('gm is the month', window.location.pathname === `/month/${TODAY}`,
      window.location.pathname)

    key('?'); await wait(500)
    const sheet = document.querySelector('.modal')
    check('? draws the shared table', !!sheet?.querySelector('.st-keys'))
    check('which lists gt', /g then t/.test(sheet?.textContent || ''),
      (sheet?.textContent || '').slice(0, 120))

    check('nothing threw with the mode off', errors.length === 0, errors.join(' | '))
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
