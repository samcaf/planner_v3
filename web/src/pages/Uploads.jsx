import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Empty, Modal, Panel } from '../components/ui.jsx'
import { useToast } from '../components/Toast.jsx'
import { api, useApi } from '../lib/api.js'
import { Rich, attach, markdownFor } from '../lib/rich.jsx'
import { shortDate } from '../lib/dates.js'
import '../styles/extras.css'
import { usePageTitle } from '../lib/title.js'

/** Human bytes — KB and MB are all a file browser has to distinguish. */
function size(bytes) {
  if (!(bytes > 0)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The day part of a file's mtime, or nothing if the server did not send one. */
const dayOf = (mtime) => /^\d{4}-\d{2}-\d{2}/.exec(String(mtime || ''))?.[0] || ''

/** Uppercase suffix of the *stored* name, which the server guarantees is short. */
const extOf = (name) => String(name || '').slice(String(name).lastIndexOf('.') + 1).toUpperCase()

const isImage = (file) => String(file.mime || '').startsWith('image/')

/** Anything the browser will show rather than save. Mirrors the server's list. */
const viewable = (file) => isImage(file) || /\.pdf$/i.test(file.name || '')

/**
 * A glyph per broad family, from the icon set the app already ships. Nothing
 * here distinguishes .docx from .pages — the extension badge does that, and a
 * per-format icon would be a wall of near-identical documents.
 */
function iconFor(file) {
  const ext = extOf(file.name).toLowerCase()
  if (['zip', 'gz', 'tar', '7z', 'rar'].includes(ext)) return 'projects'
  if (['csv', 'xls', 'xlsx', 'json'].includes(ext)) return 'list'
  return 'templates'
}

/**
 * Everything ever attached to a note. Uploads are content-addressed and write-only
 * everywhere else, so this is the only place the directory can be pruned — and,
 * now, the only place a file can be added without going through an editor.
 */
export default function Uploads() {
  usePageTitle('Uploads')
  const list = useApi('/uploads')
  const [doomed, setDoomed] = useState(null)
  // The image currently held open over the page, if any.
  const [viewing, setViewing] = useState(null)

  useEffect(() => {
    if (!viewing) return
    const onKey = (e) => { if (e.key === 'Escape') setViewing(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)
  const picker = useRef(null)
  const toast = useToast()

  if (list.error) return <div className="page"><p className="muted">{list.error.message}</p></div>
  if (!list.data) return <div className="page"><p className="muted">Loading…</p></div>

  const files = [...list.data].sort((a, b) => dayOf(b.mtime).localeCompare(dayOf(a.mtime)))
  const total = files.reduce((sum, f) => sum + (f.bytes || 0), 0)

  async function upload(picked) {
    const chosen = [...(picked || [])]
    if (!chosen.length) return
    setBusy(true)
    setError(null)
    try {
      // Sequential, not Promise.all: each file goes up as a base64 body, so
      // sending a whole selection at once would only hold them all in memory.
      for (const file of chosen) await attach(file)
      list.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(name) {
    setBusy(true)
    setError(null)
    try {
      await api.del(`/uploads/${encodeURIComponent(name)}`)
      setDoomed(null)
      list.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /** The markdown a note would use, so a file can be re-referenced by hand. */
  async function copyLink(file) {
    try {
      await navigator.clipboard.writeText(markdownFor(file))
      toast({ message: 'Markdown link copied' })
    } catch {
      // Clipboard access is refused outside a secure context, which localhost
      // usually is not — but a proxied dev server can be.
      setError('Could not reach the clipboard — copy the link from the file itself.')
    }
  }

  return (
    <>
      <header className="topbar">
        <h1>Uploads</h1>
        <span className="sub">{files.length} {files.length === 1 ? 'file' : 'files'} · {size(total)}</span>
        <span className="spacer" />
        {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
        <button className="btn primary" disabled={busy} onClick={() => picker.current?.click()}>
          <Icon name="plus" size={14} /> {busy ? 'Uploading…' : 'Upload'}
        </button>
      </header>

      {/* The drop target is the whole page rather than a strip, because the point
          of dropping is not having to aim at anything. */}
      <div
        className={`page ex-drop ${dragging ? 'ex-dropping' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer?.types?.includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        // dragleave also fires when the pointer crosses into a child, so the cue
        // only drops once the pointer is genuinely outside the page.
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
        onDrop={(e) => {
          if (!e.dataTransfer?.files?.length) return
          e.preventDefault()
          setDragging(false)
          upload(e.dataTransfer.files)
        }}
      >
        <p className="ex-intro">
          Everything pasted, dropped or attached in a note, plus anything dropped straight onto this
          page. Deleting is permanent and leaves any note that links a file pointing at nothing, so
          the confirmation lists what still references it.
        </p>

        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => { upload(e.target.files); e.target.value = '' }}
        />

        {files.length === 0 ? (
          <Panel><Empty>Nothing uploaded yet. Drop a file anywhere on this page, or use Upload.</Empty></Panel>
        ) : (
          <div className="ex-uploads">
            {files.map((file) => (
              <figure key={file.name} className="panel ex-up">
                <a
                  className="ex-up-thumb"
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  // `download` used to be set on every card, so clicking an
                  // image saved it rather than showing it. It is now only set
                  // for files there is nothing to look at — and there it also
                  // restores the name they were uploaded with, since the stored
                  // one is a hash.
                  {...(viewable(file) ? {} : { download: file.filename })}
                  title={
                    isImage(file) ? 'View full size'
                      : viewable(file) ? `Open ${file.filename}`
                        : `Download ${file.filename}`
                  }
                  onClick={(e) => {
                    // An image opens over the page rather than in a tab:
                    // looking at one is usually a glance, and a glance should
                    // not cost you the view you were on.
                    if (!isImage(file) || e.metaKey || e.ctrlKey || e.shiftKey) return
                    e.preventDefault()
                    setViewing(file)
                  }}
                >
                  {isImage(file) ? (
                    <img src={file.url} alt={file.filename} loading="lazy" />
                  ) : (
                    <span className="ex-up-file">
                      <Icon name={iconFor(file)} size={30} />
                      <span className="ex-up-ext">{extOf(file.name)}</span>
                    </span>
                  )}
                </a>
                <figcaption className="ex-up-b">
                  <span className="ex-up-name" title={file.name}>{file.filename}</span>
                  <span className="ex-up-meta">
                    {size(file.bytes)}
                    {dayOf(file.mtime) && <>· {shortDate(dayOf(file.mtime))}</>}
                    <span className="spacer" />
                    <button
                      className="btn ghost sm"
                      title="Copy a markdown link to this file"
                      aria-label={`Copy a markdown link to ${file.filename}`}
                      onClick={() => { setError(null); copyLink(file) }}
                    >
                      <Icon name="link" size={13} />
                    </button>
                    <button
                      className="btn ghost sm danger"
                      title="Delete this file"
                      aria-label={`Delete ${file.filename}`}
                      onClick={() => { setError(null); setDoomed(file) }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      {/* Held over the page rather than replacing it. Click anywhere, or press
          Escape, and you are back where you were. */}
      {viewing && (
        <div
          className="ex-view"
          role="dialog"
          aria-label={viewing.filename}
          onClick={() => setViewing(null)}
        >
          <img src={viewing.url} alt={viewing.filename} />
          <span className="ex-view-name">{viewing.filename}</span>
        </div>
      )}

      {doomed && (
        <ConfirmDelete
          file={doomed}
          busy={busy}
          onCancel={() => setDoomed(null)}
          onConfirm={() => remove(doomed.name)}
        />
      )}
    </>
  )
}

/**
 * Deleting a file that a note still links leaves a dead reference behind, and it
 * cannot come back — it is on disk, not in the undo history. So the confirmation
 * says which notes would break before asking.
 */
function ConfirmDelete({ file, busy, onCancel, onConfirm }) {
  // A file is referenced by its stored name, so a plain text search over titles
  // and notes finds every reference without any extra machinery.
  const refs = useApi(`/search?q=${encodeURIComponent(file.name)}`, [file.name])
  const used = refs.data?.results || []

  return (
    <Modal
      title="Delete upload"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn danger" disabled={busy} onClick={onConfirm}>
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </>
      }
    >
      {isImage(file) ? (
        <img className="ex-up-preview" src={file.url} alt={file.filename} />
      ) : (
        <p className="ex-up-preview ex-up-file">
          <Icon name={iconFor(file)} size={30} />
          <span className="ex-up-ext">{extOf(file.name)}</span>
        </p>
      )}

      <p className="ex-up-warn">
        <Icon name="flag" size={14} />
        <span>
          <strong>{file.filename}</strong> is deleted from disk for good. Anything still
          linking <code>{file.name}</code> will point at nothing.
        </span>
      </p>

      {refs.loading && <p className="muted">Checking which notes use it…</p>}

      {!refs.loading && (used.length === 0 ? (
        <p className="muted">Nothing references this file — safe to remove.</p>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            <strong>{used.length}</strong> {used.length === 1 ? 'note references' : 'notes reference'} it:
          </p>
          <ul className="ex-links" style={{ padding: 0 }}>
            {used.slice(0, 6).map((item) => (
              <li key={`${item.kind}-${item.id}-${item.field}`}>
                <Link className="ex-link" to={item.href} onClick={onCancel}>
                  <span className="ex-link-kind">{item.kind}</span>
                  <span className="ex-link-body">
                    <span className="ex-link-title"><Rich text={item.title} inline /></span>
                    <span className="ex-link-snip">{item.snippet}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {used.length > 6 && <p className="muted">…and {used.length - 6} more.</p>}
        </>
      ))}
    </Modal>
  )
}
