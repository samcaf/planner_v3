/** A meeting references the group and the people it was booked with. */
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2030-04-08'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
const made = { tasks: [], people: [], groups: [] }

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
  const group = await post('/api/people/groups', {
    name: 'ZZ Lab', kind: 'lab', meeting_url: 'https://meet.example.invalid/zzlab',
  })
  made.groups.push(group.id)
  const ada = await post('/api/people', { name: 'ZZ Ada', role: 'PI', group_id: group.id })
  const bob = await post('/api/people', { name: 'ZZ Bob', role: 'Postdoc', group_id: group.id })
  made.people.push(ada.id, bob.id)

  // ---------------------------------------------------------- the column
  const meeting = await post('/api/tasks', {
    title: 'ZZ standup', kind: 'meeting', scheduled_date: D,
    start_time: '10:00', end_time: '10:30', estimate_min: 30,
    url: 'https://meet.example.invalid/zzlab',
    group_id: group.id, people: [ada.id, bob.id],
  })
  made.tasks.push(meeting.id)

  const back = await json(`/api/tasks/${meeting.id}`)
  check('a meeting stores the group it was booked with', back.group_id === group.id,
    `group_id=${back.group_id}`)
  check('and reports the group name alongside it', back.group_name === 'ZZ Lab', back.group_name)
  check('its attendees come back too', (back.people || []).length === 2,
    `${(back.people || []).length}`)

  const day = await json(`/api/days/${D}`)
  const row = day.tasks.find((t) => t.id === meeting.id)
  check('the day payload carries the group name as well', row?.group_name === 'ZZ Lab',
    row?.group_name)

  // A meeting booked with nobody in particular must not invent a group.
  const solo = await post('/api/tasks', {
    title: 'ZZ solo', kind: 'meeting', scheduled_date: D, start_time: '11:00', end_time: '11:15',
  })
  made.tasks.push(solo.id)
  check('a meeting with no group has none', (await json(`/api/tasks/${solo.id}`)).group_id === null,
    `${(await json(`/api/tasks/${solo.id}`)).group_id}`)

  // ------------------------------------------------------------- the row
  const errors = []
  const dom = await openPage(`${BASE}/day/${D}`, errors)
  doms.push(dom)
  const { window } = dom
  const { document } = window
  await wait(3200)
  check('day: no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  const el = [...document.querySelectorAll('.task')]
    .find((r) => /ZZ standup/.test(r.querySelector('.task-title')?.textContent || ''))
  check('the meeting row renders', !!el)

  const sub = el?.querySelector('.task-sub')
  check('it has a sub-line for the link and the people', !!sub)

  const groupLink = [...(sub?.querySelectorAll('a') || [])]
    .find((a) => (a.getAttribute('href') || '').startsWith('/people?group='))
  check('the group is a reference, not a label', !!groupLink,
    [...(sub?.querySelectorAll('a') || [])].map((a) => a.getAttribute('href')).join(' | '))
  check('naming the group', groupLink?.textContent.includes('ZZ Lab'), groupLink?.textContent)
  check('and pointing at that group',
    groupLink?.getAttribute('href') === `/people?group=${group.id}`,
    groupLink?.getAttribute('href'))

  const people = [...(sub?.querySelectorAll('a.task-sub-person') || [])]
  check('each attendee is a reference too', people.length === 2, `${people.length}`)
  check('pointing at their own pages',
    people.map((a) => a.getAttribute('href')).sort().join(',')
      === [`/people/${ada.id}`, `/people/${bob.id}`].sort().join(','),
    people.map((a) => a.getAttribute('href')).join(' | '))
  check('the names still read as a list',
    /ZZ Ada, ZZ Bob|ZZ Bob, ZZ Ada/.test(sub?.textContent || ''), sub?.textContent)

  check('the join link is still there',
    !![...(sub?.querySelectorAll('a') || [])]
      .find((a) => (a.getAttribute('href') || '').startsWith('https://meet.example.invalid')),
    'no join link')

  const soloEl = [...document.querySelectorAll('.task')]
    .find((r) => /ZZ solo/.test(r.querySelector('.task-title')?.textContent || ''))
  check('a meeting with no group shows no group chip',
    !soloEl?.querySelector('a[href^="/people?group="]'), 'a group appeared from nowhere')
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
  for (const id of made.people) await del(`/api/people/${id}`)
  for (const id of made.groups) await del(`/api/people/groups/${id}`)
  console.log('cleanup: probe rows removed')
  // Non-zero so the runner, and CI, can tell a red suite from a green one.
  process.exit(bad ? 1 : 0)
}
