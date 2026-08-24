import { useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Empty, Panel } from '../components/ui.jsx'
import { RichEditor, RichLine } from '../lib/rich.jsx'
import { api, useApi } from '../lib/api.js'
import '../styles/notebook.css'

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
  const notes = useApi('/notebook')
  const [openId, setOpenId] = useState(null)

  if (notes.error) return <div className="page"><p className="muted">{notes.error.message}</p></div>
  if (!notes.data) return <div className="page"><p className="muted">Loading…</p></div>

  const list = notes.data
  const open = list.find((n) => n.id === openId) || list[0] || null

  const save = async (id, patch) => { await api.patch(`/notebook/${id}`, patch); notes.reload() }

  const add = async () => {
    const made = await api.post('/notebook', { title: 'Untitled', body: '' })
    setOpenId(made.id)
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
                className={`nb-item ${open?.id === n.id ? 'is-on' : ''}`}
                onClick={() => setOpenId(n.id)}
              >
                <span className="nb-item-title">{n.title?.trim() || 'Untitled'}</span>
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
