import { useEffect, useRef, useState } from 'react'
import Wordmark from '../components/Wordmark.jsx'
import { useAuth } from '../lib/auth.jsx'
import { api } from '../lib/api.js'
import '../styles/login.css'

/**
 * The door.
 *
 * It is drawn on the sidebar's ground rather than the page's, with the mark at
 * full size: this is the one screen where the app has nothing to show you yet,
 * so the only thing worth putting on it is the thing it is. The rail's palette
 * is dark in both themes by design, so the page looks like itself whichever
 * theme is set — and `App` has already written theme and accent onto <html> by
 * the time this renders, so it never flashes the wrong colour.
 *
 * Three states, not two. "Waiting to be approved" is not a failed sign-in and
 * must not read like one — the password was right, and the only thing left to
 * do is wait — so it gets its own words and clears the form rather than
 * inviting another attempt.
 */
export default function Login() {
  const auth = useAuth()
  const [mode, setMode] = useState('in')          // in | ask
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState('')      // the pending / asked message
  const [busy, setBusy] = useState(false)
  const first = useRef(null)

  useEffect(() => { first.current?.focus() }, [mode])

  // The login page has nothing to fetch, so it can afford to wait for the real
  // answer rather than guess and correct itself in front of you. The app cannot
  // afford that, which is why only this side waits.
  if (!auth?.known) return <Shell />

  // Nobody has an account yet, so there is nothing to sign in to. A login box
  // here would be a door with no building behind it.
  if (auth?.setup) {
    return (
      <Shell>
        <p className="lg-say">
          This planner has no accounts yet. Make the first one — it becomes the
          owner, and the owner is who approves everyone else.
        </p>
        <pre className="lg-code">node server/accounts.js add-owner &lt;your-login&gt;</pre>
        <button className="lg-alt" onClick={() => auth.recheck()}>
          I have done that — check again
        </button>
      </Shell>
    )
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setWaiting('')
    try {
      if (mode === 'in') {
        const { user } = await api.post('/auth/login', { login, password })
        auth.signedIn(user)
        return
      }
      const { pending } = await api.post('/auth/request', { login, name, password })
      setPassword('')
      setWaiting(pending
        ? 'Asked for. The owner has to approve it before you can sign in.'
        : 'Account made. Sign in with it.')
      setMode('in')
    } catch (err) {
      // A pending account answers the password correctly and still cannot come
      // in. Saying so under the button, in the same words the server used,
      // rather than in red next to the password it got right.
      if (err.code === 'pending') setWaiting(err.message)
      else setError(err.message || 'that did not work')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  const asking = mode === 'ask'

  return (
    <Shell>
      <form className="lg-form" onSubmit={submit}>
        {asking && (
          <label className="lg-field">
            <span>Your name</span>
            <input
              ref={first}
              className="lg-input"
              value={name}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}

        <label className="lg-field">
          <span>Login</span>
          <input
            ref={asking ? undefined : first}
            className="lg-input"
            value={login}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setLogin(e.target.value)}
          />
        </label>

        <label className="lg-field">
          <span>Password</span>
          <input
            className="lg-input"
            type="password"
            value={password}
            autoComplete={asking ? 'new-password' : 'current-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button
          className="lg-go"
          type="submit"
          disabled={busy || !login.trim() || !password}
        >
          {asking ? 'Ask for an account' : 'Sign in'}
        </button>

        {error && <p className="lg-error">{error}</p>}
        {waiting && <p className="lg-say">{waiting}</p>}

        <button
          type="button"
          className="lg-alt"
          onClick={() => { setMode(asking ? 'in' : 'ask'); setError(''); setWaiting('') }}
        >
          {asking ? 'I already have an account' : 'Ask for an account'}
        </button>
      </form>
    </Shell>
  )
}

/** The mark, and whatever the moment calls for underneath it. */
function Shell({ children }) {
  return (
    <div className="lg">
      <div className="lg-card">
        <Wordmark />
        {children}
      </div>
    </div>
  )
}
