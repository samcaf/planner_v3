/** The keyboard acts, not just navigates, on the pages besides the day. */
import './ensure-iife.mjs'
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
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function openPage(url, errors) {
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(String(e).slice(0, 140)))
  return JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
      w.fetch = (u, o) => fetch(new URL(u, BASE), o)
      w.Element.prototype.scrollIntoView = function () {}
      w.localStorage.setItem('vim_mode', '1')
      Object.defineProperty(w.navigator, 'clipboard', {
        value: { writeText: async (t) => { w.__clip = t } }, configurable: true,
      })
    },
  })
}

/** One page's worth of checks, run against whatever list it draws. */
async function exercise(label, url, ids) {
  const errors = []
  const dom = await openPage(url, errors)
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3400)

  const key = (k, init = {}) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...init,
  }))
  const cursorId = () => {
    const el = document.querySelector('.task.vim-on')
    return el ? Number(el.dataset.taskId) : null
  }
  /**
   * Aim with `/` rather than by walking.
   *
   * All-tasks draws every task in the database, so stepping to one with j is
   * both slow and at the mercy of whatever else is on the page — and the row
   * moves as soon as anything is done to it. Searching for it by name is what
   * the feature is for, and lands on it in one keystroke.
   */
  const aim = async (id, title) => {
    key('Escape'); await wait(120)
    key('/'); await wait(250)
    const box = document.querySelector('.vim-cmd-input')
    if (!box) return false
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    set.call(box, title)
    box.dispatchEvent(new window.Event('input', { bubbles: true }))
    box.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await wait(600)
    for (let i = 0; i < 8 && cursorId() !== id; i++) { key('n'); await wait(140) }
    return cursorId() === id
  }

  for (let i = 0; i < 150 && cursorId() === null; i++) await wait(150)
  check(`${label}: the cursor finds a task`, cursorId() !== null, 'no cursor')

  // --- ticking -------------------------------------------------------------
  check(`${label}: aimed`, await aim(ids.a, 'ZZ act a'), `${cursorId()}`)
  key('Enter'); await wait(1000)
  check(`${label}: Enter ticks a task`, (await json(`/api/tasks/${ids.a}`)).status === 'done',
    (await json(`/api/tasks/${ids.a}`)).status)
  key('u'); await wait(1100)
  check(`${label}: u takes it back`, (await json(`/api/tasks/${ids.a}`)).status === 'todo',
    (await json(`/api/tasks/${ids.a}`)).status)

  // --- setting a time through the command line -----------------------------
  check(`${label}: aimed again`, await aim(ids.a, 'ZZ act a'), `${cursorId()}`)
  key(':'); await wait(300)
  const field = document.querySelector('.vim-cmd-input')
  check(`${label}: the command line opens`, !!field)
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(field, 't 35')
  field.dispatchEvent(new window.Event('input', { bubbles: true }))
  field.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await wait(1200)
  check(`${label}: :t sets an estimate`, (await json(`/api/tasks/${ids.a}`)).estimate_min === 35,
    `${(await json(`/api/tasks/${ids.a}`)).estimate_min}`)

  // --- moving the task itself ----------------------------------------------
  const order = async () => (await json(`/api/tasks?project_id=${projectId}`))
    .filter((t) => t.kind !== 'note')
    .sort((x, y) => x.sort - y.sort || x.id - y.id).map((t) => t.title)
  const before = await order()
  check(`${label}: aimed for the move`, await aim(ids.a, 'ZZ act a'), `${cursorId()}`)
  key('j', { altKey: true }); await wait(1200)
  const after = await order()
  check(`${label}: Alt-j moves the task itself`,
    after.indexOf('ZZ act a') > before.indexOf('ZZ act a'),
    `${before.join(',')} -> ${after.join(',')}`)
  key('k', { altKey: true }); await wait(1200)
  check(`${label}: Alt-k moves it back`, (await order()).join(',') === before.join(','),
    (await order()).join(','))

  // --- yanking -------------------------------------------------------------
  check(`${label}: aimed to yank`, await aim(ids.a, 'ZZ act a'), `${cursorId()}`)
  key('y'); await wait(120); key('y'); await wait(700)
  check(`${label}: yy takes the title and its note`,
    window.__clip === 'ZZ act a\nits note', JSON.stringify(window.__clip))

  // --- adding beside the cursor --------------------------------------------
  const countBefore = (await json(`/api/tasks?project_id=${projectId}`)).length
  check(`${label}: aimed to add`, await aim(ids.a, 'ZZ act a'), `${cursorId()}`)
  key('o'); await wait(1300)
  const added = (await json(`/api/tasks?project_id=${projectId}`))
  check(`${label}: o adds a task`, added.length === countBefore + 1,
    `${countBefore} -> ${added.length}`)
  const fresh = added.find((t) => t.title === 'New task')
  check(`${label}: and it lands in the same project`, !!fresh && fresh.project_id === projectId,
    `${fresh?.project_id}`)
  if (fresh) await del(`/api/tasks/${fresh.id}`)

  check(`${label}: no key threw`, errors.length === 0, errors.slice(0, 2).join(' | '))
  dom.window.close()
}

try {
  const proj = await post('/api/projects', { name: 'ZZ Acts', color: 'teal' })
  projectId = proj.id
  const a = await post('/api/tasks', {
    title: 'ZZ act a', project_id: proj.id, notes: 'its note', estimate_min: 5,
  })
  const b = await post('/api/tasks', { title: 'ZZ act b', project_id: proj.id, estimate_min: 5 })
  const c = await post('/api/tasks', { title: 'ZZ act c', project_id: proj.id, estimate_min: 5 })

  await exercise('all tasks', `${BASE}/tasks`, { a: a.id })
  // Reset what the first pass changed, so the second starts from the same list.
  await json(`/api/tasks/${a.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estimate_min: 5, status: 'todo' }),
  })
  await exercise('project page', `${BASE}/projects/${proj.id}`, { a: a.id })
  void [b, c]
} catch (e) {
  check('the suite ran to the end', false, e.message)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  if (projectId) {
    for (const t of await json(`/api/tasks?project_id=${projectId}`).catch(() => [])) {
      await del(`/api/tasks/${t.id}`)
    }
    await del(`/api/projects/${projectId}`)
  }
  console.log('cleanup: probe project removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
