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
import uploads, { UPLOAD_DIR, uploadHeaders } from './routes/uploads.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const PORT = Number(process.env.PORT || 8787)

const app = express()
// Generous limit: pasted images arrive as base64 data URLs in the JSON body.
app.use(express.json({ limit: '30mb' }))

// Attachments are served from this app's own origin, so anything the browser
// would render as a document must come back as a download instead.
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '30d', immutable: true, setHeaders: uploadHeaders,
}))

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

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// In production the built frontend is served from the same origin.
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

app.listen(PORT, () => {
  console.log(`planner_v3 api  →  http://localhost:${PORT}`)
})
