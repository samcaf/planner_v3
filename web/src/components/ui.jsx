import { useEffect } from 'react'
import Icon from './Icon.jsx'

export const COLORS = ['blue', 'purple', 'green', 'teal', 'amber', 'red', 'gray']

export const SWATCH = {
  blue: '#3b6fd4', purple: '#5b4fd0', green: '#2e9e63', teal: '#0f7d8c',
  amber: '#b97a1a', yellow: '#b97a1a', red: '#cf4a3d', gray: '#6b7280', silver: '#6b7280',
}

export function cls(color) {
  return `c-${color || 'gray'}`
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase()
}

// bodyClass defaults to the padded body, but an explicit "" opts out of padding
// entirely — which `?? ` preserves and `|| ` would silently ignore.
export function Panel({ title, actions, children, className = '', bodyClass }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-h">
          {title}
          <span className="spacer" />
          {actions}
        </header>
      )}
      <div className={bodyClass ?? 'panel-b'}>{children}</div>
    </section>
  )
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <header className="modal-h">
          {title}
          <span className="spacer" />
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="modal-b">{children}</div>
        {footer && <footer className="modal-f">{footer}</footer>}
      </div>
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function ColorPicker({ value, onChange }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={c}
          aria-pressed={value === c}
          style={{
            width: 20, height: 20, borderRadius: '50%', cursor: 'pointer', padding: 0,
            background: SWATCH[c],
            border: value === c ? '2px solid var(--ink)' : '2px solid transparent',
          }}
        />
      ))}
    </div>
  )
}

export function ProjectChip({ name, color, onClick }) {
  if (!name) return null
  return (
    <span className={`chip ${cls(color)}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      {name}
    </span>
  )
}

// `noneLabel` renames the empty option where empty does not mean "none": on a
// routine item it means "whatever the routine says", and a row that read "No
// project" while quietly producing a task filed under one would be a lie.
export function ProjectSelect({ projects, value, onChange, allowNone = true, noneLabel = 'No project' }) {
  return (
    <select
      className="select input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      {allowNone && <option value="">{noneLabel}</option>}
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  )
}
