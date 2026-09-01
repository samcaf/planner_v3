import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { Empty, Modal } from './ui.jsx'
import { api } from '../lib/api.js'
import '../styles/teleonomy.css'

/**
 * Choosing what to bring over from Teleonomy.
 *
 * A picker rather than a mirror. Nothing arrives here because it exists over
 * there — it arrives because somebody ticked it, and only ticked tasks are ever
 * touched again. That is what keeps this a planner instead of a second view of
 * a team board, and it is why the linked set stays small enough to sweep.
 *
 * Everything is read through the planner's own API. The Teleonomy token lives
 * on the server; this component knows an address and a checkbox.
 */
export default function TeleonomyPicker({ onClose, onLinked }) {
  const [projects, setProjects] = useState(null)
  const [parent, setParent] = useState('')
  const [items, setItems] = useState(null)
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/tel/projects')
      .then((d) => setProjects(d.roots || []))
      .catch((e) => setError(e.message || 'could not reach Teleonomy'))
  }, [])

  useEffect(() => {
    if (!parent) { setItems(null); return }
    setItems(null)
    setPicked(new Set())
    api.get(`/tel/items?parent=${encodeURIComponent(parent)}`)
      .then((d) => setItems(d.items || []))
      .catch((e) => setError(e.message || 'could not read that project'))
  }, [parent])

  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    return next
  })

  // Already here means already linked, so it is shown and not offered — a
  // second copy of a task you are already syncing is the one outcome nobody
  // wants from an import.
  const offerable = (items || []).filter((i) => !i.linked_task_id)
  const allPicked = offerable.length > 0 && offerable.every((i) => picked.has(i.id))

  async function add() {
    setBusy(true)
    setError('')
    try {
      const out = await api.post('/tel/link', { items: [...picked], parent })
      onLinked?.(out)
      onClose()
    } catch (e) {
      setError(e.message || 'could not add them')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={<><Icon name="link" size={14} /> Bring work over from Teleonomy</>}
      onClose={onClose}
      footer={(
        <>
          {error && <span className="tel-err">{error}</span>}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!picked.size || busy} onClick={add}>
            {busy ? 'Adding…' : `Add ${picked.size || ''} to the backlog`}
          </button>
        </>
      )}
    >
      <label className="tel-pick">
        <span>Project</span>
        <select className="input select" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">Choose one…</option>
          {(projects || []).map((p) => (
            <option key={p.id} value={p.id}>{p.human_code ? `${p.human_code} · ` : ''}{p.title || p.label}</option>
          ))}
        </select>
      </label>

      {!parent && <p className="tel-hint">They arrive unscheduled, in the backlog. Which day is yours to decide.</p>}

      {parent && items === null && <Empty>Reading…</Empty>}
      {parent && items?.length === 0 && <Empty>Nothing under that one.</Empty>}

      {!!items?.length && (
        <>
          <div className="tel-all">
            <button
              className="btn ghost sm"
              onClick={() => setPicked(allPicked ? new Set() : new Set(offerable.map((i) => i.id)))}
            >
              {allPicked ? 'Pick none' : 'Pick all'}
            </button>
            <span className="muted">{picked.size} of {offerable.length}</span>
          </div>

          <ul className="tel-list">
            {items.map((i) => (
              <li key={i.id} style={{ paddingLeft: 4 + i.depth * 18 }}>
                <label className={i.linked_task_id ? 'tel-row is-here' : 'tel-row'}>
                  <input
                    type="checkbox"
                    checked={picked.has(i.id)}
                    disabled={!!i.linked_task_id}
                    onChange={() => toggle(i.id)}
                  />
                  <code className="tel-code">{i.code}</code>
                  <span className="tel-title">{i.title}</span>
                  <span className="chip">{i.status.replace(/_/g, ' ')}</span>
                  {i.linked_task_id && <span className="chip c-green">already here</span>}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
