/**
 * The HTTP an adapter is likely to need.
 *
 * Not part of the adapter contract — an adapter may talk however it likes — but
 * every one written so far is JSON over HTTPS with a bearer token, and having
 * that in one place keeps the error handling honest rather than reinvented.
 */
export class ExternalError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** Trailing slashes are the difference between /api/x and /api//x, and one of
 *  those 404s. Normalise once, here. */
export const connect = (base, token) => ({
  base: String(base || '').replace(/\/+$/, ''),
  token: String(token || ''),
})

/**
 * One call. `body` null means GET; anything else is a JSON POST.
 *
 * A refusal that arrives as JSON with a code is an ANSWER, not a failure — the
 * far side saying the move was not legal. It is surfaced rather than swallowed,
 * because an adapter believing in a lifecycle that has since changed is exactly
 * the drift nothing here can otherwise detect.
 */
export async function call(conn, path, body = {}) {
  if (!conn?.base) throw new ExternalError('no server is configured', 400)

  const res = await fetch(conn.base + path, {
    method: body === null ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(conn.token ? { authorization: `Bearer ${conn.token}` } : {}),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  })

  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* not JSON; keep the text */ }

  if (!res.ok) {
    const why = data?.message || data?.error || text.slice(0, 200) || res.statusText
    throw new ExternalError(`${res.status}: ${why}`, res.status, data)
  }
  return data
}
