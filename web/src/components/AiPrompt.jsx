import { useState } from 'react'
import Icon from './Icon.jsx'

/**
 * Instructions written for the agent, rather than about the work.
 *
 * Folded away until asked for, and marked when there is something in it, so a
 * conversation where nobody has written any is not carrying an empty box on
 * every row. Plain text rather than the markdown editor used for notes: this
 * is read by a model, and rendering it as prose would hide the difference
 * between what you wrote and how it will be handed over.
 */
export default function AiPrompt({
  value, onChange, label = 'Instructions for the AI', placeholder, inherited = [],
}) {
  const set = String(value || '')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(set)

  // Follow the stored value while closed; never yank the box out from under
  // someone typing in it.
  if (!open && draft !== set) setDraft(set)

  const commit = () => {
    if (draft.trim() !== set.trim()) onChange(draft.trim())
  }

  return (
    <div className="ai-prompt">
      <button
        className={`chip aip-open ${set.trim() ? 'is-set' : ''}`}
        title={set.trim() ? `${label}:\n\n${set}` : label}
        onClick={() => setOpen(!open)}
      >
        <Icon name="sparkle" size={11} />
        prompt
      </button>

      {open && (
        <div className="aip-body">
          {inherited.map((p) => (
            <div key={p.from} className="aip-above">
              <span className="aip-from">{p.label}</span>
              <p>{p.text}</p>
            </div>
          ))}
          <textarea
            className="input aip-text"
            rows={3}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setDraft(set); setOpen(false) }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { commit(); setOpen(false) }
            }}
          />
          <p className="aip-hint">
            Handed to the agent alongside the task, labelled by where it came from.
            {inherited.length > 0 && ' What is above applies too — these stack, they do not replace.'}
          </p>
        </div>
      )}
    </div>
  )
}
