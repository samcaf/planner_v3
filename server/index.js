import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import projects from './routes/projects.js'
import tasks from './routes/tasks.js'
import people from './routes/people.js'
import dashboard from './routes/dashboard.js'
import days from './routes/days.js'
import sections, { routinesRouter } from './routes/sections.js'
import search from './routes/search.js'
import notebook from './routes/notebook.js'
import settings from './routes/settings.js'
import uploads, { uploadDir, uploadHeaders } from './routes/uploads.js'
import auth, { gate } from './routes/auth.js'
import integrations from './routes/integrations.js'
import { withUser } from './db.js'
import { PUBLIC_PORT, TRUSTED_PORT } from './ports.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
/**
 * Loopback only — and BOTH spellings of it.
 *
 * This used to listen on every interface, which on a machine running Tailscale
 * means the whole tailnet could read and write the planner with no
 * authentication at all. Nothing needs to reach this port from outside the
 * machine: `tailscale serve` proxies to it and terminates TLS, and keeping the
 * socket on loopback is what makes it safe to believe what that proxy says
 * about a request.
 *
 * Both addresses, because `localhost` resolves to ::1 before 127.0.0.1 on a
 * modern Linux and Node's resolver order is `verbatim`. Binding only the IPv4
 * address would refuse every client that spells it `localhost` — which is the
 * Vite proxy, the MCP server, and all but one of the test suites. Two listeners
 * on one port with different addresses is ordinary.
 *
 * PLANNER_HOST overrides it with a single address, for a host where one of the
 * two does not exist or where something else fronts the app.
 */
const HOSTS = process.env.PLANNER_HOST ? [process.env.PLANNER_HOST] : ['127.0.0.1', '::1']

const app = express()
// Generous limit: pasted images arrive as base64 data URLs in the JSON body.
app.use(express.json({ limit: '30mb' }))

/**
 * The two things that must answer without a session, and then the gate.
 *
 * `/api/auth` is how you get a session, so it cannot need one. `/api/health` is
 * how something outside decides whether this is up at all, and an uptime check
 * that requires a login tells you nothing useful.
 *
 * Everything below is behind `gate`, which sets req.user or answers 401.
 */
app.use('/api/auth', auth)
app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.use('/api', gate, planner)

/**
 * Everything past the gate runs against the asking person's own planner.
 *
 * This is the whole of the per-person plumbing at the HTTP layer. Every route
 * below says `db.prepare(...)` exactly as it always did; which file that
 * reaches is decided here, once. The owner keeps the original database and the
 * original upload directory, so nothing on disk moved when this arrived.
 */
function planner(req, _res, next) {
  withUser(req.user && !req.user.is_owner ? req.user.slug : null, next)
}

// Attachments are served from this app's own origin, so anything the browser
// would render as a document must come back as a download instead. Behind the
// gate: an upload is somebody's content, and a content-addressed name is not a
// secret — anyone who has seen one could fetch it forever.
//
// A handler per directory rather than one for a fixed path, because the
// directory now depends on who is asking. They are memoised: express.static
// builds a send() pipeline, and rebuilding it per request would be waste.
const statics = new Map()
app.use('/uploads', gate, planner, (req, res, next) => {
  const dir = uploadDir(req.user && !req.user.is_owner ? req.user.slug : null)
  if (!statics.has(dir)) {
    statics.set(dir, express.static(dir, {
      maxAge: '30d', immutable: true, setHeaders: uploadHeaders,
    }))
  }
  return statics.get(dir)(req, res, next)
})

app.use('/api/projects', projects)
app.use('/api/tasks', tasks)
app.use('/api/people', people)
app.use('/api/dashboard', dashboard)
app.use('/api/days', days)
app.use('/api/sections', sections)
app.use('/api/routines', routinesRouter)
app.use('/api/search', search)
app.use('/api/notebook', notebook)
app.use('/api/settings', settings)
app.use('/api/uploads', uploads)
// Behind the gate and inside the per-user context, like everything else here:
// the connections and the linked set are this person's, in this person's file.
app.use('/api/integrations', integrations)

// In production the built frontend is served from the same origin, and
// deliberately NOT behind the gate: the login page is part of the app, so
// refusing the bundle to anyone without a session would mean nobody could ever
// get one. Nothing in the bundle is data.
const dist = join(root, 'web', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(join(dist, 'index.html'))
  })
}

// Any thrown error becomes a JSON response rather than an HTML stack page.
app.use((err, _req, res, _next) => {
  console.error(err)
  // `code` rides along when the caller set one. A refusal an agent has to act
  // on differently from a typo — a spent budget, say — should be recognisable
  // without matching on the wording of a sentence.
  const body = { error: err.message || 'server error' }
  if (err.code) body.code = err.code
  if (err.detail) body.detail = err.detail
  res.status(err.status || 500).json(body)
})

// Two ports, both on loopback, and they are not interchangeable — see ports.js.
// The public one is what `tailscale serve` is pointed at.
for (const [PORT, label] of [[TRUSTED_PORT, 'local'], [PUBLIC_PORT, 'served']]) {
for (const host of HOSTS) {
  const server = app.listen(PORT, host, () => {
    const at = host.includes(':') ? `[${host}]` : host
    console.log(`planner_v3 api  →  http://${at}:${PORT}  (${label})`)
  })
  // A machine with IPv6 turned off has no ::1 to bind. That is not a reason to
  // refuse to serve on the address that does exist — say so and carry on.
  server.on('error', (err) => {
    if (HOSTS.length > 1 && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(err.code)) {
      console.warn(`planner_v3 api  —  ${host} is unavailable (${err.code}), skipping it`)
      return
    }
    throw err
  })
}
}
