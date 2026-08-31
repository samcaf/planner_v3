import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { SIGNED_OUT, api } from './api.js'

/**
 * Who is signed in, for the whole app.
 *
 * One question asked once at startup — `/api/auth/me` — and then kept current
 * by the same 401 that any request can hit. A session lasts years, so the
 * interesting moment is not expiry but revocation: the owner signs a lost phone
 * out and that phone's next request is a 401, which lands here and puts the
 * login page up without anything having to poll.
 *
 * WAITING FOR THAT ANSWER IS THE EXPENSIVE PART, and it does not have to be
 * waited for. Blocking the app on it put two round trips in front of every page
 * load — first who are you, and only then the page's own data — where there had
 * been one. That is a real cost on a phone over a tailnet, and it showed up
 * first as keyboard suites intermittently finding no cursor because the day had
 * not drawn yet.
 *
 * So this remembers, in localStorage, whether this browser was signed in last
 * time, and draws accordingly while the real answer is in flight:
 *
 *   the flag is set    draw the app at once. Its data starts loading in
 *                      parallel with the check. If the check comes back
 *                      "nobody" — revoked, or signed out elsewhere — the login
 *                      page replaces it, which is exactly what a 401 from any
 *                      other request would have done anyway.
 *   the flag is unset  draw the login page at once. It has nothing to fetch,
 *                      so nothing is lost by it waiting for `known` before
 *                      choosing its wording.
 *
 * The flag is not a credential and grants nothing: the cookie is HttpOnly and
 * every request is still checked by the server. It is a hint about what to
 * paint, and the worst case of it being wrong is one wasted render.
 */
const AuthContext = createContext(null)

const SEEN = 'planner_signed_in'

const remember = (yes) => {
  try {
    if (yes) localStorage.setItem(SEEN, '1')
    else localStorage.removeItem(SEEN)
  } catch { /* private mode: the app still works, it just always waits */ }
}

const wasSignedIn = () => {
  try { return localStorage.getItem(SEEN) === '1' } catch { return false }
}

export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [state, setState] = useState(() => ({
    // Whether the server has answered yet. The login page waits for it; the app
    // does not.
    known: false,
    assumed: wasSignedIn(),
    user: null,
    setup: false,
  }))

  const check = useCallback(async () => {
    try {
      const me = await api.get('/auth/me')
      remember(!!me.user)
      setState({ known: true, assumed: !!me.user, user: me.user, setup: !!me.setup })
    } catch {
      // Unreachable, or an answer we did not understand. Treat it as signed
      // out: the login page is at least a page, and it says what failed when
      // you try it.
      remember(false)
      setState({ known: true, assumed: false, user: null, setup: false })
    }
  }, [])

  useEffect(() => { check() }, [check])

  // Any request in the app can discover that the session has gone. api.js
  // announces it rather than each caller handling it, which is the same shape
  // the refresh signal already uses.
  useEffect(() => {
    const onLost = () => {
      remember(false)
      setState((s) => (s.assumed || s.user ? { ...s, assumed: false, user: null } : s))
    }
    window.addEventListener(SIGNED_OUT, onLost)
    return () => window.removeEventListener(SIGNED_OUT, onLost)
  }, [])

  const value = useMemo(() => ({
    ...state,
    /** Draw the app? Optimistically yes, until the server says otherwise. */
    in: state.known ? !!state.user : state.assumed,
    signedIn: (user) => {
      remember(true)
      setState({ known: true, assumed: true, user, setup: false })
    },
    signOut: async () => {
      await api.post('/auth/logout').catch(() => {})
      remember(false)
      setState({ known: true, assumed: false, user: null, setup: false })
    },
    recheck: check,
  }), [state, check])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
