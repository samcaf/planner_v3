import { Link } from 'react-router-dom'
import Icon from './Icon.jsx'
import { Panel } from './ui.jsx'
import { useApi } from '../lib/api.js'
import { shortDate } from '../lib/dates.js'
import '../styles/extras.css'

/**
 * What links here: every note, task or day whose text carries a `[[…]]` to
 * `target` — `project:Teleonomy`, `day:2026-08-10`, `task:41`.
 *
 * Renders nothing at all when there is nothing pointing here. Most projects and
 * most days have no backlinks, and an empty box on every one of them would be
 * furniture rather than information.
 */
export default function Backlinks({ target, title = 'Linked from' }) {
  const found = useApi(`/search/backlinks?target=${encodeURIComponent(target || '')}`, [target])
  const results = found.data?.results || []

  if (!target || results.length === 0) return null

  return (
    <Panel
      title={<><Icon name="link" size={14} /> {title} <span className="muted">({results.length})</span></>}
      bodyClass=""
    >
      <ul className="ex-links">
        {results.map((item) => (
          <li key={`${item.kind}-${item.id}-${item.field}`}>
            <Link className="ex-link" to={item.href}>
              <span className="ex-link-kind">{item.kind}</span>
              <span className="ex-link-body">
                <span className="ex-link-title">{item.title}</span>
                <span className="ex-link-snip">{item.snippet}</span>
              </span>
              {item.date && <span className="chip">{shortDate(item.date)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
