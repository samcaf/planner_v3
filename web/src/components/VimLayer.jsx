import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useVim, parseDuration, parseWhen, yankText, yankMarkdown, columnOf, idsIn,
} from '../lib/vim.jsx'
import { GO_TO } from '../lib/nav.js'
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
    ['j / k', 'next / previous task (3j for three)'],
    ['h / l', 'the box to the left / right'],
    ['gg / G', 'first / last task'],
    ['Ctrl-d / Ctrl-u', 'half a screen down / up'],
    ['\u2190 / \u2192', 'the day before / after'],
    ['g then a / p / e', 'all tasks, projects, people'],
    ['g then r / u / n / h', 'routines, uploads, notebook, dashboard'],
  ]],
  ['Changing', [
    ['Space or x', 'done / not done'],
    ['t', 'optional / committed'],
    ['dd', 'drop'],
    ['DD', 'delete (undoable)'],
    ['J / K', 'move the task itself down / up'],
    ['o / O', 'new task below / above'],
    ['> / <', 'move to tomorrow / yesterday'],
    ['Enter or i', 'edit the title'],
    ['za', 'fold / unfold what is under it'],
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
    ['yt', 'as markdown, with its section and metadata'],
    ['p / P', 'paste below / above the cursor'],
    ['"a', 'use register a for the next yank or paste'],
  ]],
  ['Elsewhere', [
    ['zp', 'start or pause the pomodoro'],
    ['?', 'this list'],
    [':', 'command line'],
  ]],
  ['Commands', [
    [':done  :drop  :opt', 'change the task under the cursor'],
    [':note', 'write or edit its note'],
    [':t 90   :t 1h30m', 'set its estimate'],
    [':mv tomorrow  :mv +3  :mv 2026-09-01', 'move it'],
    [':cp <when>', 'copy it to a day'],
    [':y   :yt', 'yank as text / as markdown'],
    [':pomo', 'start or pause the pomodoro'],
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
  const {
    enabled, toggle, mode, setMode, cursor, setCursor, selection, move,
    pending, setPending, command, setCommand, flash, say,
    actions, registers, register, helpOpen, setHelpOpen, setAnchor,
  } = vim

  const rowFor = (id) => document.querySelector(`.task[data-task-id="${id}"]`)
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

  /** The rows a yank should take, in the order they are drawn. */
  const yankRows = () => {
    const a = actions.current || {}
    if (!a.taskById) return []
    return selection.map((id) => a.taskById(id)).filter(Boolean)
  }

  const putInRegister = async (text, what) => {
    registers.current[register.current] = text
    register.current = '"'
    // The clipboard too, or a yank is only useful inside this app.
    try { await navigator.clipboard?.writeText(text) } catch { /* no permission */ }
    say(`yanked ${what}`)
    setMode('normal')
    setAnchor(null)
    grain.current = 'text'
    clearText()
  }

  /** Everything a command or a key can ask for, in one place. */
  const run = async (what, arg) => {
    const a = actions.current || {}
    const ids = selection
    const id = cursor
    if (id == null && what !== 'pomodoro') { say('no task under the cursor'); return }

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
      case 'delete':
        if (!a.remove) { say('nothing here can delete a task'); return }
        for (const t of ids) await a.remove(t)
        break
      case 'edit':
        click(ctrl(id, '.task-title'))
        setMode('insert')
        break
      case 'fold': {
        const twist = ctrl(id, '.task-twist[aria-expanded]')
        if (twist) click(twist); else say('nothing under this to fold')
        break
      }
      case 'column': {
        // Sideways through the three boxes, keeping roughly the same depth
        // down the column so it feels like moving across a grid.
        const at = columnOf(id)
        if (!at) { say('this view has no columns'); return }
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
          await putInRegister(picked, picked.length === 1 ? '1 character' : `${picked.length} characters`)
          return
        }
        const rowsOut = yankRows()
        if (!rowsOut.length) { say('nothing here to yank from'); return }
        await putInRegister(
          yankText(rowsOut),
          `${rowsOut.length} ${rowsOut.length === 1 ? 'task' : 'tasks'}`,
        )
        break
      }
      case 'yankMarkdown': {
        const rowsOut = yankRows()
        if (!rowsOut.length) { say('nothing here to yank from'); return }
        await putInRegister(
          yankMarkdown(rowsOut, { sectionName: a.sectionName }),
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
        const held = registers.current[register.current] || []
        register.current = '"'
        if (!held.length) { say('register is empty'); return }
        if (!a.addNear) { say('nothing here can add a task'); return }
        for (const row of held) await a.addNear(id, row, arg === 'above' ? 'above' : 'below')
        say(`pasted ${held.length}`)
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
        if (mode === 'command') { setCommand(''); setMode('normal'); return }
        if (typing()) { document.activeElement.blur(); setMode('normal'); return }
        setMode('normal'); setAnchor(null); seq.current = ''; setPending('')
        return
      }

      // While the caret is in a field, the field owns every other key.
      if (typing() || mode === 'insert' || mode === 'command') return
      // Leave the app's own chords alone: Ctrl-Z, Ctrl-K and the rest. The three
      // named here are ours — half a screen down, half a screen up, and redo —
      // and leaving `r` out of this list is why Ctrl-r never reached its binding.
      const MINE = ['d', 'u', 'r']
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
        if (to) { e.preventDefault(); e.stopPropagation(); navigate(to) }
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
      if (['g', 'd', 'D', '"'].includes(k)) {
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
      if (k === 'j') return go(() => { coarsen(); move('down', N) })
      if (k === 'k') return go(() => { coarsen(); move('up', N) })
      if (k === 'G') return go(() => move('last'))
      if (k === 'h') return go(() => run('column', 'left'))
      if (k === 'l') return go(() => run('column', 'right'))
      if (k === 'J') return go(() => { coarsen(); run('shift', 'down') })
      if (k === 'K') return go(() => { coarsen(); run('shift', 'up') })
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
      if (k === ' ' || k === 'x') return go(() => run('done'))
      if (k === 't') return go(() => run('optional'))
      if (k === 'o') return go(() => run('new', 'below'))
      if (k === 'O') return go(() => run('new', 'above'))
      if (k === '>') return go(() => run('move', 'tomorrow'))
      if (k === '<') return go(() => run('move', 'yesterday'))
      if (k === 'i' || k === 'Enter') return go(() => run('edit'))
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

  // Belt to the observer's braces. The repaint below adopts the first row the
  // moment one appears, and usually gets there first — but a cursor that never
  // starts leaves the whole mode inert, with no mark and every command acting
  // on nothing, so it is worth a cheap poll to be certain. It stops the instant
  // there is a cursor, because that changes the deps.
  useEffect(() => {
    if (!enabled || cursor != null) return
    const timer = setInterval(() => {
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
      for (const el of document.querySelectorAll('.task.vim-on, .task.vim-sel')) {
        el.classList.remove('vim-on', 'vim-sel')
      }
      if (!enabled) return

      const ids = [...document.querySelectorAll('.task[data-task-id]')]
        .map((el) => Number(el.dataset.taskId))

      // Adopt the first row when there is nothing to point at yet. This lives
      // here rather than in an effect of its own because this runs on renders
      // AND on DOM changes, which is exactly the two moments a first row can
      // appear — a separate observer fired inconsistently and the cursor
      // sometimes never started at all.
      if (cursor == null) {
        if (ids.length) setCursor(ids[0])
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
        if (ids.length) setCursor(ids[Math.min(lastIndex.current, ids.length - 1)])
        return
      }
      lastIndex.current = here

      for (const id of selection) rowFor(id)?.classList.add('vim-sel')
      rowFor(cursor)?.classList.add('vim-on')
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
        {mode === 'command' ? (
          <form
            className="vim-cmd"
            onSubmit={(e) => {
              e.preventDefault()
              const line = command
              setCommand('')
              setMode('normal')
              runCommand(line)
            }}
          >
            <span className="vim-colon">:</span>
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

const MODE_LABEL = { normal: 'NORMAL', insert: 'INSERT', visual: 'VISUAL', command: 'COMMAND' }

function typing() {
  const el = document.activeElement
  if (!el) return false
  if (el.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}
