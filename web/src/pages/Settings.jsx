import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Empty, Field, Panel } from '../components/ui.jsx'
import { HELP } from '../components/VimLayer.jsx'
import AiSwitches from '../components/AiSwitches.jsx'
import { BUILT_IN } from '../lib/aiSwitches.js'
import { useVim } from '../lib/vim.jsx'
import { api, useApi } from '../lib/api.js'
import { minutesLabel } from '../lib/dates.js'
import '../styles/settings.css'
import { usePageTitle } from '../lib/title.js'

const THEMES = [['light', 'Light'], ['dark', 'Night'], ['system', 'Auto']]

// Literal colours by necessity — a swatch has to show the accent it sets, and
// these are the source values the --accent variables are built from.
const ACCENTS = [
  ['blue', '#4a63d8'],
  ['teal', '#0f7d8c'],
  // Warm schemes move the neutrals too, so they change the feel of the whole
  // page rather than just the highlight colour.
  ['clay', '#b4552f'],
  ['olive', '#6b7f39'],
  ['rose', '#a8456a'],
  ['green', '#12805c'],
  ['purple', '#5b4fd0'],
]

// Settings edited by a control above; the raw dump would only repeat them.
const HANDLED = [
  'deep_capacity_min', 'column_labels', 'page_names', 'ai_switch_defaults', 'ai_prompt',
  'pomodoro_work', 'pomodoro_short', 'pomodoro_long', 'pomodoro_before_long',
]

