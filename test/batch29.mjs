/** Done/optional carries down the subtree, as two separate undo steps. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2029-05-14'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
let dom

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function mk(title, parent, extra = {}) {
  const t = await post('/api/tasks', { title, scheduled_date: D, ...extra })
  if (parent) await post(`/api/tasks/${t.id}/nest`, { parent_id: parent })
  return t.id
}
const stateOf = async (id) => {
  const t = await json(`/api/tasks/${id}`)
  return { status: t.status, optional: t.optional }
}

try {
  // ROOT > KID > GRAND > GREAT, plus a sibling that must not be touched.
  const root = await mk('ZZ ROOT')
  const kid = await mk('ZZ KID', root)
  const grand = await mk('ZZ GRAND', kid)
  const great = await mk('ZZ GREAT', grand)
  const other = await mk('ZZ OTHER')

  // --- the endpoint itself -------------------------------------------------
  const res = await post(`/api/tasks/${root}/cascade`, { field: 'status', value: 'done' })
  check('the cascade reaches every level, not just children',
    res.changed?.length === 3, `${res.changed?.length} rows`)
  check('the great-grandchild is done', (await stateOf(great)).status === 'done')
  check('an unrelated task is untouched', (await stateOf(other)).status === 'todo')
  check('it reports what each row was', res.changed?.every((c) => c.was === 'todo'),
    JSON.stringify(res.changed))

  // A row already in the target state is not recorded, or undo would un-tick
  // something the user had ticked themselves.
  for (const id of [kid, grand, great]) await fetch(`${BASE}/api/tasks/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'todo' }),
  })
  await fetch(`${BASE}/api/tasks/${grand}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  })
  const res2 = await post(`/api/tasks/${root}/cascade`, { field: 'status', value: 'done' })
  check('a child already done is left out of the record',
    res2.changed?.length === 2 && !res2.changed.some((c) => c.id === grand),
    JSON.stringify(res2.changed))

  check('a field that is not cascadable is refused',
    (await post(`/api/tasks/${root}/cascade`, { field: 'title', value: 'x' })).error !== undefined)

  // --- the two-step undo, through the UI -----------------------------------
  for (const id of [root, kid, grand, great]) await fetch(`${BASE}/api/tasks/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'todo' }),
  })

  const vc = new VirtualConsole()
  const errors = []
  vc.on('jsdomError', (e) => errors.push(e.message))
  dom = await JSDOM.fromURL(`${BASE}/day/${D}`, {
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
  const { window } = dom
  const { document } = window
  await wait(3200)
  check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const rowFor = (name) => [...document.querySelectorAll('.task')]
    .find((r) => r.querySelector('.task-title')?.textContent.trim() === name)

  const box = rowFor('ZZ ROOT')?.querySelector('.task-check')
  check('the root row is on screen', !!box)
  box?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(900)

  check('ticking the parent ticks the whole branch',
    (await stateOf(kid)).status === 'done'
    && (await stateOf(grand)).status === 'done'
    && (await stateOf(great)).status === 'done',
    `${(await stateOf(kid)).status}/${(await stateOf(grand)).status}/${(await stateOf(great)).status}`)
  check('and the parent itself', (await stateOf(root)).status === 'done')

  const ctrlZ = async () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'z', ctrlKey: true, bubbles: true,
    }))
    await wait(900)
  }

  await ctrlZ()
  check('the first Ctrl-Z takes back the children',
    (await stateOf(kid)).status === 'todo'
    && (await stateOf(grand)).status === 'todo'
    && (await stateOf(great)).status === 'todo',
    `${(await stateOf(kid)).status}/${(await stateOf(grand)).status}/${(await stateOf(great)).status}`)
  check('all of them in that one step, however deep',
    (await stateOf(great)).status === 'todo')
  check('but leaves the parent done', (await stateOf(root)).status === 'done',
    (await stateOf(root)).status)

  await ctrlZ()
  check('the second Ctrl-Z takes back the parent', (await stateOf(root)).status === 'todo',
    (await stateOf(root)).status)

  // --- un-ticking must NOT cascade ----------------------------------------
  const box2 = rowFor('ZZ ROOT')?.querySelector('.task-check')
  box2?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(900)
  check('ticking again re-ticks the branch', (await stateOf(great)).status === 'done')

  // A done row moves into the collapsed "N done" fold, so it has to be opened
  // before the row exists to click at all.
  const fold = [...document.querySelectorAll('.done-toggle')]
    .find((b) => /\d+ done/.test(b.textContent))
  check('done rows collapse into a fold', !!fold,
    [...document.querySelectorAll('.done-toggle')].map((b) => b.textContent.trim()).join(' | '))
  fold?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(300)

  rowFor('ZZ ROOT')?.querySelector('.task-check')
    ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(900)
  check('the parent came off done', (await stateOf(root)).status === 'todo',
    (await stateOf(root)).status)
  check('un-ticking the parent leaves finished children finished',
    (await stateOf(kid)).status === 'done'
    && (await stateOf(grand)).status === 'done'
    && (await stateOf(great)).status === 'done',
    `${(await stateOf(kid)).status}/${(await stateOf(grand)).status}/${(await stateOf(great)).status}`)

  // --- optional cascades the same way -------------------------------------
  const optRoot = await mk('ZZ OPT')
  const optKid = await mk('ZZ OPTKID', optRoot)
  const optGrand = await mk('ZZ OPTGRAND', optKid)
  const opt = await post(`/api/tasks/${optRoot}/cascade`, { field: 'optional', value: 1 })
  check('optional carries down too', opt.changed?.length === 2, `${opt.changed?.length}`)
  check('to the grandchild', (await stateOf(optGrand)).optional === 1)
  const back = await post(`/api/tasks/${optRoot}/cascade`, { field: 'optional', value: 0 })
  check('and clearing it is a cascade the client simply never sends',
    back.changed?.length === 2, `${back.changed?.length}`)
  void optKid
} catch (e) {
  check('the suite ran to the end', false, `${e.message}`)
} finally {
  let bad = 0
  for (const [n, ok, d] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${ok || !d ? '' : ` — ${d}`}`)
    if (!ok) bad++
  }
  console.log(bad ? `\n${bad} failed` : '\nall checks passed')
  dom?.window?.close()
  const day = await json(`/api/days/${D}`).catch(() => ({ tasks: [], sections: [] }))
  for (const t of day.tasks) await del(`/api/tasks/${t.id}`)
  for (const s of day.sections) await del(`/api/sections/${s.id}`)
  console.log('cleanup: probe day cleared')
}
