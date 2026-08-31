import { useCallback, useEffect, useState } from 'react'

/**
 * The session went away — revoked, signed out in another tab, or the server
 * restarted without it. Announced rather than handled here, because the thing
 * that has to react is the whole app, and this function has no idea what that
 * looks like. Same shape as REFRESH_EVENT below.
 */
export const SIGNED_OUT = 'planner:signed-out'

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    // Every call in the app goes through here, so one line covers all of them.
    // Asking who you are is exempt: that request answering 401 IS the answer,
    // and reacting to it would be a loop.
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(SIGNED_OUT))
    }
    const err = new Error(detail.error || `${method} ${path} failed (${res.status})`)
    err.status = res.status
    // The server distinguishes a refusal from a mistake with a code; the login
    // page needs it to tell "waiting on approval" from "wrong password".
    if (detail.code) err.code = detail.code
    throw err
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
    // A null path is "there is nothing to ask for yet" — a panel only the owner
    // may fetch, a detail view with no id. Hooks cannot be called conditionally,
    // so the condition has to live here instead.
    if (!path) { setData(null); setError(null); setLoading(false); return () => {} }
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
