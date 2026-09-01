import { db } from '../db.js'

/**
 * Talking to Teleonomy.
 *
 * The connection lives in this person's own `settings` rows, which the
 * per-planner split already keeps apart — so two people syncing to the same
 * Teleonomy do it as themselves, with their own agent token, and every write
 * lands in the ledger attributed to the right actor.
 *
 * The token never reaches the browser. The picker asks the planner's own
 * server, and the planner's own server asks Teleonomy; a page that held a
 * bearer token for another system would be one XSS away from handing it over.
 */
const setting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || ''

export function connection() {
  return {
    // Trailing slashes are the difference between /api/x and /api//x, and one
    // of those 404s. Normalise once, here.
    base: setting('tel_base_url').replace(/\/+$/, ''),
    token: setting('tel_token'),
    on: setting('tel_enabled') === '1',
  }
}

export class TelError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

/**
 * One call. Everything Teleonomy exposes for reading and for verbs is a POST
 * with a JSON body, so there is only one shape to write.
 *
 * A refusal comes back as JSON with a code — `IllegalTransition`,
 * `ApprovalRequired` — and those are answers, not failures: the sync asks for
 * moves it believes are legal, and a refusal means its idea of the lifecycle
 * has drifted from the rows that define it. It is surfaced rather than
 * swallowed so that drift is visible instead of silent.
 */
export async function call(path, body = {}, { method = 'POST' } = {}) {
  const { base, token } = connection()
  if (!base) throw new TelError('no Teleonomy server is configured', 400)

  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })

  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* not JSON; keep the text */ }

  if (!res.ok) {
    const why = data?.message || data?.error || text.slice(0, 200) || res.statusText
    throw new TelError(`Teleonomy ${res.status}: ${why}`, res.status, data)
  }
  return data
}

/** Who the token says we are — the connection test, and the actor id the daemon
 *  needs so it can ignore the echo of its own writes. */
export const whoami = () => call('/api/whoami', {}, { method: 'GET' })

/**
 * The directions a pick can start from.
 *
 * `read/root` answers with ONE card — the workspace, the single parentless
 * direction — which is the top of the graph and not a list of projects. What
 * the picker wants is the containers under it, so this asks for the root and
 * then for its direct children, and offers the root itself first so "everything"
 * is pickable too.
 */
export async function pickable() {
  const root = await call('/api/read/root', {}).catch(() => null)
  if (!root) return []
  const out = await call('/api/read/project', {
    filters: [{ under_parent: root.id }],
    shape: 'tree',
    sort: 'status_order',
    limit: 200,
  })
  // Everything under the root, not just the things that look like projects: a
  // work item with children is a perfectly good place to import a branch from,
  // and guessing which of somebody else's directions counts as a "project" is
  // exactly the kind of rule that is wrong for half of them.
  return [root, ...(out?.roots || []).map((n) => n.card)]
}

/**
 * The work items under one direction.
 *
 * `under_subtree` rather than `under_parent`: the picker offers a project's
 * work, and a task two levels down is still that project's work. Paginated by
 * the cursor Teleonomy hands back.
 */
export const workUnder = (parent, cursor = null) => call('/api/read/project', {
  filters: [{ under_subtree: parent }, { mode: 'do' }],
  shape: 'tree',
  sort: 'status_order',
  limit: 200,
  ...(cursor ? { cursor } : {}),
})

/** One direction, by id or by human code — `/d/TEL-142` resolves either. */
export const card = (idOrCode) => call(`/api/d/${encodeURIComponent(idOrCode)}`, {}, { method: 'GET' })

export const advance = (direction, to_status) => call('/api/verbs/advance', { direction, to_status })

/** `refine` merges the attribute bag; null removes a key. */
export const setDescription = (direction, text) => call('/api/verbs/refine', {
  direction,
  fields: { attrs: { description: text === '' ? null : text } },
})
