import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Empty, Field, Panel } from '../components/ui.jsx'
import { HELP } from '../components/VimLayer.jsx'
import AiSwitches from '../components/AiSwitches.jsx'
import { BUILT_IN, DECLARED, ENFORCED } from '../lib/aiSwitches.js'
import { ABOUT, CONNECT, MOVES, QUERY, QUERY_EXAMPLES, SCOPES } from '../lib/aiGuide.js'
import { GENERAL } from '../lib/shortcuts.js'
import { asUrl, normalise } from '../lib/names.js'
import { useAuth } from '../lib/auth.jsx'
import { useVim } from '../lib/vim.jsx'
import { api, useApi } from '../lib/api.js'
import { minutesLabel } from '../lib/dates.js'
import '../styles/keys.css'
import '../styles/settings.css'
import { usePageTitle } from '../lib/title.js'

/**
 * Three pages, not one column.
 *
 * The shortcuts and the AI terms are reference — long, read once, and looked up
 * again months later — while the rest of this page is half a dozen settings you
 * change and leave. Stacked together the reference buried the settings and the
 * settings hid the reference. The tab is in the address, so a link can point at
 * one and a reload comes back to it.
 */
const TABS = [
  ['general', 'General'],
  ['keys', 'Keyboard'],
  ['ai', 'AI suite'],
  ['account', 'Account'],
]

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
  'deep_capacity_min', 'column_labels', 'page_names', 'link_names',
  'ai_switch_defaults', 'ai_prompt',
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
  const [params, setParams] = useSearchParams()
  const [saved, setSaved] = useState('')
  // The raw dump is a debugging aid, not part of the page.
  const [showRaw, setShowRaw] = useState(false)

  const asked = params.get('tab')
  const tab = TABS.some(([id]) => id === asked) ? asked : 'general'

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
        <nav className="st-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              id={`st-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`st-panel-${id}`}
              className={`st-tab${tab === id ? ' is-on' : ''}`}
              // `replace` so flipping between tabs does not fill the back
              // button with a page you never left.
              onClick={() => setParams(id === 'general' ? {} : { tab: id }, { replace: true })}
            >
              {label}
            </button>
          ))}
        </nav>

        <div
          className="st-stack"
          role="tabpanel"
          id="st-panel-general"
          aria-labelledby="st-tab-general"
          hidden={tab !== 'general'}
        >
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

          <PageNames names={s.page_names} onSave={(v) => save('page_names', v)} />

          <LinkNames names={s.link_names} onSave={(v) => save('link_names', v)} />

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

        {/* Both kept mounted and hidden rather than unmounted: the vim toggle
            in one and the switch panels in the other hold state that flipping
            a tab has no business throwing away. */}
        <div
          className="st-stack"
          role="tabpanel"
          id="st-panel-keys"
          aria-labelledby="st-tab-keys"
          hidden={tab !== 'keys'}
        >
          <Keys />
        </div>

        <div
          className="st-stack"
          role="tabpanel"
          id="st-panel-ai"
          aria-labelledby="st-tab-ai"
          hidden={tab !== 'ai'}
        >
          <AiSuite s={s} save={save} />
        </div>

        {/* Mounted only when it is open: it fetches the roster, and the roster
            is the one thing on this page nobody but the owner may even see. */}
        {tab === 'account' && (
          <div
            className="st-stack"
            role="tabpanel"
            id="st-panel-account"
            aria-labelledby="st-tab-account"
          >
            <Account />
          </div>
        )}
      </div>
    </>
  )
}

/**
 * Who you are, and — if you are the owner — who else is allowed in.
 *
 * Two panels rather than one, because they answer to different people. The
 * first is about this browser and everyone has it; the second is the roster and
 * only the owner ever sees it, which is why it is fetched rather than filtered
 * on screen — an approve button nobody may press should not be drawn at all.
 */
