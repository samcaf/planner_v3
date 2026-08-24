import { Component } from 'react'

/**
 * Catches a render error and says what happened.
 *
 * Without this a thrown component unmounts the whole tree and leaves a blank
 * page — no message, nothing in view to act on, and the only clue in a console
 * most people have no reason to have open. A white screen is the least useful
 * thing an app can do, and it is entirely avoidable.
 *
 * The error is kept on screen rather than only logged, because the useful
 * moment is the one you are already in: the page you were on, and the message,
 * together.
 */
export default class Crash extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Still logged, so a console that IS open gets the full trace.
    console.error('planner crashed while rendering', error, info)
    this.setState({ info })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="page crash">
        <h1>Something in this page threw.</h1>
        <p className="muted">
          The rest of the app is fine — your data has not been touched. This is a
          rendering fault, so moving to another view usually gets you working
          again.
        </p>

        <pre className="crash-msg">{String(error?.stack || error)}</pre>
        {info?.componentStack && (
          <details>
            <summary>Which components were involved</summary>
            <pre className="crash-msg">{info.componentStack}</pre>
          </details>
        )}

        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" onClick={() => this.setState({ error: null, info: null })}>
            Try this page again
          </button>
          <a className="btn" href="/">Go to today</a>
        </div>
      </div>
    )
  }
}
