import { useCallback, useEffect, useState } from 'react'

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error || `${method} ${path} failed (${res.status})`)
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
}

/**
 * Fetch on mount and whenever `path` changes, with a `reload` for after writes.
 * Small on purpose — the app has no cross-view cache to keep in sync.
 */
export function useApi(path, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    let cancelled = false
    setLoading(true)
    api.get(path)
      .then((d) => { if (!cancelled) { setData(d); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [path])

  useEffect(() => reload(), [reload, ...deps])

  // Undo/redo rewrites rows behind whatever view is open, so every hook
  // re-fetches on a global signal rather than each page wiring up its own.
  useEffect(() => {
    const onRefresh = () => reload()
    window.addEventListener(REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(REFRESH_EVENT, onRefresh)
  }, [reload])

  return { data, error, loading, reload, setData }
}

export const REFRESH_EVENT = 'planner:refresh'

export function refreshAll() {
  window.dispatchEvent(new Event(REFRESH_EVENT))
}