function Account() {
  const auth = useAuth()
  const me = auth?.user
  const roster = useApi(me?.is_owner ? '/auth/users' : null)
  const [busy, setBusy] = useState('')

  const act = async (fn) => {
    setBusy('1')
    try { await fn() } finally { setBusy(''); roster.reload?.() }
  }

  return (
    <>
      <Panel title={<><Icon name="people" size={14} /> Signed in</>}>
        <div className="kv st-raw-row">
          <dt>Login</dt>
          <dd className="muted st-raw-val">
            <code>{me?.login}</code>
            {me?.is_owner && <span className="chip c-green">owner</span>}
          </dd>
        </div>
        <p className="st-hint">
          This browser stays signed in until it is signed out here or the owner
          revokes it. There is no expiry — a session you still want should not
          end because a clock ran out.
        </p>
        <button className="btn" onClick={() => auth?.signOut()}>Sign out</button>
      </Panel>

      {me?.is_owner && (
        <Panel title={<><Icon name="keyboard" size={14} /> Who can sign in</>}>
          <p className="st-note">
            Anyone on the network can ask for an account from the login page.
            Asking creates it with a password already set, waiting on you — so
            approving is a click rather than an exchange of passwords.
          </p>
          {!roster.data && <Empty>Loading…</Empty>}
          {roster.data?.map((u) => (
            <div key={u.id} className="st-account">
              <div className="st-account-h">
                <code>{u.login}</code>
                {u.name && <span className="muted">{u.name}</span>}
                <span className={`chip ${u.status === 'active' ? 'c-green' : u.status === 'pending' ? 'c-amber' : 'c-red'}`}>
                  {u.status}
                </span>
                {!!u.is_owner && <span className="chip">owner</span>}
                <span className="spacer" />
                {u.status !== 'active' && (
                  <button
                    className="btn sm"
                    disabled={!!busy}
                    onClick={() => act(() => api.post(`/auth/users/${u.id}/approve`))}
                  >
                    Approve
                  </button>
                )}
                {u.status === 'active' && !u.is_owner && (
                  <button
                    className="btn ghost sm"
                    disabled={!!busy}
                    onClick={() => act(() => api.post(`/auth/users/${u.id}/block`))}
                  >
                    Block
                  </button>
                )}
                {!u.is_owner && (
                  <button
                    className="btn ghost sm danger"
                    aria-label={`Remove ${u.login}`}
                    disabled={!!busy}
                    // Their planner file is left where it is. Taking away
                    // access and deleting somebody's work are different acts.
                    onClick={() => act(() => api.del(`/auth/users/${u.id}`))}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                )}
              </div>
              {u.sessions?.length > 0 && (
                <dl className="st-devices">
                  {u.sessions.map((sn) => (
                    <div key={sn.token_hash}>
                      <dt>{deviceName(sn.device)}</dt>
                      <dd>
                        last used {sn.last_seen}
                        <button
                          className="btn ghost sm"
                          disabled={!!busy}
                          onClick={() => act(() => api.del(`/auth/sessions/${sn.token_hash}`))}
                        >
                          Sign it out
                        </button>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </Panel>
      )}
    </>
  )
}

/**
 * A user-agent string, as something you could recognise a device by.
 *
 * Not a parse — those are famously unwinnable. It looks for the handful of
 * names that tell one of YOUR devices from another, which is all this list has
 * to do, and falls back to saying it does not know.
 */
function deviceName(ua = '') {
  const bits = []
  if (/iPhone/i.test(ua)) bits.push('iPhone')
  else if (/iPad/i.test(ua)) bits.push('iPad')
  else if (/Android/i.test(ua)) bits.push('Android')
  else if (/Macintosh/i.test(ua)) bits.push('Mac')
  else if (/Windows/i.test(ua)) bits.push('Windows')
  else if (/Linux/i.test(ua)) bits.push('Linux')
  if (/Firefox/i.test(ua)) bits.push('Firefox')
  else if (/Edg\//i.test(ua)) bits.push('Edge')
  else if (/Chrome/i.test(ua)) bits.push('Chrome')
  else if (/Safari/i.test(ua)) bits.push('Safari')
  return bits.join(' · ') || 'an unnamed device'
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

/**
 * Nicknames for URLs.
 *
 * The same list `[[link:…]]` and `:goto` read. A page name points at somewhere
 * in this app and can be set from the page itself, so it barely needs a form;
 * a URL has to be typed in from wherever you copied it, which makes this the
 * place most of them get made.
 *
 * The nickname is what goes in the note, never the address — so re-pointing one
 * here re-points every link already written to it, which is the difference
 * between a nickname and a pasted URL.
 */
function LinkNames({ names, onSave }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  const list = (() => {
    try {
      const parsed = JSON.parse(names || '{}')
      return parsed && typeof parsed === 'object' ? Object.entries(parsed) : []
    } catch { return [] }
  })()

  const write = (pairs) => onSave(JSON.stringify(Object.fromEntries(pairs)))

  function add() {
    const n = normalise(name)
    const to = asUrl(url)
    if (!n) return
    if (!to) { setError('That does not look like a URL.'); return }
    setError('')
    write([...list.filter(([k]) => k !== n), [n, to]])
    setName('')
    setUrl('')
  }

  return (
    <Panel title={<><Icon name="link" size={14} /> Link names</>}>
      <p className="st-hint">
        A word for a URL you keep going back to. Type <code>[[</code> in any note
        or task title and pick it, or write <code>[[link:docs]]</code> outright;
        it opens in a new tab. <code>:goto docs</code> opens it from anywhere.
      </p>
      {list.length === 0 && <Empty>No URLs have names yet.</Empty>}
      {list.map(([n, to]) => (
        <div key={n} className="kv st-raw-row">
          <dt><code>{n}</code></dt>
          <dd className="muted st-raw-val">
            {/* The real address, not the /go/ route: this is the one place you
                are checking what a nickname actually stands for. */}
            <a href={to} target="_blank" rel="noopener noreferrer">{to}</a>
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
          placeholder="docs"
          aria-label="Link name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <input
          className="input"
          placeholder="https://example.com/handbook"
          aria-label="URL"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button className="btn" onClick={add} disabled={!name.trim() || !url.trim()}>Add</button>
      </div>
      {error && <span className="st-hint st-error">{error}</span>}
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
 * The tables are imported, never written here: the general one from
 * `lib/shortcuts.js`, which the `?` sheet also draws, and the keyboard-control
 * one from the layer that binds it. A key cannot be documented on this page and
 * bound differently somewhere else, because this page has no copy of its own.
 */
function Keys() {
  const vim = useVim()

  return (
    <>
      <Panel title={<><Icon name="list" size={14} /> Keys and gestures</>}>
        <p className="st-note">
          What the app answers to with keyboard control off. The mouse gestures are
          here because they are as invisible as a keystroke — nothing on screen says
          that right-clicking a checkbox makes a task optional.
        </p>
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
      </Panel>

      <Panel title={<><Icon name="keyboard" size={14} /> Keyboard control</>}>
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
              While it is on, a bare letter acts on the task under the cursor —{' '}
              <code>x</code> ticks it off, <code>t</code> makes it optional — so it has the
              keyboard. Everything under <code>g</code> goes to the same place either way,
              which is why every destination lives there. Ctrl-Alt-V toggles it anywhere;{' '}
              <code>:q</code> turns it off from inside.
            </span>
          </span>
        </label>

        {/* Shown whether or not it is on. A list of keys you cannot read until
            you have turned the mode on is no use for deciding whether to. */}
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
      </Panel>
    </>
  )
}

/**
 * What the AI suite is and how to work it.
 *
 * The switch tables are generated from `lib/aiSwitches.js` — the same module
 * the row panels and the resolver read — so a switch added there appears here
 * with its own explanation, and one whose meaning changes cannot go on being
 * described the old way. The prose around them is in `lib/aiGuide.js`.
 */
function AiSuite({ s, save }) {
  return (
    <>
      {/* The bottom layer of the four. A conversation overrides these, and a
          task overrides its conversation. */}
      <Panel title={<><Icon name="sparkle" size={14} /> Your defaults</>}>
        <p className="st-note">
          How a task in an AI conversation is worked unless it, or the conversation
          it is in, says otherwise. Hover any option for what it means.
        </p>
        <AiSwitches
          label="Default terms for every AI task"
          value={s.ai_switch_defaults}
          inherited={BUILT_IN}
          onChange={(v) => save('ai_switch_defaults', v)}
        />

        {/* Standing instructions, under every conversation's and every task's.
            These stack rather than being overridden — what is set here always
            applies. */}
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

      <Panel title="How it works">
        <div className="st-about">
          {ABOUT.map(({ heading, body }) => (
            <section key={heading}>
              <h4>{heading}</h4>
              <p>{body}</p>
            </section>
          ))}
        </div>
      </Panel>

      <Panel title="The switches">
        <p className="st-note">
          Two classes, and the difference is not cosmetic. An <strong>enforced</strong>{' '}
          switch is refused by the planner itself — a budget of twelve means the
          thirteenth create fails, whatever the agent intended. A{' '}
          <strong>declared</strong> one is recorded and shown, and whoever runs the
          agent has to honour it: a model or an effort level belongs to the session
          doing the work, and nothing on this side can reach into that.
        </p>
        <SwitchTable title="Enforced — the planner refuses" list={ENFORCED} />
        <SwitchTable title="Declared — recorded, honoured by the runner" list={DECLARED} />
      </Panel>

      <Panel title="The dialogue">
        <p className="st-note">
          Five moves that hold a conversation in tasks rather than in a chat window.
        </p>
        <div className="st-keys">
          <section>
            <h4>Moves</h4>
            <dl>
              {MOVES.map(([name, what]) => (
                <div key={name}><dt>{name}</dt><dd>{what}</dd></div>
              ))}
            </dl>
          </section>
          <section>
            <h4>Tools, by scope</h4>
            <dl>
              {SCOPES.map(([scope, tools]) => (
                <div key={scope}><dt>{scope}</dt><dd>{tools}</dd></div>
              ))}
            </dl>
          </section>
        </div>
      </Panel>

      <Panel title="Finding work">
        <p className="st-note">
          One search tool over a query language, rather than a tool per question —
          a tool per question can only answer the questions someone thought of.
          Terms are ANDed; bare words match the title or the notes. With no{' '}
          <code>status:</code> or <code>is:</code> term, only open tasks come back.
        </p>
        <pre className="st-code">{QUERY_EXAMPLES.join('\n')}</pre>
        <div className="st-keys">
          <section>
            <h4>Terms</h4>
            <dl>
              {QUERY.map(([term, what]) => (
                <div key={term}><dt>{term}</dt><dd>{what}</dd></div>
              ))}
            </dl>
          </section>
        </div>
      </Panel>

      <Panel title="Connecting an agent">
        <p className="st-note">
          The API must be running. There is no authentication because nothing
          crosses a network — keep it on loopback.
        </p>
        <pre className="st-code">{CONNECT.command}</pre>
        <div className="st-keys">
          <section>
            <h4>Environment</h4>
            <dl>
              {CONNECT.env.map(([name, what]) => (
                <div key={name}><dt>{name}</dt><dd>{what}</dd></div>
              ))}
            </dl>
          </section>
        </div>
      </Panel>
    </>
  )
}

/** One class of switch, with every value it takes and what each one means. */
function SwitchTable({ title, list }) {
  return (
    <section className="st-switches">
      <h4>{title}</h4>
      {list.map((sw) => (
        <div key={sw.key} className="st-switch">
          <div className="st-switch-h">
            <code>{sw.key}</code>
            <strong>{sw.label}</strong>
            <span className="st-hint">{sw.hint}</span>
          </div>
          <dl>
            {sw.values.map((v) => (
              <div key={v}>
                <dt>{v}{v === sw.fallback ? ' ·' : ''}</dt>
                <dd>{sw.about?.[v] || ''}</dd>
              </div>
            ))}
          </dl>
          {sw.numeric && (
            <p className="st-hint">
              Any whole number from {sw.numeric.min} to {sw.numeric.max} is accepted
              through the API, not only the values offered here.
            </p>
          )}
        </div>
      ))}
      <p className="st-hint">· marks the built-in fallback.</p>
    </section>
  )
}
