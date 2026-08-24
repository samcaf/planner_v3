import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { marked } from 'marked'
import katex from 'katex'
import DOMPurify from 'dompurify'
import Icon from '../components/Icon.jsx'
import { api } from './api.js'
import { addDays, today } from './dates.js'

marked.setOptions({ gfm: true, breaks: true })

// Outbound links should not hijack the current tab. Internal ones are the app
// itself, so they must stay in it — the router handles them on click.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const href = node.tagName === 'A' ? node.getAttribute('href') : null
  if (!href || href.startsWith('/') || href.startsWith('#')) return
  node.setAttribute('target', '_blank')
  node.setAttribute('rel', 'noopener noreferrer')
})

const ISO = /^\d{4}-\d{2}-\d{2}$/

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ESCAPE[c])

/**
 * `[[…]]` points at a day, a project or a task. Turning a project name or a
 * task id into a route needs data this render has no access to, so the link
 * targets /go/* and the resolver route does the lookup on click.
 */
function wikiLink(target, label) {
  const [, kind, rest] = /^(?:(day|project|task):)?([\s\S]*)$/.exec(target) || []
  const value = (rest || '').trim()
  // Without a label the value reads better than the raw target, since the
  // `kind:` prefix is syntax rather than something worth showing.
  const text = (label || (kind === 'task' ? `Task ${value}` : value)).trim()
  if (!value) return null
  if (kind === 'project') return { kind: 'project', href: `/go/project/${encodeURIComponent(value)}`, text }
  if (kind === 'task') return { kind: 'task', href: `/go/task/${encodeURIComponent(value)}`, text }
  if (kind === 'day' || ISO.test(value)) return { kind: 'day', href: `/go/day/${encodeURIComponent(value)}`, text }
  // Anything else is not a link the app can resolve, so it stays as prose.
  return null
}

function extractWiki(src) {
  const links = []
  const text = src.replace(/\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g, (whole, target, label) => {
    const link = wikiLink(target, label)
    if (!link) return whole
    links.push(link)
    return `@@WIKI${links.length - 1}@@`
  })
  return { text, links }
}

