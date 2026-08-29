import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useVim, parseDuration, parseWhen, yankText, yankMarkdown, columnOf, idsIn,
  isCardKey,
  keyOf, isSectionKey, sectionIdOf,
} from '../lib/vim.jsx'
import { GO_TO, GO_DATED, anchorOf } from '../lib/nav.js'
import { openTab } from '../lib/openIn.js'
import { loadNames, saveNames, namesFor, normalise } from '../lib/pageNames.js'
import { PRIORITIES } from './Priority.jsx'
import { today as todayIso } from '../lib/dates.js'
import Icon from './Icon.jsx'
import '../styles/vim.css'

/**
 * The keyboard itself: what each key does, the command line, and the bar that
 * says which mode you are in.
 *
 * Every action here either drives a control the row already has, or calls a
 * handler the page lent through `useVimActions`. Nothing talks to the API
 * directly, which is what keeps Ctrl-Z working on everything done from here.
 */

const HELP = [
  ['Moving', [
    ['j / k', 'next / previous task, or section (3j for three)'],
    ['h / l', 'the box to the left / right'],
    ['J / K', 'select the next / previous section'],
    ['Space', 'fold / unfold — a task’s children, or a whole section'],
    ['Ctrl-Space', 'fold / unfold the section you are in'],
    ['gg / G', 'first / last task'],
    ['Ctrl-d / Ctrl-u', 'half a screen down / up'],
    ['\u2190 / \u2192', 'the day before / after'],
    ['g then d / w / m / n', 'day, week, month, notes'],
    ['g then a / p / e', 'all tasks, projects, people'],
    ['g then r / u / b / h / s', 'routines, uploads, notebook, dashboard, settings'],
  ]],
  ['Changing', [
    ['Enter or x', 'done / not done'],
    ['t', 'optional / committed'],
    ['dd', 'drop'],
    ['DD', 'cut — deletes it, and p puts it back'],
    ['bb', 'send it to the backlog'],
    ['Alt-j / Alt-k', 'move the task — or the section — itself down / up'],
    ['o / O', 'new task below / above'],
    ['> / <', 'priority up / down'],
    ['] / [', 'move to tomorrow / yesterday'],
    ['i', 'edit the title — or rename the section'],
    ['u / Ctrl-r', 'undo / redo'],
    ['Escape', 'back to normal mode'],
  ]],
  ['Selecting', [
    ['v', 'select this task’s text'],
    ['w / 3w', 'extend by a word / three'],
    ['j or k in visual', 'switch to selecting whole tasks'],
    ['V', 'select whole tasks straight away'],
  ]],
  ['Yanking', [
    ['yy or y', 'the text: title, then its note'],
    ['yy on a section', 'everything in it'],
    ['yt', 'as markdown, with its section and metadata'],
    ['p / P', 'paste the tasks below / above the cursor'],
    ['"a', 'use register a for the next yank or paste'],
  ]],
  ['Finding', [
    ['/', 'find on this page'],
    ['n / N', 'the next / previous match'],
    ['Ctrl-/', 'search everything, not just this page'],
  ]],
  ['Cards', [
    ['hjkl', 'across a grid of cards — projects, say'],
    ['Enter', 'open the one under the cursor'],
    ['Shift-Enter', 'open it in a new tab'],
    ['Shift-click', 'open anything in a new tab, mode or no mode'],
  ]],
  ['Elsewhere', [
    ['zp', 'start or pause the pomodoro'],
    ['?', 'this list'],
    [':', 'command line'],
  ]],
  ['Commands', [
    [':done  :drop  :opt', 'change the task under the cursor'],
    [':note', 'write or edit its note'],
    [':bl', 'send it to the backlog'],
    [':t 90   :t 1h30m', 'set its estimate'],
    [':mv tomorrow  :mv +3  :mv 2026-09-01', 'move it'],
    [':pri high', 'set its priority outright'],
    [':cp <when>', 'copy it to a day'],
    [':y   :yt', 'yank as text / as markdown'],
    [':pomo', 'start or pause the pomodoro'],
    [':namepage foo', 'nickname this page — bare, it says its name'],
    [':goto foo', 'go to a page you have nicknamed'],
    [':unname foo', 'forget a nickname'],
    [':vim  :novim  :q', 'turn this off'],
    [':h  :help', 'this list'],
  ]],
]

export { HELP }

