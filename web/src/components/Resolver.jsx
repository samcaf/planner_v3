import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'

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

      if (kind === 'task') {
        const task = await api.get(`/tasks/${decoded}`)
        // An unscheduled task has no day to land on, so fall back to the list.
        return task?.scheduled_date ? `/day/${task.scheduled_date}` : '/tasks'
      }

      return null
    }

    resolve()
      .then((to) => { if (!cancelled) (to ? setTarget(to) : setFailed(true)) })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => { cancelled = true }
  }, [kind, value])

  if (target) return <Navigate to={target} replace />
  if (failed) {
    return (
      <div className="page">
        <p className="muted">
          Nothing here matches <code>{decodeURIComponent(value || '')}</code>.
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