function restoreWiki(html, links) {
  return html.replace(/@@WIKI(\d+)@@/g, (_, i) => {
    const { kind, href, text } = links[Number(i)]
    return `<a class="nt-wiki nt-wiki-${kind}" href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
  })
}

/**
 * Math is pulled out before markdown runs and stitched back in afterwards.
 * Without this, markdown eats the LaTeX: `a_1` becomes emphasis, `\\` collapses,
 * and `*` inside an expression turns into a bullet.
 */
function extractMath(src) {
  const math = []
  const stash = (tex, display) => {
    math.push({ tex, display })
    return ` @@MATH${math.length - 1}@@ `
  }

  const text = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => stash(tex, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => stash(tex, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => stash(tex, false))
    // Single $…$ must stay on one line, so prose like "$5 … $10" is left alone.
    .replace(/\$([^$\n]+?)\$/g, (_, tex) => stash(tex, false))

  return { text, math }
}

function restoreMath(html, math) {
  return html.replace(/@@MATH(\d+)@@/g, (_, i) => {
    const { tex, display } = math[Number(i)]
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false })
    } catch {
      return `<code class="math-error">${tex}</code>`
    }
  })
}

function toHtml(src, inline) {
  if (!src) return ''
  // Wiki links come out first: their brackets would otherwise be read as a
  // markdown reference link and their contents mangled.
  const wiki = extractWiki(src)
  const { text, math } = extractMath(wiki.text)
  const parsed = inline ? marked.parseInline(text) : marked.parse(text)
  return DOMPurify.sanitize(restoreWiki(restoreMath(parsed, math), wiki.links), {
    ADD_TAGS: ['math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub'],
  })
}

/**
 * Send one file to the server and get back the record to link it by. The
 * original name goes with it: the stored name is a content hash, so this is the
 * only chance to record what the file was actually called.
 */
export async function attach(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, filename: file.name }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'upload failed')
  return res.json()
}

/**
 * How an upload reads in a note. An image is worth showing in place; a .zip has
 * nothing to show, so it is a link and its name is the only useful label.
 */
export function markdownFor(file) {
  const label = file.filename || 'file'
  return String(file.mime || '').startsWith('image/')
    ? `![${label.replace(/\.[^.]+$/, '')}](${file.url})`
    : `[${label}](${file.url})`
}

/* ------------------------------------------------------- selection edits */

/** Strip whatever block marker a line carries, keeping its indentation. */
function bare(line) {
  return line.replace(/^(\s*)(?:[-*+] \[[ xX]\]|[-*+]|\d+\.|#{1,6}|>)\s+/, '$1')
}

/** Wrap the selection, or unwrap it when the marks are already there. */
function wrap(text, from, to, mark, placeholder) {
  const inner = text.slice(from, to) || placeholder
  const wrapped = text.slice(from - mark.length, from) === mark
    && text.slice(to, to + mark.length) === mark

  if (wrapped) {
    return {
      text: text.slice(0, from - mark.length) + text.slice(from, to) + text.slice(to + mark.length),
      start: from - mark.length,
      end: to - mark.length,
    }
  }
  return {
    text: `${text.slice(0, from)}${mark}${inner}${mark}${text.slice(to)}`,
    start: from + mark.length,
    end: from + mark.length + inner.length,
  }
}

/**
 * Put a line marker on every line the selection touches, or take it off when
 * they all already carry it — so one button both applies and undoes.
 * `mark` may be a function of the line's index, which is what numbers a list.
 */
function markLines(text, from, to, mark) {
  const at = (i) => (typeof mark === 'function' ? mark(i) : mark)
  const start = text.lastIndexOf('\n', from - 1) + 1
  const stop = text.indexOf('\n', to)
  const end = stop === -1 ? text.length : stop
  const lines = text.slice(start, end).split('\n')

  const rewrite = (line, i) => {
    const [, indent, body] = /^(\s*)([\s\S]*)$/.exec(bare(line))
    return { on: `${indent}${at(i)}${body}`, off: `${indent}${body}` }
  }
  // Comparing against the rewritten line, rather than testing for the marker,
  // is what makes the bullet button turn a checklist into a bullet list instead
  // of stripping it: only an exact match counts as "already this marker".
  const filled = lines.filter((l) => l.trim())
  const already = filled.length > 0
    && lines.every((l, i) => !l.trim() || rewrite(l, i).on === l)

  const next = lines.map((line, i) => {
    if (!line.trim()) return line
    const { on, off } = rewrite(line, i)
    return already ? off : on
  }).join('\n')

  return { text: text.slice(0, start) + next + text.slice(end), start, end: start + next.length }
}

/** #, then ##, then ###, then plain again — one button, four states. */
function heading(text, from, to) {
  const start = text.lastIndexOf('\n', from - 1) + 1
  const level = (/^\s*(#{1,6})\s/.exec(text.slice(start)) || [, ''])[1].length
  const next = level >= 3 ? 0 : level + 1
  return markLines(text, from, to, next ? `${'#'.repeat(next)} ` : '')
}

/** A fence around the selection, with the caret parked where a language goes. */
function codeBlock(text, from, to) {
  const lead = from === 0 || text[from - 1] === '\n' ? '' : '\n'
  const body = `${lead}\`\`\`\n${text.slice(from, to)}\n\`\`\`\n`
  const caret = from + lead.length + 3
  return { text: text.slice(0, from) + body + text.slice(to), start: caret, end: caret }
}

/** `[text](url)` with "url" selected, so the address can be typed straight in. */
function linkAt(text, from, to) {
  const label = text.slice(from, to) || 'text'
  const body = `[${label}](url)`
  const at = from + label.length + 3
  return { text: text.slice(0, from) + body + text.slice(to), start: at, end: at + 3 }
}

function rule(text, from, to) {
  const lead = from === 0 || text[from - 1] === '\n' ? '' : '\n'
  const body = `${lead}\n---\n\n`
  const caret = from + body.length
  return { text: text.slice(0, from) + body + text.slice(to), start: caret, end: caret }
}

const bold = (t, a, b) => wrap(t, a, b, '**', 'bold')
const italic = (t, a, b) => wrap(t, a, b, '*', 'italic')

// Ctrl/Cmd bindings inside the textarea. Deliberately no z or y: the browser's
// own undo stack has to keep working.
const SHORTCUTS = { b: bold, i: italic, k: linkAt }

const TOOL_GROUPS = [
  [
    { key: 'bold', label: 'B', title: 'Bold  ⌘B', cls: 'nt-tb-b', run: bold },
    { key: 'italic', label: 'I', title: 'Italic  ⌘I', cls: 'nt-tb-i', run: italic },
    { key: 'code', label: '</>', title: 'Inline code', cls: 'nt-tb-m', run: (t, a, b) => wrap(t, a, b, '`', 'code') },
    { key: 'fence', label: '{ }', title: 'Code block', cls: 'nt-tb-m', run: codeBlock },
  ],
  [
    { key: 'heading', label: 'H', title: 'Heading — press again for a smaller one', run: heading },
    { key: 'quote', label: '❞', title: 'Quote', run: (t, a, b) => markLines(t, a, b, '> ') },
  ],
  [
    { key: 'ul', label: '•', title: 'Bulleted list', run: (t, a, b) => markLines(t, a, b, '- ') },
    { key: 'ol', label: '1.', title: 'Numbered list', cls: 'nt-tb-m', run: (t, a, b) => markLines(t, a, b, (i) => `${i + 1}. `) },
    { key: 'todo', label: '☐', title: 'Checklist', run: (t, a, b) => markLines(t, a, b, '- [ ] ') },
  ],
  [
    { key: 'link', label: <Icon name="link" size={13} />, title: 'Link  ⌘K', run: linkAt },
    { key: 'rule', label: '―', title: 'Horizontal rule', run: rule },
  ],
]

/* ---------------------------------------------------- [[ ]] autocomplete */

// The project list is small and rarely changes, so one fetch per session keeps
// the picker instant while typing.
let projectCache = null

async function loadProjects() {
  if (!projectCache) {
    try { projectCache = await api.get('/projects') } catch { return [] }
  }
  return projectCache
}

/** A task title as plain text — the picker has no room for its markdown. */
const plainTitle = (s) => (s || '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`_]/g, '')

/** The `[[…` fragment the caret is sitting inside, or null. */
function wikiFragment(text, caret) {
  const at = text.lastIndexOf('[[', caret)
  if (at < 0) return null
  const query = text.slice(at + 2, caret)
  return /[[\]\n]/.test(query) ? null : { at, query }
}

/** What `[[` offers: days first, then projects, then matching task titles. */
async function suggestFor(query) {
  const q = query.trim()
  const lower = q.toLowerCase()

  const days = ISO.test(q)
    ? [{ insert: `day:${q}`, label: q, kind: 'day' }]
    : [
        { insert: `day:${today()}`, label: `Today · ${today()}`, kind: 'day' },
        { insert: `day:${addDays(today(), 1)}`, label: `Tomorrow · ${addDays(today(), 1)}`, kind: 'day' },
        { insert: `day:${addDays(today(), -1)}`, label: `Yesterday · ${addDays(today(), -1)}`, kind: 'day' },
      ].filter((d) => !lower || d.label.toLowerCase().includes(lower))

  const [projects, tasks] = await Promise.all([
    loadProjects(),
    // A one-letter search matches most of the database, so it is not worth a round trip.
    q.length >= 2 ? api.get(`/tasks?q=${encodeURIComponent(q)}`).catch(() => []) : [],
  ])

  return [
    ...days,
    ...projects
      .filter((p) => !lower || p.name.toLowerCase().includes(lower))
      .slice(0, 5)
      .map((p) => ({ insert: `project:${p.name}`, label: p.name, kind: 'project' })),
    // A backlog task has no day to open, so it cannot be linked to yet.
    ...tasks
      .filter((t) => t.scheduled_date)
      .slice(0, 5)
      .map((t) => ({ insert: `task:${t.id}`, label: plainTitle(t.title) || `Task ${t.id}`, kind: 'task' })),
  ]
}

/* ------------------------------------------------------------ drafts */

const DRAFT_PREFIX = 'planner:draft:'

// localStorage throws outright in a private-mode browser and when the quota is
// full. A mirrored draft is a convenience, so every access degrades to nothing
// rather than taking the editor down with it.
function readDraft(key) {
  if (!key) return null
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null')
    return typeof saved?.text === 'string' ? saved : null
  } catch { return null }
}

function writeDraft(key, text) {
  if (!key) return
  try { localStorage.setItem(key, JSON.stringify({ text, at: Date.now() })) } catch { /* not mirrored */ }
}

function clearDraft(key) {
  if (!key) return
  try { localStorage.removeItem(key) } catch { /* nothing to remove */ }
}

/** Rough age — "4 minutes ago" is all the restore strip has to convey. */
function ago(at) {
  const mins = Math.round((Date.now() - at) / 60000)
  if (!(at > 0) || mins < 1) return 'a moment ago'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/* ------------------------------------------------------------ components */

/** Read-only rendered markdown + LaTeX. */
export function Rich({ text, inline = false, className = '' }) {
  const navigate = useNavigate()
  const html = useMemo(() => toHtml(text, inline), [text, inline])
  if (!text) return null
  const Tag = inline ? 'span' : 'div'

  return (
    <Tag
      className={`rich ${className}`}
      // The markup is a string, so an internal link is a plain <a> that would
      // reload the whole app. Catching the click here keeps it in the SPA — and
      // stops the click reaching an editor that opens on click underneath.
      onClick={(e) => {
        const a = e.target.closest?.('a')
        if (!a) return
        e.stopPropagation()
        const href = a.getAttribute('href') || ''
        if (!href.startsWith('/') || e.metaKey || e.ctrlKey || e.shiftKey) return
        if (href.startsWith('/uploads/')) return   // a real file, let the browser have it
        e.preventDefault()
        navigate(href)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * A multiline editor that renders on blur and edits on click — so notes read as
 * formatted prose but are always one click from plain markdown.
 *
 * `draftKey` opts one editor into draft recovery: pass a value that identifies
 * what is being edited (`day:2026-08-20`, `task:41`) and an in-progress edit
 * survives a reload. Without it nothing is stored.
 */
export function RichEditor({
  value, onChange, placeholder = 'Notes…', rows = 6, autoFocus, draftKey, onEditing,
}) {
  const storeKey = draftKey ? `${DRAFT_PREFIX}${draftKey}` : null
  const [editing, setEditing] = useState(!!autoFocus)
  const [draft, setDraft] = useState(value || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [fragment, setFragment] = useState(null)
  const [suggest, setSuggest] = useState([])
  const [cursor, setCursor] = useState(0)
  const [recovered, setRecovered] = useState(() => readDraft(storeKey))
  const area = useRef(null)
  const picker = useRef(null)
  const caret = useRef(null)
  const pending = useRef(null)

  // Writing the draft resets the caret to the end of a controlled textarea, so
  // every transform leaves the range it wants here and it is re-applied on the
  // commit that follows. A layout effect, not rAF: it has to happen before the
  // paint, and rAF never fires while the tab is hidden.
  useLayoutEffect(() => {
    const range = caret.current
    if (!range || !area.current) return
    caret.current = null
    area.current.focus()
    area.current.setSelectionRange(range[0], range[1])
  })

  const query = fragment?.query
  useEffect(() => {
    if (query == null) { setSuggest([]); return }
    let live = true
    // Debounced, because the task search hits the database on every keystroke.
    const timer = setTimeout(() => {
      suggestFor(query).then((items) => {
        if (!live) return
        setSuggest(items)
        setCursor(0)
      })
    }, 120)
    return () => { live = false; clearTimeout(timer) }
  }, [query])

  // The text only reaches the server on blur, so a reload or a route change
  // mid-edit drops it. Mirroring the draft makes that recoverable; the write is
  // debounced because it would otherwise run on every keystroke.
  useEffect(() => {
    if (!storeKey || !editing) return
    // A draft equal to the saved text is nothing worth offering back.
    pending.current = () =>
      (draft === (value || '') ? clearDraft(storeKey) : writeDraft(storeKey, draft))
    const timer = setTimeout(() => { pending.current?.(); pending.current = null }, 400)
    return () => clearTimeout(timer)
  }, [storeKey, editing, draft, value])

  // Unmounting — a route change, say — removes the textarea without blurring
  // it, so the last debounce window has to be flushed rather than dropped.
  useEffect(() => () => pending.current?.(), [])

  /** Drop the stored draft and the strip offering it back. */
  function forget() {
    pending.current = null
    clearDraft(storeKey)
    setRecovered(null)
  }

  function commit() {
    setEditing(false)
    setFragment(null)
    onEditing?.(false)
    pending.current = null

    // Whitespace is not content. A note opened from the bar below a task holds
    // a single space so the textarea has something to bind to; comparing the
    // raw draft meant that space came back equal to itself, no change was ever
    // emitted, and a note you had opened and not written in stayed open for
    // good. Normalising first is what lets the caller see it become empty.
    const next = draft.trim() ? draft : ''
    if (next === value) { forget(); return }

    // The mirror is only dropped once the write has gone through — a save that
    // fails is exactly when the draft is worth keeping.
    Promise.resolve(onChange(next)).then(forget, () => {})
  }

  /** Put a recovered draft back in the textarea, caret at its end. */
  function restore() {
    caret.current = [recovered.text.length, recovered.text.length]
    setDraft(recovered.text)
    setEditing(true)
    setRecovered(null)
  }

  /**
   * Run a transform over the current selection and put the caret back where the
   * transform asked for it, once React has re-rendered with the new text.
   */
  function transform(fn) {
    const el = area.current
    if (!el) return
    const { selectionStart: from, selectionEnd: to } = el
    const next = fn(el.value, from, to)
    caret.current = [next.start, next.end]
    setDraft(next.text)
  }

  /** Splice markdown in at the caret, keeping the draft the source of truth. */
  function insertAtCaret(snippet) {
    transform((text, from, to) => ({
      text: text.slice(0, from) + snippet + text.slice(to),
      start: from + snippet.length,
      end: from + snippet.length,
    }))
  }

  /** Replace the `[[…` being typed with the chosen target. */
  function choose(item) {
    const body = `[[${item.insert}]]`
    transform((text, from) => {
      const tail = text.slice(from)
      // Swallow a `]]` already sitting after the caret rather than doubling it.
      const rest = tail.startsWith(']]') ? tail.slice(2) : tail
      const after = fragment.at + body.length
      return { text: text.slice(0, fragment.at) + body + rest, start: after, end: after }
    })
    setFragment(null)
  }

  async function addFiles(files) {
    const picked = [...(files || [])]
    if (!picked.length) return
    setBusy(true)
    setError(null)
    try {
      // Sequential: each file goes up as a base64 body, so uploading them at
      // once would just hold every one in memory to finish no sooner.
      for (const file of picked) insertAtCaret(`\n${markdownFor(await attach(file))}\n`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Compared against `value` on every render, not just on mount, so a draft that
  // the server has since caught up with stops being offered.
  const strip = recovered && recovered.text !== (value || '') && (
    <div className="rich-hint">
      <Icon name="clock" size={11} />
      Unsaved draft from {ago(recovered.at)}
      {/* Taking focus here would blur the textarea and commit, which is the one
          thing a recovery control must not do. */}
      <button type="button" className="btn ghost sm" onMouseDown={(e) => e.preventDefault()} onClick={restore}>
        Restore
      </button>
      <button type="button" className="btn ghost sm" onMouseDown={(e) => e.preventDefault()} onClick={forget}>
        Discard
      </button>
    </div>
  )

  if (!editing) {
    return (
      <>
        {strip}
        <div
          className={`rich-view ${value ? '' : 'is-empty'}`}
          tabIndex={0}
          role="button"
          // A link in the text is there to be followed. Without this the click
          // that would open it opens the editor instead, and the only way to
          // reach a link was to copy it out of the markdown by hand.
          onClick={(e) => { if (e.target.closest('a')) return; setDraft(value || ''); setEditing(true); onEditing?.(true) }}
          onFocus={() => { setDraft(value || ''); setEditing(true); onEditing?.(true) }}
        >
          {value ? <Rich text={value} /> : <span className="muted">{placeholder}</span>}
        </div>
      </>
    )
  }

  const open = fragment && suggest.length > 0

  return (
    <div className="rich-edit">
      {/* Inside .rich-edit, so the textarea's own blur guard treats a click on
          Restore as staying in the editor rather than as a commit. */}
      {strip}
      <div className="nt-tb">
        {TOOL_GROUPS.map((group, g) => (
          <span key={g} style={{ display: 'contents' }}>
            {g > 0 && <span className="nt-tb-sep" />}
            {group.map((tool) => (
              <button
                key={tool.key}
                type="button"
                className={`nt-tb-btn ${tool.cls || ''}`}
                title={tool.title}
                aria-label={tool.title}
                // Taking focus would blur the textarea, which commits the draft
                // and throws away the selection the transform needs.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => transform(tool.run)}
              >
                {tool.label}
              </button>
            ))}
          </span>
        ))}
      </div>

      <textarea
        ref={area}
        autoFocus
        onFocus={() => onEditing?.(true)}
        rows={rows}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value)
          setFragment(wikiFragment(e.target.value, e.target.selectionStart))
        }}
        // Clicking elsewhere in the text can only move the caret out of a
        // half-typed `[[`, so the picker closes with it.
        onClick={() => setFragment(null)}
        // A blur caused by the attach button or file dialog must not close the
        // editor, or the upload would land in a draft that no longer exists.
        onBlur={(e) => {
          if (e.relatedTarget && e.currentTarget.parentNode.contains(e.relatedTarget)) return
          if (busy) return
          commit()
        }}
        onPaste={(e) => {
          if (!e.clipboardData?.files?.length) return
          e.preventDefault()
          addFiles(e.clipboardData.files)
        }}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }}
        onDrop={(e) => {
          if (!e.dataTransfer?.files?.length) return
          e.preventDefault()
          addFiles(e.dataTransfer.files)
        }}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % suggest.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + suggest.length) % suggest.length); return }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(suggest[cursor]); return }
          }
          if (e.key === 'Escape') {
            // The picker is the innermost thing open, so it closes first.
            if (fragment) { setFragment(null); return }
            // Escape is an explicit "throw this away", so the mirror goes too —
            // a stored draft nothing offers back would just sit there.
            forget()
            setDraft(value || '')
            setEditing(false)
            return
          }
          if ((e.metaKey || e.ctrlKey) && !e.altKey && SHORTCUTS[e.key.toLowerCase()]) {
            e.preventDefault()
            transform(SHORTCUTS[e.key.toLowerCase()])
            return
          }
          // Enter inserts a newline; Cmd/Ctrl+Enter saves.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
        }}
      />

      {open && (
        <div className="nt-ac-wrap">
          <ul className="nt-ac">
            {suggest.map((item, i) => (
              <li key={`${item.kind}${item.insert}`}>
                <button
                  type="button"
                  className={`nt-ac-item ${i === cursor ? 'is-on' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(item)}
                >
                  <span className="nt-ac-kind">{item.kind}</span>
                  <span className="nt-ac-label">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* No `accept`: anything the server will store can be attached, and the
          list of what that is lives on the server, not here. */}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
      />

      <div className="rich-hint">
        <button
          type="button"
          className="btn ghost sm"
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          {busy ? 'Uploading…' : 'Attach'}
        </button>
        <code>$x^2$</code> maths · <code>[[</code> link a day or project · paste or drop a file
        <span className="spacer" />
        {error
          ? <span style={{ color: 'var(--red)' }}>{error}</span>
          : <><kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save</>}
      </div>
    </div>
  )
}

/** Single-line field that still renders links and math when not focused. */
export function RichLine({
  value, onChange, placeholder = 'Untitled', className = '', autoEdit = false,
  onEditing,
}) {
  // `autoEdit` is read once, as the initial state. A freshly created row opens
  // ready to type; later re-renders must not drag the editor back open under
  // someone who has moved on.
  const [editing, setEditing] = useState(autoEdit)
  const [draft, setDraft] = useState(value || '')

  function commit() {
    setEditing(false)
    onEditing?.(false)
    if (draft !== value) onChange(draft)
  }

  if (editing) {
    return (
      <input
        className={`rich-line-input ${className}`}
        autoFocus
        value={draft}
        placeholder={placeholder}
        // Opening the field selects the whole title, so renaming is click-and-
        // type with nothing to clear first. There is deliberately no handler on
        // the second click: once the field has focus, the browser's own caret
        // placement is what you want, and re-selecting everything made the text
        // impossible to edit in the middle.
        onFocus={(e) => { onEditing?.(true); e.target.select() }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); onEditing?.(false) }
        }}
      />
    )
  }

  return (
    <span
      className={`rich-line ${className} ${value ? '' : 'is-empty'}`}
      onClick={(e) => { if (e.target.closest('a')) return; setDraft(value || ''); setEditing(true); onEditing?.(true) }}
    >
      {value ? <Rich text={value} inline /> : <span className="muted">{placeholder}</span>}
    </span>
  )
}
