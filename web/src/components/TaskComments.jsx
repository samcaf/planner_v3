import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { Rich } from '../lib/rich.jsx'
import { api } from '../lib/api.js'

/**
 * What happened to a task, as opposed to what you think about it.
 *
 * The notes field is the user's own prose. A comment is a record of an event —
 * an agent reporting what it changed, a worklog entry saying where an hour
 * went. Keeping them apart is the whole reason the table exists: merged, you
 * cannot tell a week later which sentences you wrote.
 *
 * Loaded when opened rather than with the day, because most tasks have none
 * and a day of thirty rows should not make thirty requests to prove it. The
 * count comes down with the task, so the row can offer the chip without
 * asking.
 */
export default function TaskComments({ taskId, count = 0 }) {
  const [open, setOpen] = useState(false)
  // Held here rather than asked back from the day. Posting a comment does not
  // change the task, so making the row re-patch itself to refresh a number
  // would write nothing to the database and put a no-op on the undo stack.
  const [shown, setShown] = useState(count)
  const [list, setList] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  // A refetch of the day can bring a newer count — from another tab, or from
  // an agent — so follow it, but never backwards over a local change.
  useEffect(() => { setShown((n) => Math.max(n, count)) }, [count])

  useEffect(() => {
    if (!open) return
    let gone = false
    api.get(`/tasks/${taskId}/comments`)
      .then((rows) => { if (!gone) setList(rows) })
      .catch(() => { if (!gone) setList([]) })
    return () => { gone = true }
  }, [open, taskId])

  async function add() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const made = await api.post(`/tasks/${taskId}/comments`, { body, author: 'me' })
      setList((rows) => [...(rows || []), made])
      setShown((n) => n + 1)
      setDraft('')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    await api.del(`/tasks/${taskId}/comments/${id}`)
    setList((rows) => (rows || []).filter((c) => c.id !== id))
    setShown((n) => Math.max(0, n - 1))
  }

  // Nothing to show and nothing said yet: the chip would be an empty promise.
  if (!shown && !open) return null

  return (
    <div className="task-comments">
      <button
        className={`chip ${open ? 'is-on' : ''}`}
        title={open ? 'Hide the comments' : 'What happened to this task'}
        onClick={() => setOpen(!open)}
      >
        <Icon name="dots" size={11} />
        {shown}
      </button>

      {open && (
        <div className="tc-body">
          {list === null && <p className="muted tc-empty">Loading…</p>}
          {list?.length === 0 && <p className="muted tc-empty">Nothing yet.</p>}
          {(list || []).map((c) => (
            <article key={c.id} className={`tc-item ${c.kind === 'worklog' ? 'is-worklog' : ''}`}>
              <header className="tc-head">
                <span className="tc-who">{c.author}</span>
                {c.kind === 'worklog' && <span className="chip c-teal">{c.minutes}m</span>}
                <span className="muted tc-when">{c.created_at}</span>
                <span className="spacer" />
                <button
                  className="btn ghost sm danger"
                  aria-label="Delete this comment"
                  onClick={() => remove(c.id)}
                >
                  <Icon name="trash" size={11} />
                </button>
              </header>
              <Rich text={c.body} />
            </article>
          ))}

          {/* A plain textarea, not the RichEditor used for notes. That one is
              bound to a stored value and commits when it loses focus, which is
              right for a field and wrong for a compose box: the send button
              could never light up while you were still typing into it. What is
              written here is still markdown — it is rendered with Rich above. */}
          <form
            className="tc-add"
            onSubmit={(e) => { e.preventDefault(); add() }}
          >
            <textarea
              className="input"
              rows={2}
              placeholder="Add a comment…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl-Enter sends, the convention everywhere else that has a
                // multi-line box and a send button.
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add() }
              }}
            />
            <button className="btn sm" type="submit" disabled={!draft.trim() || busy}>Comment</button>
          </form>
        </div>
      )}
    </div>
  )
}
