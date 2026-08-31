/**
 * A word for a URL, and everywhere it can be used.
 *
 * The point of the indirection is that a note holds the NAME, not the address:
 * the lookup happens on the click, so re-pointing a nickname re-points every
 * link already written to it. That is the thing worth pinning — anyone can
 * write an anchor.
 */
import './ensure-iife.mjs'
import { JSDOM, VirtualConsole } from 'jsdom'

const BASE = 'http://localhost:8787'
const D = '2031-12-03'
const results = []
const check = (n, ok, d = '') => results.push([n, ok, d])
const doms = []
const tasks = []

const json = async (p, o) => (await fetch(BASE + p, o)).json()
const post = (p, b) => json(p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const patch = (p, b) => json(p, {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})
const del = (p) => fetch(BASE + p, { method: 'DELETE' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

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
      w.localStorage.setItem(`day_start:${D}`, '1')
    },
  })
  doms.push(dom)
  await wait(3400)
  return { dom, window: dom.window, document: dom.window.document, errors }
}

let restore = null
try {
  const was = await json('/api/settings')
  restore = was.link_names ?? null

  // A task whose title carries the nickname rather than the address.
  const task = await post('/api/tasks', {
    title: 'ZZ read the [[link:zzdocs]]', scheduled_date: D,
  })
  tasks.push(task.id)

  // ── naming one from the command line --------------------------------------
  {
    const { window, document, errors } = await open(`/day/${D}`, true)
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const key = (k) => window.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: k, bubbles: true, cancelable: true,
    }))
    const said = () => document.querySelector('.vim-say')?.textContent || ''
    const cmd = async (line) => {
      key('Escape'); await wait(150)
      key(':'); await wait(280)
      const box = document.querySelector('.vim-cmd-input')
      if (!box) return false
      set.call(box, line)
      box.dispatchEvent(new window.Event('input', { bubbles: true }))
      box.closest('form').dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true }),
      )
      await wait(1000)
      return true
    }

    check('the command line opens', await cmd('nameurl zzdocs example.com/handbook'))
    check('a bare host is given a scheme', /https:\/\/example\.com\/handbook/.test(said()), said())
    const stored = JSON.parse((await json('/api/settings')).link_names || '{}')
    check('and it is stored under the name, folded to lower case',
      stored.zzdocs === 'https://example.com/handbook', JSON.stringify(stored))

    await cmd('nameurl zzdocs')
    check('bare, it reads the name back', /example\.com\/handbook/.test(said()), said())

    await cmd('nameurl zzbad not-a-url')
    check('something that is not a URL is refused', /is not a URL/.test(said()), said())

    // One word, one destination — the two stores share a namespace.
    await cmd('namepage zzdocs')
    check('a page cannot take a name a URL already has',
      /already a URL/.test(said()), said())

    check('no command threw', errors.length === 0, errors.join(' | '))
  }

  // ── written into a task, it renders as a link that leaves ------------------
  {
    const { document, errors } = await open(`/day/${D}`, false)
    const row = document.querySelector(`.task[data-task-id="${task.id}"]`)
    const link = row?.querySelector('a.nt-wiki-link')
    check('the nickname renders as a wiki link', !!link,
      row?.querySelector('.task-title')?.innerHTML?.slice(0, 120) || 'no row')
    check('pointed at the resolver, not at a frozen address',
      link?.getAttribute('href') === '/go/link/zzdocs', link?.getAttribute('href') || '')
    check('and it opens in a tab of its own',
      link?.getAttribute('target') === '_blank' && /noopener/.test(link?.getAttribute('rel') || ''),
      `${link?.getAttribute('target')} ${link?.getAttribute('rel')}`)
    check('reading as the name rather than the syntax',
      link?.textContent === 'zzdocs', link?.textContent || '')
    check('nothing threw', errors.length === 0, errors.join(' | '))
  }

  // ── the resolver leaves for wherever the name points NOW -------------------
  {
    // Re-pointed after the task was written. A pasted address would still be
    // going to the old place; a nickname follows.
    await patch('/api/settings', {
      link_names: JSON.stringify({ zzdocs: 'https://example.org/moved' }),
    })
    // jsdom refuses to leave a document and reports the refusal, which is the
    // only way to observe the attempt from in here — but it IS the attempt, and
    // it can only have been made from a name that resolved.
    const gone = await open('/go/link/zzdocs', false)
    check('the resolver leaves the app for a nicknamed URL',
      gone.errors.some((e) => /navigation to another Document/i.test(e)),
      gone.errors.join(' | ') || 'it stayed')
    check('rather than reporting a name it holds as unknown',
      !/Nothing here matches/.test(gone.document.body.textContent || ''),
      (gone.document.body.textContent || '').slice(0, 80))

    const { document: missing } = await open('/go/link/zznothing', false)
    check('an unknown name says so rather than going nowhere quietly',
      /Nothing here matches/.test(missing.body.textContent || ''),
      (missing.body.textContent || '').slice(0, 80))
    check('and says where names come from',
      /nameurl/.test(missing.body.textContent || ''))
  }

  // ── Settings lists them, and forgets them ---------------------------------
  {
    const { window, document } = await open('/settings', false)
    const panel = [...document.querySelectorAll('.panel')]
      .find((p) => p.textContent.trim().startsWith('Link names'))
    check('Settings has a Link names panel', !!panel,
      [...document.querySelectorAll('.panel')].map((p) => p.textContent.slice(0, 14)).join(' | '))
    check('showing the real address, so you can see what it stands for',
      /example\.org\/moved/.test(panel?.textContent || ''), panel?.textContent?.slice(0, 90) || '')
    const out = panel?.querySelector('a[href="https://example.org/moved"]')
    check('as a link that opens in a new tab', out?.getAttribute('target') === '_blank')

    const forget = panel?.querySelector('button[aria-label="Forget zzdocs"]')
    forget?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await wait(1200)
    const after = JSON.parse((await json('/api/settings')).link_names || '{}')
    check('and forgetting one removes it', !('zzdocs' in after), JSON.stringify(after))
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
  // The user's own named URLs back exactly as they were.
  await fetch(`${BASE}/api/settings`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ link_names: restore ?? '' }),
  })
  console.log('cleanup: probes removed')
  for (const d of doms) { try { d.window.close() } catch {} }
  process.exit(bad ? 1 : 0)
}
