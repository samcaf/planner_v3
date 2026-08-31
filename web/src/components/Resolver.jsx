import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'
import { loadLinks, normalise } from '../lib/names.js'

/**
 * Landing point for `[[…]]` links. Rendered markdown has no access to the data
 * needed to turn a project name or task id into a route, so it emits /go/… and
 * the lookup happens here, on click.
 */
export default function Resolver() {
  const { kind, value } = useParams()
  const [target, setTarget] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const decoded = decodeURIComponent(value || '')

    async function resolve() {
      if (kind === 'day') return `/day/${decoded}`

      if (kind === 'project') {
        const projects = await api.get('/projects?include_archived=1')
        const match = projects.find((p) => p.name.toLowerCase() === decoded.toLowerCase())
          || projects.find((p) => p.name.toLowerCase().includes(decoded.toLowerCase()))
        return match ? `/projects/${match.id}` : null
      }

      // A notebook entry has no day to open, so the notebook opens with it
      // selected — see Notebook.jsx, which reads ?note= for exactly this.
      if (kind === 'note') return `/notebook?note=${encodeURIComponent(decoded)}`

      // A nicknamed URL. Looked up here, on the click, rather than baked into
      // the note when it was written — which is what lets you re-point a
      // nickname and have every link already written follow it.
      if (kind === 'link') return (await loadLinks())[normalise(decoded)] || null

      if (kind === 'task') {
        const task = await api.get(`/tasks/${decoded}`)
        // An unscheduled task has no day to land on, so fall back to the list.
        return task?.scheduled_date ? `/day/${task.scheduled_date}` : '/tasks'
      }

      return null
    }

    resolve()
      .then((to) => {
        if (cancelled) return
        if (!to) { setFailed(true); return }
        // A nicknamed URL is not a route — nothing in this app can render it,
        // so the tab leaves. `replace` rather than an assignment, so Back in
        // the new tab goes wherever it came from instead of landing here and
        // bouncing straight out again. No route begins with a scheme, so this
        // cannot catch an internal one.
        if (/^[a-z][a-z0-9+.-]*:/i.test(to)) { window.location.replace(to); return }
        setTarget(to)
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => { cancelled = true }
  }, [kind, value])

  if (target) return <Navigate to={target} replace />
  if (failed) {
    return (
      <div className="page">
        <p className="muted">
          Nothing here matches <code>{decodeURIComponent(value || '')}</code>.
          {kind === 'link' && ' Name a URL in Settings, or with :nameurl.'}
        </p>
      </div>
    )
  }
  return <div className="page"><p className="muted">Looking that up…</p></div>
}

/**
 * Markdown is rendered as raw HTML, so its internal links are plain anchors that
 * would reload the whole app. This hands same-origin clicks to the router.
 */
export function InternalLinks() {
  const navigate = useNavigate()

  useEffect(() => {
    function onClick(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const anchor = e.target.closest?.('a')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href || !href.startsWith('/') || anchor.target === '_blank') return
      if (href.startsWith('/uploads/')) return   // a real file, let the browser have it

      e.preventDefault()
      navigate(href)
    }

    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [navigate])

  return null
}
