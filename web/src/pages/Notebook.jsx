import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Empty, Panel } from '../components/ui.jsx'
import { RichEditor, RichLine } from '../lib/rich.jsx'
import { api, useApi } from '../lib/api.js'
import '../styles/notebook.css'
import { usePageTitle } from '../lib/title.js'

/**
 * Notes that belong to no day and no project: references, standing lists, the
 * things a planner otherwise has nowhere to put.
 *
 * Its own table rather than a task with no date. An undated task is a backlog
 * item — it would be counted as work waiting to be done, appear in the day's
 * aside, and quietly inflate every total. A note is not work.
 *
 * Ordered by pinned, then by when it was last touched, because a loose pile of
 * notes has no other order that means anything.
 */
export default function Notebook() {
  usePageTitle('Notebook')
  // `?note=12` opens straight onto one, which is what a [[note:…]] link needs
  // in order to land on something rather than just on the page.
  const [params] = useSearchParams()
  const [showArchived, setShowArchived] = useState(false)
  const notes = useApi(`/notebook${showArchived ? '?archived=1' : ''}`, [showArchived])
  const [openId, setOpenId] = useState(null)
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null)

  if (notes.error) return <div className="page"><p className="muted">{notes.error.message}</p></div>
  if (!notes.data) return <div className="page"><p className="muted">Loading…</p></div>

  const list = notes.data
  const asked = Number(params.get('note')) || null
  const open = list.find((n) => n.id === (openId ?? asked)) || list[0] || null

  const save = async (id, patch) => { await api.patch(`/notebook/${id}`, patch); notes.reload() }

  const add = async () => {
    const made = await api.post('/notebook', { title: 'Untitled', body: '' })
    setOpenId(made.id)
    notes.reload()
  }

  /**
   * Reorder by dropping one note onto another. The whole list is renumbered
   * from the array it draws, rather than nudging one row's sort, because
   * anything else drifts once two notes end up sharing a position.
   */
  const reorder = async (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    const ids = list.map((n) => n.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ...ids.splice(from, 1))
    await api.post('/notebook/reorder', { ids })
    notes.reload()
  }

  const remove = async (note) => {
    const name = note.title?.trim() || 'this note'
    if (!window.confirm(`Delete ${name}? This cannot be undone from here.`)) return
    await api.del(`/notebook/${note.id}`)
    if (openId === note.id) setOpenId(null)
    notes.reload()
  }

  return (
    <>
      <header className="topbar">
        <h1>Notebook</h1>
        <span className="muted sub">
          {list.length === 1 ? '1 note' : `${list.length} notes`} · not tied to a day or a project
        </span>
        <span className="spacer" />
        <button
          className={`btn ghost sm ${showArchived ? 'is-on' : ''}`}
          aria-pressed={showArchived}
          title={showArchived ? 'Hide archived notes' : 'Show archived notes as well'}
          onClick={() => setShowArchived(!showArchived)}
        >
          <Icon name="archive" size={13} /> Archived
        </button>
        <button className="btn primary" onClick={add}>
          <Icon name="plus" size={14} /> New note
        </button>
      </header>

      <div className="page nb-page">
        <aside className="nb-list">
          {list.length === 0 ? (
            <Empty>Nothing here yet. A note made here belongs to no day — it just stays.</Empty>
          ) : (
            list.map((n) => (
              <button
                key={n.id}
                className={[
                  'nb-item',
                  open?.id === n.id ? 'is-on' : '',
                  n.archived ? 'is-archived' : '',
                  drag === n.id ? 'is-dragging' : '',
                  over === n.id ? 'is-over' : '',
                ].filter(Boolean).join(' ')}
                draggable
                onClick={() => setOpenId(n.id)}
                onDragStart={(e) => {
                  setDrag(n.id)
                  e.dataTransfer.setData('text/notebook-id', String(n.id))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => { setDrag(null); setOver(null) }}
                onDragOver={(e) => { e.preventDefault(); setOver(n.id) }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setOver(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = Number(e.dataTransfer.getData('text/notebook-id')) || drag
                  setDrag(null)
                  setOver(null)
                  reorder(from, n.id)
                }}
              >
                <span className="nb-item-title">{n.title?.trim() || 'Untitled'}</span>
                {!!n.archived && <Icon name="archive" size={11} />}
                {!!n.pinned && <Icon name="flag" size={11} />}
              </button>
            ))
          )}
        </aside>

        {open ? (
          <Panel
            className="nb-open"
            title={
              <RichLine
                value={open.title}
                onChange={(title) => save(open.id, { title })}
                placeholder="Untitled"
              />
            }
            actions={
              <>
                <button
                  className={`btn ghost sm ${open.pinned ? 'is-on' : ''}`}
                  title={open.pinned ? 'Unpin' : 'Pin to the top'}
                  onClick={() => save(open.id, { pinned: open.pinned ? 0 : 1 })}
                >
                  <Icon name="flag" size={13} />
                </button>
                {/* Archiving before deleting: a note stops being current long
                    before it stops being worth keeping. */}
                <button
                  className={`btn ghost sm ${open.archived ? 'is-on' : ''}`}
                  aria-pressed={!!open.archived}
                  title={open.archived ? 'Bring back out of the archive' : 'Archive this note'}
                  onClick={() => save(open.id, { archived: open.archived ? 0 : 1 })}
                >
                  <Icon name="archive" size={13} />
                </button>
                <button className="btn ghost sm danger" title="Delete" onClick={() => remove(open)}>
                  <Icon name="trash" size={13} />
                </button>
              </>
            }
          >
            <RichEditor
              value={open.body}
              onChange={(body) => save(open.id, { body })}
              placeholder="Markdown, links, images, $math$ — whatever it needs to be."
              rows={18}
              draftKey={`notebook:${open.id}`}
            />
          </Panel>
        ) : (
          <Panel title="Nothing open">
            <Empty>Make a note, or pick one from the list.</Empty>
          </Panel>
        )}
      </div>
    </>
  )
}
