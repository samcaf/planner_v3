import { useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Empty, Field, Panel } from '../components/ui.jsx'
import { api, useApi } from '../lib/api.js'
import { minutesLabel } from '../lib/dates.js'
import '../styles/settings.css'

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
const HANDLED = ['deep_capacity_min', 'column_labels']

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
