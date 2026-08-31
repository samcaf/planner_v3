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
 * `setup` is its own state rather than a kind of signed-out. Before the first
 * account exists there is nothing to sign in to, and a login box would be a
 * dead end — what that moment needs is the one command that makes an owner.
 */
const AuthContext = createContext(null)

export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  // `loading` is a third state on purpose. Rendering the login page while the
  // answer is still in flight would flash it at somebody who is signed in.
  const [state, setState] = useState({ loading: true, user: null, setup: false })

  const check = useCallback(async () => {
    try {
      const me = await api.get('/auth/me')
      setState({ loading: false, user: me.user, setup: !!me.setup })
    } catch {
      // The server is unreachable or answered something unexpected. Treat it as
      // signed out: the login page is at least a page, and it says what failed
      // when you try.
      setState({ loading: false, user: null, setup: false })
    }
  }, [])

  useEffect(() => { check() }, [check])

  // Any request in the app can discover that the session has gone. api.js
  // announces it rather than each caller handling it, which is the same shape
  // the refresh signal already uses.
  useEffect(() => {
    const onLost = () => setState((s) => (s.user ? { ...s, user: null } : s))
    window.addEventListener(SIGNED_OUT, onLost)
    return () => window.removeEventListener(SIGNED_OUT, onLost)
  }, [])

  const value = useMemo(() => ({
    ...state,
    /** After a successful sign-in, so the app does not have to ask again. */
    signedIn: (user) => setState({ loading: false, user, setup: false }),
    signOut: async () => {
      await api.post('/auth/logout').catch(() => {})
      setState({ loading: false, user: null, setup: false })
    },
    recheck: check,
  }), [state, check])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