/** Minutes in, "5h 30m" out, so a target can be typed in either. */
function parseDuration(text) {
  const raw = String(text).trim().toLowerCase()
  if (/^\d+$/.test(raw)) return Number(raw)
  const h = /(\d+(?:\.\d+)?)\s*h/.exec(raw)
  const m = /(\d+)\s*m/.exec(raw)
  if (!h && !m) return null
  return Math.round((h ? parseFloat(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0))
}

export default function Settings({ theme, onTheme, accent, onAccent }) {
  usePageTitle('Settings')
  const settings = useApi('/settings')
  const [saved, setSaved] = useState('')
  // The raw dump is a debugging aid, not part of the page.
  const [showRaw, setShowRaw] = useState(false)

  if (!settings.data) return <div className="page"><p className="muted">Loading…</p></div>

  const s = settings.data

  async function save(key, value) {
    await api.patch('/settings', { [key]: String(value) })
    settings.reload()
    setSaved(key)
    setTimeout(() => setSaved((k) => (k === key ? '' : k)), 1600)
  }

  const columnLabels = (() => {
    try {
      const parsed = JSON.parse(s.column_labels || '[]')
      return parsed.length === 3 ? parsed : ['Quick', 'Focused', 'Deep']
    } catch { return ['Quick', 'Focused', 'Deep'] }
  })()

  // daily_capacity_min is still stored and still drives the day bar; it is just
  // no longer edited here, so it falls through to the raw list.
  const rest = Object.entries(s).filter(([k]) => !HANDLED.includes(k))

  return (
    <>
      <header className="topbar">
        <h1>Settings</h1>
        <span className="spacer" />
        {saved && <span className="chip c-green">saved</span>}
      </header>

      <div className="page st-page">
        <div className="st-stack">
          <Panel title={<><Icon name="clock" size={14} /> Pomodoro</>}>
            <p className="st-note">
              How long each phase of the timer in the sidebar runs, in minutes,
              and how many work blocks go by before the long break.
            </p>

            <div className="st-pomo">
              {[
                ['pomodoro_work', 'Work', 30],
                ['pomodoro_short', 'Short break', 5],
                ['pomodoro_long', 'Long break', 20],
                ['pomodoro_before_long', 'Blocks before a long break', 4],
              ].map(([key, label, fallback]) => (
                <label key={key} className="st-pomo-row">
                  <span>{label}</span>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={s[key] ?? fallback}
                    onChange={(e) => save(key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </Panel>

          <Panel title={<><Icon name="clock" size={14} /> Deep work target</>}>
            <p className="st-note">
              Minutes of deep work you are aiming at each day. Only tasks marked deep
              count — routines and admin never do. Type minutes or something like{' '}
              <code>3h 30m</code>. Set it to 0 to hide the gauge.
            </p>

            <div className="st-target">
              <DurationField
                label="Deep work"
                value={Number(s.deep_capacity_min ?? 240)}
                onSave={(v) => save('deep_capacity_min', v)}
              />
            </div>

            <p className="st-cite">
              <strong>Where 240 came from.</strong> It is borrowed from the general
              deliberate-practice literature, which reports something like a four-hour
              daily ceiling on sustained, cognitively demanding work. Nothing in this
              project has checked that figure, and no measurement of your own days went
              into it — treat it as a starting point rather than a finding, and move it
              until it matches the days you would call good.
            </p>
          </Panel>

          <Panel title={<><Icon name="columns" size={14} /> Column names</>}>
            <p className="st-note">
              The three buckets a section uses in its column layout.
            </p>
            <div className="row">
              {columnLabels.map((label, i) => (
                <input
                  key={i}
                  className="input"
                  defaultValue={label}
                  onBlur={(e) => {
                    const next = [...columnLabels]
                    next[i] = e.target.value.trim() || label
                    if (next[i] !== label) save('column_labels', JSON.stringify(next))
                  }}
                />
              ))}
            </div>
          </Panel>

          <Panel title={<><Icon name="moon" size={14} /> Appearance</>}>
            <div className="st-appearance">
              <Field label="Theme">
                <div className="st-themes">
                  {THEMES.map(([value, label]) => (
                    <button
                      key={value}
                      className={`btn sm ${theme === value ? 'is-on' : ''}`}
                      aria-pressed={theme === value}
                      onClick={() => onTheme(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="st-hint">
                  Auto follows the operating system as it changes.
                </span>
              </Field>

              <Field label="Accent">
                <div className="st-accents">
                  {ACCENTS.map(([name, hex]) => (
                    <button
                      key={name}
                      className="st-accent"
                      style={{ background: hex }}
                      aria-label={`${name} accent`}
                      aria-pressed={accent === name}
                      onClick={() => onAccent(name)}
                    />
                  ))}
                </div>
                <span className="st-hint">Tints the sidebar, links and controls.</span>
              </Field>
            </div>
          </Panel>

          {/* The bottom layer of the four. A conversation overrides these, and
              a task overrides its conversation. */}
          <Panel title="AI defaults">
            <p className="st-hint">
              How a task in an AI conversation is worked unless it, or the conversation
              it is in, says otherwise. Hover any option for what it means.
            </p>
            <AiSwitches
              label="Default terms for every AI task"
              value={s.ai_switch_defaults}
              inherited={BUILT_IN}
              onChange={(v) => save('ai_switch_defaults', v)}
            />

            {/* Standing instructions, under every conversation's and every
                task's. These stack rather than being overridden — what is set
                here always applies. */}
            <Field label="Standing instructions">
              <textarea
                className="input st-prompt"
                rows={4}
                defaultValue={s.ai_prompt || ''}
                placeholder="What you want said to the AI about every task — conventions to follow, things not to touch."
                onBlur={(e) => {
                  const next = e.target.value.trim()
                  if (next !== (s.ai_prompt || '')) save('ai_prompt', next)
                }}
              />
              <span className="st-hint">
                Handed to the agent with every AI task, above the conversation's instructions
                and the task's own. All three apply.
              </span>
            </Field>
          </Panel>

          <PageNames names={s.page_names} onSave={(v) => save('page_names', v)} />

          <Keys />

          <button className="btn ghost sm st-raw-toggle" onClick={() => setShowRaw(!showRaw)}>
            <Icon name={showRaw ? 'chevronDown' : 'right'} size={12} />
            {showRaw ? 'Hide' : 'Show'} everything else
          </button>

          {showRaw && (
            <Panel title="Everything else">
              {rest.map(([k, v]) => (
                <div key={k} className="kv st-raw-row">
                  <dt>{k}</dt>
                  <dd className="muted st-raw-val">
                    {String(v).length > 90 ? `${String(v).slice(0, 90)}…` : String(v)}
                  </dd>
                </div>
              ))}
              {rest.length === 0 && <Empty>Nothing else stored yet.</Empty>}
            </Panel>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * Nicknames for pages.
 *
 * The same list `:goto` reads. Editable here because a name you set months ago
 * from the command line is otherwise something you can only discover by
 * guessing it, and a nickname you cannot remember is no use at all.
 */
function PageNames({ names, onSave }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')

  const list = (() => {
    try {
      const parsed = JSON.parse(names || '{}')
      return parsed && typeof parsed === 'object' ? Object.entries(parsed) : []
    } catch { return [] }
  })()

  const write = (pairs) => onSave(JSON.stringify(Object.fromEntries(pairs)))

  function add() {
    const n = name.trim().toLowerCase()
    let p = path.trim()
    if (!n || !p) return
    if (!p.startsWith('/')) p = `/${p}`
    write([...list.filter(([k]) => k !== n), [n, p]])
    setName('')
    setPath('')
  }

  return (
    <Panel title="Page names">
      <p className="st-hint">
        A word for a page you keep coming back to. In vim mode, <code>:goto thesis</code> goes
        there, and <code>:namepage thesis</code> names whatever page you are on.
      </p>
      {list.length === 0 && <Empty>No pages have names yet.</Empty>}
      {list.map(([n, p]) => (
        <div key={n} className="kv st-raw-row">
          <dt><code>{n}</code></dt>
          <dd className="muted st-raw-val">
            <Link to={p}>{p}</Link>
            <button
              className="btn ghost sm danger"
              aria-label={`Forget ${n}`}
              onClick={() => write(list.filter(([k]) => k !== n))}
            >
              <Icon name="trash" size={12} />
            </button>
          </dd>
        </div>
      ))}
      <div className="row st-name-add">
        <input
          className="input"
          placeholder="thesis"
          aria-label="Page name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <input
          className="input"
          placeholder="/projects/17"
          aria-label="Page address"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button className="btn" onClick={add} disabled={!name.trim() || !path.trim()}>Add</button>
      </div>
    </Panel>
  )
}

function DurationField({ label, value, onSave }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  function commit() {
    if (!draft.trim()) return
    const mins = parseDuration(draft)
    if (mins === null) { setError("Try 240, 4h, or 3h 30m"); return }
    setError('')
    setDraft('')
    onSave(Math.max(0, mins))
  }

  return (
    <Field label={label}>
      <div className="row">
        <input
          className="input"
          placeholder={value ? minutesLabel(value) : 'off'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        />
        <span className="chip is-deep">{value ? minutesLabel(value) : 'off'}</span>
      </div>
      {error && <span className="st-hint st-error">{error}</span>}
    </Field>
  )
}

/**
 * Every key and gesture the app answers to, in one place.
 *
 * The mouse gestures are here because they are as invisible as a keystroke —
 * nothing on screen says that right-clicking a checkbox makes a task optional —
 * and a list of shortcuts that covered only the keyboard would leave out the
 * ones people actually fail to find.
 *
 * The vim table is imported from the layer that implements it, so a key cannot
 * be documented here and bound differently there.
 */
function Keys() {
  const vim = useVim()

  const GENERAL = [
    ['Everywhere', [
      ['Ctrl / \u2318 + /', 'search everything'],
      ['Ctrl / \u2318 + K', 'the same, unless you are in a text box'],
      ['Ctrl / \u2318 + Z', 'undo'],
      ['Ctrl / \u2318 + Shift + Z', 'redo'],
      ['Ctrl + Alt + V', 'turn keyboard control on or off'],
      ['Escape', 'close a menu, or leave a field'],
    ]],
    ['Going places', [
      ['g then d / w / m / n', 'day, week, month, notes — keeping the date'],
      ['g then a / p / e', 'all tasks, projects, people'],
      ['g then r / u / b', 'routines, uploads, notebook'],
      ['g then h / s', 'the dashboard, settings'],
      ['t', 'jump to today'],
      ['?', 'the shortcut list'],
    ]],
    ['On a day', [
      ['\u2190 / \u2192', 'the day before / after'],
      ['Ctrl-click the arrows', 'open that day in a new tab'],
    ]],
    ['While writing', [
      ['Ctrl / \u2318 + K', 'make a hyperlink'],
      ['Ctrl / \u2318 + J', 'hop between a link\u2019s text and its url'],
      ['Ctrl / \u2318 + B  /  I', 'bold, italic'],
      ['Ctrl / \u2318 + Enter', 'save and close the editor'],
      ['[[', 'link a day, project or task'],
    ]],
    ['On a task', [
      ['click the checkbox', 'done / not done'],
      ['right-click the checkbox', 'optional / committed'],
      ['shift-click the checkbox', 'drop / undrop'],
      ['Tab in the title', 'jump to the timing panel'],
      ['Enter', 'commit an edit and close the menu'],
      ['drag the middle of a row', 'nest it under that row'],
      ['drag near a row\u2019s edge', 'reorder it there'],
    ]],
  ]

  return (
    <Panel title={<><Icon name="list" size={14} /> Keys and gestures</>}>
      <div className="st-keys">
        {GENERAL.map(([group, pairs]) => (
          <section key={group}>
            <h4>{group}</h4>
            <dl>
              {pairs.map(([keys, what]) => (
                <div key={keys}><dt>{keys}</dt><dd>{what}</dd></div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <div className="st-vim-head">
        <label className="st-vim-toggle">
          <input
            type="checkbox"
            checked={!!vim?.enabled}
            onChange={(e) => vim?.toggle(e.target.checked)}
          />
          <span>
            <strong>Keyboard control</strong>
            <span className="st-hint">
              hjkl to move between tasks, one key per action, <code>:</code> for commands.
              While it is on it takes over the single letters above — <code>j</code> moves down the
              list rather than on to tomorrow. Ctrl-Alt-V toggles it anywhere; <code>:q</code>
              turns it off from inside.
            </span>
          </span>
        </label>
      </div>

      {vim?.enabled && (
        <div className="st-keys">
          {HELP.map(([group, pairs]) => (
            <section key={group}>
              <h4>{group}</h4>
              <dl>
                {pairs.map(([keys, what]) => (
                  <div key={keys}><dt>{keys}</dt><dd>{what}</dd></div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </Panel>
  )
}