export default function VimLayer() {
  const vim = useVim()
  const navigate = useNavigate()
  const cmdInput = useRef(null)
  /**
   * The half-typed sequence — the `g` of `gg`, the `d` of `dd`.
   *
   * A ref, with the state copy kept only for the bar to display. Two keys of a
   * sequence arrive in the same tick far faster than React re-renders, so a
   * handler reading `pending` from state still saw the empty string on the
   * second key and started the sequence again instead of finishing it: `gg`
   * did nothing at all.
   */
  const seq = useRef('')
  /** Where the cursor was in the list, so a row leaving does not send it home. */
  const lastIndex = useRef(0)
  /** Digits typed before a command: the 3 of `3j`, the 2 of `2w`. */
  const count = useRef('')
  /** Whether visual mode is selecting text inside one task, or whole tasks. */
  const grain = useRef('text')
  /**
   * A section this opened only so the cursor could go in.
   *
   * If nothing is changed while inside, it is shut again on the way out — so
   * walking past a collapsed section with J does not quietly unfold the day.
   */
  const peeked = useRef(null)
  /** What / last looked for, so n and N have something to repeat. */
  const lastSearch = useRef('')
  /**
   * The section the cursor was last inside.
   *
   * Folding a section takes its rows off the page, so the cursor is no longer
   * in it and Ctrl-Space would have nothing to unfold — you could shut a
   * section from the keyboard and then not be able to open it again.
   */
  const lastSection = useRef(null)
  /**
   * A section this just folded.
   *
   * Folding takes its rows off the page, so the cursor moves into whatever
   * section is next — and a second Ctrl-Space would then fold THAT one rather
   * than reopening what you just shut. Held until a movement key says you have
   * gone somewhere on purpose.
   */
  const justFolded = useRef(null)
  const {
    enabled, toggle, mode, setMode, cursor, setCursor, selection, move,
    pending, setPending, command, setCommand, flash, say,
    actions, registers, register, helpOpen, setHelpOpen, setAnchor,
  } = vim

  const rowFor = (key) => {
    if (isSectionKey(key)) {
      return document.querySelector(`.panel.section[data-section-id="${sectionIdOf(key)}"]`)
    }
    // Matched by scanning rather than by an attribute selector: the key is a
    // path, and building a selector out of it would need escaping — CSS.escape
    // is not everywhere, and these lists are a dozen cards long.
    if (isCardKey(key)) {
      return [...document.querySelectorAll('[data-open]')].find((el) => el.dataset.open === key) || null
    }
    return document.querySelector(`.task[data-task-id="${key}"]`)
  }
  const ctrl = (id, sel) => rowFor(id)?.querySelector(sel)
  const click = (el, init) => {
    if (!el) return false
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, ...init }))
    return true
  }

  /**
   * Visual mode over the text of one task.
   *
   * A real DOM Selection rather than a private highlight, so it looks like a
   * selection, reads as one to the browser, and copies with the usual keys.
   * `w` walks it forward a word at a time; the count before it says how many.
   */
  const textNodesOf = (id) => {
    const row = rowFor(id)
    if (!row) return []
    // Title first, then the note under it: that is the order they read in, and
    // the order a yank of the pair should produce.
    return ['.task-title', '.rich-view'].map((sel) => row.querySelector(sel)).filter(Boolean)
  }

  const selectText = (id, words) => {
    const [head] = textNodesOf(id)
    if (!head) return false
    const sel = window.getSelection()
    sel.removeAllRanges()
    const range = document.createRange()
    range.selectNodeContents(head)
    sel.addRange(range)
    if (words > 0) {
      // Collapse to the start and walk forward, which is what gives `2w` two
      // words rather than the whole line.
      sel.collapseToStart()
      for (let i = 0; i < words; i++) sel.modify?.('extend', 'forward', 'word')
    }
    return true
  }

  const clearText = () => window.getSelection()?.removeAllRanges()

  /**
   * The rows a yank should take, in the order they are drawn.
   *
   * A sub-section heading carries its whole band. The heading alone says
   * nothing useful — it is a container — so yanking one and getting a single
   * line would be a yank of the label rather than of the work.
   */
  const yankRows = () => {
    const a = actions.current || {}
    if (!a.taskById) return []
    const out = []
    const seen = new Set()
    for (const id of selection) {
      const rows = a.branch && a.taskById(id)?.subsection ? a.branch(id) : [a.taskById(id)]
      for (const row of rows) {
        if (!row || seen.has(row.id)) continue
        seen.add(row.id)
        out.push(row)
      }
    }
    return out
  }

  /**
   * A register holds BOTH what was taken and what it was taken from.
   *
   * `text` is what goes to the clipboard and is what you want outside this app.
   * `rows` is what `p` rebuilds, and it has to be the tasks themselves — with
   * the register holding only text, paste iterated the string and made one task
   * per character. Storing the pair is what lets one yank serve both.
   */
  const putInRegister = async (text, rows, what) => {
    registers.current[register.current] = { text, rows: rows || [] }
    register.current = '"'
    // The clipboard too, or a yank is only useful inside this app.
    try { await navigator.clipboard?.writeText(text) } catch { /* no permission */ }
    if (what) say(`yanked ${what}`)
    setMode('normal')
    setAnchor(null)
    grain.current = 'text'
    clearText()
  }

  /** What a task carries when it is copied: enough to rebuild it, not its id. */
  const asRow = (t) => ({
    title: t.title,
    notes: t.notes,
    estimate_min: t.estimate_min,
    priority: t.priority,
    intensity: t.intensity,
    optional: t.optional,
  })

  /**
   * Rows on this page whose text contains `q`.
   *
   * The page's own grep. A row is what this app is made of, so searching them
   * — rather than raw text nodes — is what lets a hit become the cursor, and
   * n and N walk the hits the way they do in vim.
   */
  const matches = (q) => {
    const needle = String(q || '').trim().toLowerCase()
    if (!needle) return []
    return [...document.querySelectorAll('.task[data-task-id]')]
      .filter((el) => el.textContent.toLowerCase().includes(needle))
      .map((el) => Number(el.dataset.taskId))
  }

  /**
   * Paint the matched words themselves, not just the rows holding them.
   *
   * The CSS Custom Highlight API rather than wrapping the text in elements:
   * these rows are React's, and splicing <mark> into them would be undone on
   * the next render — and would fight the editors that live inside them.
   * Where the API is missing the row marking still stands on its own.
   */
  const paintMatches = (q) => {
    const CSSHL = window.CSS?.highlights
    if (!CSSHL) return
    CSSHL.delete('vim-find')
    const needle = String(q || '').trim().toLowerCase()
    if (!needle) return

    const ranges = []
    for (const row of document.querySelectorAll('.task[data-task-id]')) {
      const walker = document.createTreeWalker(row, window.NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue.toLowerCase()
        let at = text.indexOf(needle)
        while (at >= 0) {
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + needle.length)
          ranges.push(range)
          at = text.indexOf(needle, at + needle.length)
        }
      }
    }
    if (ranges.length) CSSHL.set('vim-find', new window.Highlight(...ranges))
  }

  /** Every task drawn inside a section, in the order it is drawn. */
  const sectionRows = (key) => {
    const a = actions.current || {}
    const el = rowFor(key)
    if (!el || !a.taskById) return []
    return [...el.querySelectorAll('.task[data-task-id]')]
      .map((r) => a.taskById(Number(r.dataset.taskId)))
      .filter(Boolean)
  }

  /**
   * Where the cursor should land when a row is about to leave.
   *
   * The row above it, staying inside the same box — walking into the box
   * beside it would be as wrong here as it is for j. Failing that the section
   * it was in, which is still on the page and is the nearest thing left.
   */
  const stopAbove = (key) => {
    const el = rowFor(key)
    if (!el) return null
    const col = el.closest('.box-col')
    if (col) {
      const inCol = idsIn(col)
      const at = inCol.indexOf(key)
      if (at > 0) return inCol[at - 1]
    } else {
      const all = [...document.querySelectorAll('.task[data-task-id]')]
        .map((r) => Number(r.dataset.taskId))
      const at = all.indexOf(key)
      if (at > 0) return all[at - 1]
    }
    const sec = el.closest('.panel.section[data-section-id]')
    return sec ? `s${sec.dataset.sectionId}` : null
  }

  const sectionEl = (key) => (isSectionKey(key)
    ? rowFor(key)
    : rowFor(key)?.closest('.panel.section') || null)
  const sectionsOnPage = () => [...document.querySelectorAll('.panel.section[data-section-id]')]
  const twistOf = (el) => el?.querySelector('[data-section-twist]')
  const isShut = (el) => el?.dataset.sectionShut === '1'

  /** Shut again whatever was opened just to look inside, if nothing changed. */
  const unpeek = (leavingId) => {
    const held = peeked.current
    if (!held) return
    if (held.dirty) { peeked.current = null; return }
    const stillInside = sectionEl(leavingId)?.dataset.sectionId === held.id
    if (stillInside) return
    const el = document.querySelector(`.panel.section[data-section-id="${held.id}"]`)
    if (el && !isShut(el)) click(twistOf(el))
    peeked.current = null
  }

  /** Everything a command or a key can ask for, in one place. */
  const CHANGES = new Set([
    'done', 'optional', 'drop', 'delete', 'edit', 'estimate', 'move', 'copy',
    'paste', 'new', 'note', 'shift', 'undo', 'redo',
  ])

  const run = async (what, arg) => {
    if (CHANGES.has(what) && peeked.current) peeked.current.dirty = true
    const a = actions.current || {}
    const ids = selection
    const id = cursor

    // Only the things that act ON a task need one. Undo, the pomodoro, walking
    // sections and folding one do not — and requiring a cursor for them meant
    // that as soon as a row vanished (ticking folds it away) those keys went
    // dead with no explanation, which looked like the mode had stopped working.
    const NEEDS_TASK = !['pomodoro', 'undo', 'redo', 'section', 'foldSection'].includes(what)
    if (id == null && NEEDS_TASK) { say('no task under the cursor'); return }

    // A card is a whole panel you can open — a project, say. Almost nothing
    // that acts on a task means anything for one, so the few keys that do are
    // named here and the rest say why they did nothing.
    if (isCardKey(id)) {
      if (what === 'open') {
        const el = rowFor(id)
        if (!el) { say('nothing under the cursor') ; return }
        if (arg === 'tab') { openTab(id); say('opened in a new tab'); return }
        click(el)
        return
      }
      if (what === 'column') { move(arg === 'left' ? 'left' : 'right'); return }
      if (['undo', 'redo', 'pomodoro'].includes(what)) { /* fall through */ } else {
        say('that is a card — Enter opens it')
        return
      }
    }

    // With a section under the cursor, the keys that act on one task say so
    // rather than silently doing nothing — except the handful that mean
    // something for a section too, which are handled below.
    if (isSectionKey(id)) {
      if (what === 'shift') {
        if (!a.shiftSection) { say('sections cannot be reordered here'); return }
        await a.shiftSection(sectionIdOf(id), arg === 'up' ? -1 : 1)
        return
      }
      if (what === 'fold' || what === 'foldSection') {
        const el = rowFor(id)
        if (peeked.current?.id === sectionIdOf(id)) peeked.current = null
        const wasShut = isShut(el)
        click(twistOf(el))
        justFolded.current = wasShut ? null : sectionIdOf(id)
        return
      }
      if (what === 'yank' || what === 'yankMarkdown') {
        const rowsOut = sectionRows(id)
        if (!rowsOut.length) { say('nothing in this section'); return }
        await putInRegister(
          what === 'yank'
            ? yankText(rowsOut)
            : yankMarkdown(rowsOut, { sectionName: a.sectionName }),
          `${rowsOut.length} from ${rowFor(id)?.querySelector('.section-h')?.textContent?.trim() || 'the section'}`,
        )
        return
      }
      if (['undo', 'redo', 'pomodoro', 'section', 'edit'].includes(what)) { /* fall through */ } else {
        say('that is a section — j moves into it')
        return
      }
    }

    switch (what) {
      case 'done':
        for (const t of ids) click(ctrl(t, '.task-check'))
        break
      case 'optional':
        for (const t of ids) {
          const box = ctrl(t, '.task-check')
          box?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        }
        break
      case 'drop':
        for (const t of ids) click(ctrl(t, '.task-check'), { shiftKey: true })
        break
      case 'delete': {
        if (!a.remove) { say('nothing here can delete a task'); return }

        // Cut, not just delete — the same as dd in vim, so p puts it back or
        // puts it somewhere else. The rows are taken before they are gone,
        // because afterwards there is nothing to read them from.
        const taken = ids.map((t) => a.taskById?.(t)).filter(Boolean)
        if (taken.length) await putInRegister(yankText(taken), taken.map(asRow), null)

        // Where to stand afterwards: the row above, and failing that the
        // section it was in. Worked out AND moved to before the row goes —
        // set afterwards, the cursor is briefly pointing at something that no
        // longer exists, and the recovery that catches that fires first and
        // puts it on the section instead.
        const landing = stopAbove(ids[0])
        if (landing != null) setCursor(landing)
        for (const t of ids) await a.remove(t)
        say(taken.length === 1 ? 'cut 1 task' : `cut ${taken.length} tasks`)
        break
      }
      case 'backlog': {
        if (!a.backlog) { say('nothing here can send a task to the backlog'); return }
        const landing = stopAbove(ids[0])
        if (landing != null) setCursor(landing)
        for (const t of ids) await a.backlog(t)
        say(ids.length === 1 ? 'to the backlog' : `${ids.length} to the backlog`)
        break
      }
      case 'edit': {
        // Aim at the element that actually listens. The handler that opens a
        // title for editing sits on the .rich-line INSIDE .task-title, and a
        // click dispatched at a parent never reaches a child — so clicking
        // .task-title, as this used to, did nothing at all. A section keeps
        // its name in a button of its own; a note row has no title line and
        // opens its body instead.
        const el = isSectionKey(id)
          ? ctrl(id, '.section-name')
          : (ctrl(id, '.task-title .rich-line') || ctrl(id, '.rich-view'))
        if (!click(el)) break
        setMode('insert')
        break
      }
      case 'fold': {
        // A sub-section heading has no twist of its own — the band it heads
        // carries one, because the band is what draws the children.
        const row = rowFor(id)
        const twist = row?.querySelector('.task-twist[aria-expanded]')
          || (row?.closest('.subsec-head') && row.closest('.subsec')?.querySelector('.subsec-twist'))
        if (twist) click(twist); else say('nothing under this to fold')
        break
      }
      case 'section': {
        const all = sectionsOnPage()
        if (!all.length) return
        const here = sectionEl(id)
        const at = here ? all.indexOf(here) : -1
        const want = at < 0
          ? (arg === 'up' ? all.length - 1 : 0)
          : at + (arg === 'up' ? -1 : 1)
        if (want < 0 || want >= all.length) { say(arg === 'up' ? 'first section' : 'last section'); return }

        const target = all[want]
        // Going into a shut section opens it, and remembers that it was this
        // that opened it. Leaving without changing anything shuts it again.
        if (isShut(target)) {
          click(twistOf(target))
          await new Promise((r) => setTimeout(r, 120))
          peeked.current = { id: target.dataset.sectionId, dirty: false }
        }
        // The section itself, not the first thing in it: J and K move BETWEEN
        // sections, and landing a row inside one made the pair read as "into
        // the next section" rather than "to it". j goes in from here.
        const key = `s${target.dataset.sectionId}`
        unpeek(key)
        setCursor(key)
        break
      }
      case 'foldSection': {
        // What was just folded wins, so the second press reopens it rather than
        // shutting whichever section the cursor fell into.
        const pinned = justFolded.current
          && document.querySelector(`.panel.section[data-section-id="${justFolded.current}"]`)
        const here = (pinned && isShut(pinned) ? pinned : null)
          || sectionEl(id)
          || (lastSection.current
            && document.querySelector(`.panel.section[data-section-id="${lastSection.current}"]`))
        if (!here) { say('this task is in no section'); return }

        // Deliberate, so it stays that way rather than being a peek.
        if (peeked.current?.id === here.dataset.sectionId) peeked.current = null
        const wasShut = isShut(here)
        click(twistOf(here))
        justFolded.current = wasShut ? null : here.dataset.sectionId
        break
      }
      case 'column': {
        // Sideways through the three boxes, keeping roughly the same depth
        // down the column so it feels like moving across a grid.
        // Silent where there are no columns: h and l simply have nothing to
        // do in a plain list, and a complaint every time would be noise.
        const at = columnOf(id)
        if (!at) return
        const step = arg === 'left' ? -1 : 1
        const here = idsIn(at.cols[at.index]).indexOf(id)
        for (let i = at.index + step; i >= 0 && i < at.cols.length; i += step) {
          const there = idsIn(at.cols[i])
          if (!there.length) continue
          setCursor(there[Math.min(Math.max(0, here), there.length - 1)])
          return
        }
        say(arg === 'left' ? 'no box to the left' : 'no box to the right')
        break
      }
      case 'estimate': {
        const mins = parseDuration(arg)
        if (mins === null) { say(`"${arg}" is not a duration`); return }
        if (!a.patch) { say('nothing here can set a time'); return }
        for (const t of ids) await a.patch(t, { estimate_min: mins, col_index: null })
        say(`${mins}m`)
        break
      }
      case 'move':
      case 'copy': {
        if (!a.reschedule || !a.taskById || !a.date) { say('nothing here can move a task'); return }
        const to = parseWhen(arg, a.date)
        if (!to) { say(`"${arg}" is not a date`); return }
        for (const t of ids) {
          const task = a.taskById(t)
          if (task) await a.reschedule(task, to, what === 'copy')
        }
        say(`${what === 'copy' ? 'copied to' : 'moved to'} ${to}`)
        break
      }
      case 'yank': {
        // Whatever is highlighted inside a task wins: `v` then `w` then `y`
        // means those words, not the whole row.
        const picked = String(window.getSelection() || '').trim()
        if (mode === 'visual' && grain.current === 'text' && picked) {
          await putInRegister(picked, [], picked.length === 1 ? '1 character' : `${picked.length} characters`)
          return
        }
        const rowsOut = yankRows()
        if (!rowsOut.length) { say('nothing here to yank from'); return }
        await putInRegister(
          yankText(rowsOut),
          rowsOut.map(asRow),
          `${rowsOut.length} ${rowsOut.length === 1 ? 'task' : 'tasks'}`,
        )
        break
      }
      case 'yankMarkdown': {
        const rowsOut = yankRows()
        if (!rowsOut.length) { say('nothing here to yank from'); return }
        await putInRegister(
          yankMarkdown(rowsOut, { sectionName: a.sectionName }),
          rowsOut.map(asRow),
          `${rowsOut.length} as markdown`,
        )
        break
      }
      case 'note': {
        // The notes box, opened from the row's own control so the same state
        // is used whether it was reached by mouse or by keyboard.
        const row = rowFor(id)
        const showing = row?.querySelector('.rich-view, .task-notes textarea')
        if (!showing) {
          const toggle = [...(row?.querySelectorAll('button') || [])]
            .find((b2) => /notes/i.test(b2.getAttribute('title') || ''))
          if (!toggle) { say('this row has no note to open'); return }
          click(toggle)
          await new Promise((r) => setTimeout(r, 60))
        }
        const box = rowFor(id)?.querySelector('.rich-view')
        if (box) { click(box); setMode('insert') } else { say('could not open the note') }
        break
      }
      case 'priority': {
        if (!a.patch) { say('nothing here can set a priority'); return }
        // PRIORITIES runs lowest to highest, so `up` is simply forward through
        // it — and the step is clamped rather than wrapping, because rolling
        // from highest round to lowest is never what a keypress meant.
        for (const t of ids) {
          const task = a.taskById?.(t)
          const at = PRIORITIES.indexOf(task?.priority || 'medium')
          const want = Math.max(0, Math.min(PRIORITIES.length - 1,
            (at < 0 ? PRIORITIES.indexOf('medium') : at) + (arg === 'up' ? 1 : -1)))
          if (PRIORITIES[want] !== task?.priority) await a.patch(t, { priority: PRIORITIES[want] })
        }
        const now = a.taskById?.(ids[0])
        say(ids.length === 1 ? `priority ${PRIORITIES[Math.max(0, Math.min(
          PRIORITIES.length - 1,
          PRIORITIES.indexOf(now?.priority || 'medium') + (arg === 'up' ? 1 : -1),
        ))]}` : `${ids.length} tasks`)
        break
      }
      case 'shift': {
        // Move the task itself rather than the cursor, which is what J and K
        // mean once j and k are taken.
        if (!a.shift) { say('nothing here can reorder a task'); return }
        await a.shift(id, arg === 'up' ? -1 : 1)
        break
      }
      // Act, then report. canUndo/canRedo are computed from refs when the
      // provider renders, so a copy lent to this layer goes stale the moment
      // the stacks change without a render — and gating on it refused a redo
      // that was perfectly available.
      case 'undo': {
        const op = await a.undo?.undo?.()
        say(op ? `undone: ${op.label || 'last change'}` : 'nothing to undo')
        break
      }
      case 'redo': {
        const op = await a.undo?.redo?.()
        say(op ? `redone: ${op.label || 'last change'}` : 'nothing to redo')
        break
      }
      case 'paste': {
        const held = registers.current[register.current]
        register.current = '"'
        if (!held) { say('register is empty'); return }
        if (!a.addNear) { say('nothing here can add a task'); return }

        // Whole tasks where the yank took whole tasks; otherwise one task
        // named by whatever text was taken, which is what pasting a phrase
        // into a list should mean.
        const rows = held.rows?.length
          ? held.rows
          : (held.text ? [{ title: held.text.split('\n')[0] }] : [])
        if (!rows.length) { say('register is empty'); return }
        // In order, so a run pasted below the cursor keeps the order it was
        // taken in rather than arriving upside down.
        for (const row of (arg === 'above' ? rows : [...rows].reverse())) {
          await a.addNear(id, row, arg === 'above' ? 'above' : 'below')
        }
        say(`pasted ${rows.length} ${rows.length === 1 ? 'task' : 'tasks'}`)
        break
      }
      case 'new': {
        if (!a.addNear) { say('nothing here can add a task'); return }
        await a.addNear(id, { title: 'New task' }, arg === 'above' ? 'above' : 'below')
        break
      }
      case 'pomodoro':
        if (!click(document.querySelector('[data-pomo="toggle"]'))) say('no pomodoro to start')
        break
      default:
        say(`unknown: ${what}`)
    }
  }

  /** `:` commands. Split so the key handler stays about keys. */
  const runCommand = async (line) => {
    const [head, ...rest] = line.trim().split(/\s+/)
    const arg = rest.join(' ')
    const verb = (head || '').toLowerCase()

    if (!verb) return
    if (['q', 'novim', 'nov'].includes(verb)) { toggle(false); say('vim mode off'); return }
    if (verb === 'vim') { toggle(true); say('vim mode on'); return }
    if (['h', 'help'].includes(verb)) { setHelpOpen(true); return }
    if (verb === 'w') { say('nothing to save — every edit is already written'); return }

    // Nicknames for pages. `:namepage` here, `:goto` from anywhere.
    if (['goto', 'gt'].includes(verb)) {
      const want = normalise(arg)
      if (!want) { say('goto where? — :goto <name>'); return }
      const names = await loadNames()
      const there = names[want]
      if (!there) {
        const known = Object.keys(names)
        say(known.length
          ? `nothing called "${want}" — try ${known.slice(0, 6).join(', ')}`
          : 'no page has a name yet — :namepage <name> gives this one one')
        return
      }
      navigate(there)
      say(`→ ${want}`)
      return
    }
    if (['namepage', 'np'].includes(verb)) {
      const names = await loadNames()
      const here = window.location.pathname
      if (!arg.trim()) {
        const mine = namesFor(names, here)
        say(mine.length
          ? `this page is "${mine.join('", "')}"`
          : 'this page has no name — :namepage <name> gives it one')
        return
      }
      const want = normalise(arg)
      // One name, one page. Reusing a name re-points it rather than making a
      // second entry you could never tell apart.
      await saveNames({ ...names, [want]: here })
      say(`named "${want}"`)
      return
    }
    if (verb === 'unname') {
      const names = await loadNames()
      const here = window.location.pathname
      // With no argument it drops this page's names, which is what you want
      // when you cannot remember what you called it.
      const going = arg.trim() ? [normalise(arg)] : namesFor(names, here)
      if (!going.length) { say('nothing to unname here'); return }
      const left = { ...names }
      for (const n of going) delete left[n]
      await saveNames(left)
      say(`unnamed "${going.join('", "')}"`)
      return
    }
    if (verb === 'pri' || verb === 'priority') {
      const want = arg.trim().toLowerCase()
      if (!PRIORITIES.includes(want)) { say(`priority is one of ${PRIORITIES.join(', ')}`); return }
      const a2 = actions.current || {}
      if (!a2.patch) { say('nothing here can set a priority'); return }
      for (const t of selection) await a2.patch(t, { priority: want })
      say(`priority ${want}`)
      return
    }
    if (verb === 'bl' || verb === 'backlog') return run('backlog')
    if (verb === 'note') return run('note')
    if (verb === 'y' || verb === 'yank') return run('yank')
    if (verb === 'yt') return run('yankMarkdown')
    if (verb === 'done') return run('done')
    if (verb === 'drop') return run('drop')
    if (['opt', 'optional'].includes(verb)) return run('optional')
    if (verb === 'del') return run('delete')
    if (['t', 'time', 'est'].includes(verb)) return run('estimate', arg)
    if (['mv', 'move'].includes(verb)) return run('move', arg)
    if (['cp', 'copy'].includes(verb)) return run('copy', arg)
    if (['pomo', 'pom'].includes(verb)) return run('pomodoro')
    say(`not a command: ${verb}`)
  }

  useEffect(() => {
    const onKey = (e) => {
      // The one binding that works whether or not vim mode is on.
      if (e.altKey && e.ctrlKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        toggle()
        return
      }
      if (!enabled) return

      // Escape always comes back, even out of a text box.
      if (e.key === 'Escape') {
        if (helpOpen) { setHelpOpen(false); return }
        if (mode === 'command' || mode === 'search') { setCommand(''); setMode('normal'); return }
        if (typing()) {
          // Vim's contract: Escape leaves insert mode KEEPING what was typed,
          // and blurring the field is what commits it. A field's own Escape
          // means "cancel this edit" — the mouse convention — and the two
          // fight over one keystroke, with the winner decided by listener
          // order. Stop the event here so the vim reading is the one that
          // happens, on purpose rather than by luck.
          e.stopPropagation()
          document.activeElement.blur()
          setMode('normal')
          return
        }
        setMode('normal'); setAnchor(null); seq.current = ''; setPending('')
        lastSearch.current = ''
        window.CSS?.highlights?.delete('vim-find')
        return
      }

      // A field can close without Escape — Enter commits a title and the row
      // re-renders without the input. The mode has to follow it out, or every
      // key from then on is swallowed by an insert mode with nothing to insert
      // into, which reads as the whole mode having stopped working.
      if (mode === 'insert' && !typing()) setMode('normal')
      // While the caret is in a field, the field owns every other key.
      else if (typing() || mode === 'insert' || mode === 'command' || mode === 'search') return
      // Leave the app's own chords alone: Ctrl-Z, Ctrl-K and the rest. The three
      // named here are ours — half a screen down, half a screen up, and redo —
      // and leaving `r` out of this list is why Ctrl-r never reached its binding.
      const MINE = ['d', 'u', 'r', ' ']
      if (e.metaKey || (e.ctrlKey && !MINE.includes(e.key.toLowerCase()))) return

      const k = e.key

      // A count typed before a command: the 3 of `3j`, the 2 of `2w`. A leading
      // zero is not a count — vim keeps 0 for "start of line".
      if (/^[1-9]$/.test(k) || (k === '0' && count.current)) {
        e.preventDefault(); e.stopPropagation()
        count.current += k
        setPending(count.current)
        return
      }
      const N = Math.max(1, Number(count.current) || 1)
      const takeCount = () => { count.current = ''; }

      // --- two-key sequences ------------------------------------------------
      const held = seq.current
      const clear = () => { seq.current = ''; setPending('') }
      if (held === 'g') {
        clear()
        if (k === 'g') { e.preventDefault(); e.stopPropagation(); move('first'); return }
        // The same g-prefix the app has without this mode on, so `ga` means
        // all-tasks either way rather than one thing in each.
        const to = GO_TO[k]
        if (to) { e.preventDefault(); e.stopPropagation(); navigate(to); return }
        const dated = GO_DATED[k]
        if (dated) {
          e.preventDefault(); e.stopPropagation()
          navigate(`/${dated}/${anchorOf(window.location.pathname, todayIso())}`)
        }
        return
      }
      if (held === 'd') {
        clear()
        if (k === 'd') { e.preventDefault(); e.stopPropagation(); run('drop') }
        return
      }
      if (held === 'D') {
        clear()
        if (k === 'D') { e.preventDefault(); e.stopPropagation(); run('delete') }
        return
      }
      if (held === '"') {
        clear()
        if (/^[a-z0-9]$/i.test(k)) {
          e.preventDefault(); e.stopPropagation()
          register.current = k
          say(`register ${k}`)
        }
        return
      }
      if (held === 'b') {
        clear()
        if (k === 'b') { e.preventDefault(); e.stopPropagation(); run('backlog') }
        return
      }
      if (held === 'y') {
        clear()
        if (k === 'y') { e.preventDefault(); e.stopPropagation(); run('yank') }
        else if (k === 't') { e.preventDefault(); e.stopPropagation(); run('yankMarkdown') }
        return
      }
      if (held === 'z') {
        clear()
        e.preventDefault(); e.stopPropagation()
        // za/zo/zc fold, as in vim. The pomodoro gets zp rather than a bare z:
        // sharing the prefix means neither has to wait to find out which it is.
        if (['a', 'c', 'o'].includes(k)) run('fold')
        else if (k === 'p') run('pomodoro')
        else say(`z${k} is not a fold`)
        return
      }
      if (['g', 'd', 'D', 'b', '"'].includes(k)) {
        e.preventDefault()
        e.stopPropagation()
        seq.current = k
        setPending(k)
        return
      }

      // --- single keys ------------------------------------------------------
      // stopPropagation as well as preventDefault: the app's own shortcut layer
      // listens on window in the bubble phase, and preventDefault alone would
      // not stop it. It also stands down while this is on, so this is the belt
      // to that braces.
      const go = (fn) => {
        e.preventDefault(); e.stopPropagation()
        takeCount(); setPending('')
        fn()
      }

      // Moving between tasks. In visual mode this is also the moment the
      // selection stops being about the words in one task and becomes about
      // whole tasks — which is what pressing j in the middle of a title means.
      const coarsen = () => {
        if (mode === 'visual' && grain.current === 'text') {
          // The span starts where the text selection was, so switching grain
          // keeps the task you were reading as one end of it.
          grain.current = 'task'
          clearText()
          setAnchor(cursor)
        }
      }
      // Moving the cursor also shuts any section that was opened only so it
      // could be looked into.
      const step = (fn) => { justFolded.current = null; fn(); unpeek(cursor) }

      // The modified forms come first. Alt-j still arrives with key 'j', so a
      // plain-j branch above this would swallow it and move the cursor instead
      // of the task.
      if (e.altKey && k.toLowerCase() === 'j') return go(() => run('shift', 'down'))
      if (e.altKey && k.toLowerCase() === 'k') return go(() => run('shift', 'up'))
      if (e.altKey) return

      // With nothing to point at — a page with no tasks on it — j and k fall
      // back to scrolling, which is what they do in a pager and what your hands
      // will try anyway.
      const noRows = () => !document.querySelector(
        '.panel.section[data-section-id], .task[data-task-id], [data-open]',
      )
      /** scrollBy where it exists, scrollTop where it does not. */
      const scrollPage = (by) => {
        const el = document.querySelector('.main') || document.scrollingElement
        if (!el) return
        if (typeof el.scrollBy === 'function') el.scrollBy({ top: by })
        else el.scrollTop += by
      }
      if (k === 'j') {
        return go(() => {
          if (noRows()) { scrollPage(60 * N); return }
          coarsen(); step(() => move('down', N))
        })
      }
      if (k === 'k') {
        return go(() => {
          if (noRows()) { scrollPage(-60 * N); return }
          coarsen(); step(() => move('up', N))
        })
      }
      if (k === 'G') return go(() => move('last'))
      if (k === 'h') return go(() => run('column', 'left'))
      if (k === 'l') return go(() => run('column', 'right'))
      // Whole sections, not rows. Moving the task itself is Alt-j and Alt-k.
      if (k === 'J') return go(() => { justFolded.current = null; run('section', 'down') })
      if (k === 'K') return go(() => { justFolded.current = null; run('section', 'up') })
      if (k === 'u') return go(() => run('undo'))
      if (e.ctrlKey && k.toLowerCase() === 'r') return go(() => run('redo'))
      if (k === 'w') {
        return go(() => {
          if (mode !== 'visual' || grain.current !== 'text') { say('w extends a selection — press v first'); return }
          selectText(cursor, N)
        })
      }
      if (e.ctrlKey && k.toLowerCase() === 'd') return go(() => move('down', 8))
      if (e.ctrlKey && k.toLowerCase() === 'u') return go(() => move('up', 8))
      // Space folds what is under a task; Ctrl-Space folds the whole section.
      // Enter is what ticks a task off, and x with it for the vim habit.
      if (k === ' ' && e.ctrlKey) return go(() => run('foldSection'))
      if (k === ' ') return go(() => run('fold'))
      // Enter opens what can be opened and ticks what cannot. Shift-Enter
      // opens in a new tab, the keyboard's spelling of shift-click.
      if (k === 'Enter' && isCardKey(cursor)) {
        return go(() => run('open', e.shiftKey ? 'tab' : null))
      }
      if (k === 'Enter' || k === 'x') return go(() => run('done'))
      if (k === 't') return go(() => run('optional'))
      if (k === 'o') return go(() => run('new', 'below'))
      if (k === 'O') return go(() => run('new', 'above'))
      // > and < step the priority, the way they step an indent in vim.
      if (k === '>') return go(() => run('priority', 'up'))
      if (k === '<') return go(() => run('priority', 'down'))
      // Moving a day either way took those keys; the brackets have it now.
      if (k === ']') return go(() => run('move', 'tomorrow'))
      if (k === '[') return go(() => run('move', 'yesterday'))
      if (k === 'i') return go(() => run('edit'))
      if (k === 'v' || k === 'V') {
        return go(() => {
          if (mode === 'visual') {
            setMode('normal'); setAnchor(null); grain.current = 'text'; clearText()
            return
          }
          // v starts inside the task, on its text. V starts on whole tasks,
          // for when that is what you already know you want.
          grain.current = k === 'V' ? 'task' : 'text'
          setAnchor(cursor)
          setMode('visual')
          if (grain.current === 'text' && !selectText(cursor, 0)) {
            grain.current = 'task'
          }
        })
      }
      if (k === 'y') {
        // yy in normal mode, y on its own in visual — the same two forms vim
        // uses. yt is the markdown one.
        if (mode === 'visual') return go(() => run('yank'))
        e.preventDefault(); e.stopPropagation()
        seq.current = 'y'; setPending('y')
        return
      }
      if (k === 'p') return go(() => run('paste', 'below'))
      if (k === 'P') return go(() => run('paste', 'above'))
      if (k === 'z') {
        e.preventDefault(); e.stopPropagation()
        seq.current = 'z'; setPending('z')
        return
      }
      if (k === '?') return go(() => setHelpOpen(true))
      if (k === '/') {
        return go(() => {
          setCommand('')
          setMode('search')
          setTimeout(() => cmdInput.current?.focus(), 0)
        })
      }
      if (k === 'n' || k === 'N') {
        return go(() => {
          const hits = matches(lastSearch.current)
          if (!hits.length) { say(lastSearch.current ? 'no match' : 'nothing searched for yet'); return }
          const at = hits.indexOf(cursor)
          const next = k === 'n'
            ? hits[(at + 1 + hits.length) % hits.length]
            : hits[(at - 1 + hits.length) % hits.length]
          setCursor(next)
          say(`${hits.indexOf(next) + 1} of ${hits.length}`)
        })
      }
      if (k === ':') {
        return go(() => {
          setCommand('')
          setMode('command')
          setTimeout(() => cmdInput.current?.focus(), 0)
        })
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // A click puts the cursor where you clicked. Reaching for the mouse in the
  // middle of a keyboard session is normal, and coming back to find the cursor
  // still where it was three tasks ago is not what anyone means by it.
  useEffect(() => {
    if (!enabled) return
    const onClick = (e) => {
      const row = e.target.closest?.('.task[data-task-id]')
      if (!row) return
      const id = Number(row.dataset.taskId)
      if (!Number.isNaN(id)) setCursor(id)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [enabled, setCursor])

  // Belt to the observer's braces. The repaint below adopts the first row the
  // moment one appears, and usually gets there first — but a cursor that never
  // starts leaves the whole mode inert, with no mark and every command acting
  // on nothing, so it is worth a cheap poll to be certain. It stops the instant
  // there is a cursor, because that changes the deps.
  useEffect(() => {
    if (!enabled || cursor != null) return
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || !document?.querySelector) return
      const first = document.querySelector('.task[data-task-id]')
      if (first) setCursor(Number(first.dataset.taskId))
    }, 250)
    return () => clearInterval(timer)
  }, [enabled, cursor, setCursor])

  // The cursor is drawn by a class rather than by React, because the rows
  // belong to whichever page is mounted and this has no business re-rendering
  // them on every keypress.
  //
  // Repainted on DOM changes as well as on render. A page refetching its tasks
  // replaces every row element, and this component has no reason to re-render
  // when that happens — so the mark simply disappeared after any action that
  // reloaded the list, which is most of them.
  useEffect(() => {
    const paint = () => {
      // A queued callback can outlive the document that scheduled it — closing
      // a window does not unmount React, so an observer or a timer can fire
      // into a torn-down page. A browser never sees this; a test harness that
      // opens several pages in turn sees it constantly, and the crash it
      // produces reads like a bug in whatever was being tested at the time.
      if (typeof document === 'undefined' || !document?.querySelectorAll) return

      for (const el of document.querySelectorAll(
        '.vim-on, .vim-sel, .vim-on-section, .vim-on-band, .vim-on-card',
      )) {
        el.classList.remove('vim-on', 'vim-sel', 'vim-on-section', 'vim-on-band', 'vim-on-card')
      }
      if (!enabled) return

      const ids = [...document.querySelectorAll(
        '.panel.section[data-section-id], .task[data-task-id], [data-open]',
      )].map(keyOf)

      // Adopt the first row when there is nothing to point at yet. This lives
      // here rather than in an effect of its own because this runs on renders
      // AND on DOM changes, which is exactly the two moments a first row can
      // appear — a separate observer fired inconsistently and the cursor
      // sometimes never started at all.
      if (cursor == null) {
        // The first TASK, not the first stop: opening a day on its first
        // section heading would mean a keypress before you could do anything.
        const first = document.querySelector('.task[data-task-id], [data-open]')
        if (first) setCursor(keyOf(first))
        else if (ids.length) setCursor(ids[0])
        return
      }

      // The row the cursor was on can simply leave: ticking a task folds it
      // into "N done" and it is removed from the page. Staying on an id that
      // is no longer drawn leaves no mark and gives the next command nothing
      // to act on — which is what made a colon command straight after a tick
      // look like it did nothing at all. Hold the line number, the way vim
      // does, rather than jumping back to the top.
      const here = ids.indexOf(cursor)
      if (here < 0) {
        // The row went. Something changed it — ticking, dropping, moving — so
        // a section opened only to look inside has now been worked in, and
        // should stay open.
        if (peeked.current) peeked.current.dirty = true

        // Prefer the section the row was in, if that is still on the page. It
        // usually is, and usually BECAUSE it just folded — landing on its
        // heading is both nearest to where you were and exactly where you need
        // to be to open it again. Falling back to a position in the list sent
        // the cursor into the NEXT section instead, so folding one from inside
        // left you unable to unfold it.
        const home = lastSection.current && `s${lastSection.current}`
        if (home && ids.includes(home)) { setCursor(home); return }
        if (ids.length) setCursor(ids[Math.min(lastIndex.current, ids.length - 1)])
        return
      }
      lastIndex.current = here
      lastSection.current = rowFor(cursor)?.closest('.panel.section')?.dataset.sectionId
        ?? lastSection.current

      for (const id of selection) rowFor(id)?.classList.add('vim-sel')

      const at = rowFor(cursor)
      if (isCardKey(cursor)) {
        // A card is already a panel, so it is outlined whole rather than given
        // the thin bar a row gets — the same reasoning as a section.
        at?.classList.add('vim-on-card')
      } else if (isSectionKey(cursor)) {
        // The whole section, not a line inside it: what is selected is the
        // container, and saying so with the same thin bar a row gets would
        // read as "this heading" rather than "all of this".
        at?.classList.add('vim-on-section')
      } else {
        at?.classList.add('vim-on')
        // A sub-section heading stands for its band, so the band lights with
        // it — that is the thing a yank from here would take.
        at?.closest('.subsec')?.classList.add('vim-on-band')
      }
      // Ranges point at text nodes, which a redraw replaces, so the highlight
      // has to be laid down again alongside the cursor.
      if (lastSearch.current) paintMatches(lastSearch.current)
    }
    paint()
    if (!enabled) return

    // Coalesced: a refetch mutates the tree many times in a row, and painting
    // on each one would be a class change per row per mutation.
    let queued = false
    const watch = new MutationObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => { queued = false; paint() })
    })
    watch.observe(document.body, { childList: true, subtree: true })
    return () => watch.disconnect()
  })

  if (!enabled) return null

  return (
    <>
      {/* Vim's own arrangement: what you are typing sits bottom left, and the
          half-finished command you have started sits bottom right. */}
      <div className={`vim-bar is-${mode}`} role="status">
        <span className="vim-mode">{MODE_LABEL[mode]}</span>
        {mode === 'command' || mode === 'search' ? (
          <form
            className="vim-cmd"
            onSubmit={(e) => {
              e.preventDefault()
              const line = command
              const searching = mode === 'search'
              setCommand('')
              setMode('normal')
              if (!searching) { runCommand(line); return }
              lastSearch.current = line
              const hits = matches(line)
              paintMatches(line)
              if (!hits.length) { say(`no match for "${line}"`); return }
              setCursor(hits[0])
              say(`1 of ${hits.length}`)
            }}
          >
            <span className="vim-colon">{mode === 'search' ? '/' : ':'}</span>
            <input
              ref={cmdInput}
              className="vim-cmd-input"
              value={command}
              aria-label="Command"
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); setCommand(''); setMode('normal') }
              }}
              onBlur={() => { setCommand(''); setMode('normal') }}
            />
          </form>
        ) : (
          <span className="vim-say">{flash}</span>
        )}
        <span className="spacer" />
        {/* The keys you have typed so far, bottom right, exactly where vim
            shows them — so a sequence that is waiting for its second key looks
            like it is waiting rather than like nothing happened. */}
        <span className={`vim-pending${pending ? ' is-on' : ''}`} aria-live="polite">
          {pending}
        </span>
        <button className="vim-help-btn" title="Keys and commands" onClick={() => setHelpOpen(true)}>
          <Icon name="list" size={12} /> ?
        </button>
      </div>

      {helpOpen && (
        <div className="vim-help-wrap" onClick={() => setHelpOpen(false)}>
          <div className="vim-help panel" onClick={(e) => e.stopPropagation()}>
            <header className="panel-h">
              Keys and commands
              <span className="spacer" />
              <button className="btn ghost sm" onClick={() => setHelpOpen(false)}>
                <Icon name="x" size={13} />
              </button>
            </header>
            <div className="vim-help-b">
              {HELP.map(([group, pairs]) => (
                <section key={group}>
                  <h4>{group}</h4>
                  <dl>
                    {pairs.map(([keys, what]) => (
                      <div key={keys}>
                        <dt>{keys}</dt>
                        <dd>{what}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const MODE_LABEL = {
  normal: 'NORMAL', insert: 'INSERT', visual: 'VISUAL', command: 'COMMAND', search: 'SEARCH',
}

function typing() {
  const el = document.activeElement
  if (!el) return false
  if (el.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}
