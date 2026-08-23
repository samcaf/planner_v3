import { Router } from 'express'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { badRequest, h, notFound } from './_helpers.js'

const here = dirname(fileURLToPath(import.meta.url))
export const UPLOAD_DIR = join(here, '..', '..', 'data', 'uploads')

mkdirSync(UPLOAD_DIR, { recursive: true })

const MAX_BYTES = 20 * 1024 * 1024

/**
 * Types worth naming properly. Anything absent still uploads — the extension
 * then comes from the supplied filename — so this is a nicety, not a gate.
 */
const EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  // Listed so files uploaded before svg was refused still resolve to a type;
  // uploading one now is rejected below.
  'image/svg+xml': 'svg',

  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/rtf': 'rtf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',

  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/x-tar': 'tar',
  'application/x-7z-compressed': '7z',
}

const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]))

/** Extensions the browser is allowed to render in place — images, and no more. */
const INLINE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'])

/**
 * Uploads are served from this app's own origin, so anything the browser
 * renders as a *document* runs script with the planner's cookies and API within
 * reach. Nothing here inspects file contents, so the only reliable answer for
 * these is to refuse to store them at all — an `.svg` is markup, and an `.xml`
 * can carry an XSLT stylesheet that is markup by another route.
 *
 * Everything else is fine: a PDF's own scripting runs in the viewer's sandbox,
 * not in this origin, and a `.js` or `.csv` is displayed, never executed.
 */
const DANGEROUS_EXT = new Set([
  'svg', 'svgz', 'html', 'htm', 'xhtml', 'xht', 'shtml', 'mhtml', 'mht', 'xml', 'xsl', 'xslt',
])

const DANGEROUS_MIME = new Set([
  'image/svg+xml', 'text/html', 'application/xhtml+xml', 'application/xml', 'text/xml',
  'application/xslt+xml', 'multipart/related',
])

/**
 * Uploads are content-addressed, so a legitimate name is always 16 hex digits
 * and a short lowercase-alphanumeric extension — a shape with no way to express
 * a separator, a dot segment or a percent escape. Widening what may be *stored*
 * deliberately did not widen this: the extension is generated from a lookup or
 * a scrubbed suffix, never taken from user input verbatim, so matching this
 * exactly is still what keeps `..%2F..%2Fetc` out of every path we join.
 */
const SAFE_NAME = /^[0-9a-f]{16}\.[a-z0-9]{1,12}$/

/* ----------------------------------------------------------- name index */

/**
 * Content-addressing gives every file a hash for a name, which throws away the
 * one thing a non-image attachment needs: what it was called. A sidecar JSON
 * index carries that and nothing else. A table would mean a schema migration
 * and a second source of truth for what exists, when the directory already is
 * that source of truth — the index only decorates it, and a missing or corrupt
 * one costs display polish rather than files.
 */
const INDEX_FILE = join(UPLOAD_DIR, 'index.json')

function readIndex() {
  try {
    const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

// Through a temp file: a torn write would take every display name with it, and
// a rename within one directory is atomic where a partial write is not.
function writeIndex(index) {
  try {
    const tmp = `${INDEX_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(index, null, 2))
    renameSync(tmp, INDEX_FILE)
  } catch { /* the labels are a convenience; the files are what matter */ }
}

/* ------------------------------------------------------------- naming */

/**
 * Display only — the stored name is always generated, so this never reaches the
 * filesystem. It is still scrubbed, because it is echoed into markdown link
 * text, where a newline or a bracket would be read as syntax rather than name.
 */
function displayName(filename, fallback) {
  const clean = String(filename || '')
    .split(/[\\/]/).pop()
    // Tabs and newlines collapse rather than vanish, so words stay apart; the
    // bracket pair goes, since it would close a markdown label early.
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, '')
    // A leading run of dots would display as `..`, which reads like a path.
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  return clean || fallback
}

/** The filename's own suffix, scrubbed to the alphabet SAFE_NAME allows. */
function extFromFilename(filename) {
  const tail = /\.([A-Za-z0-9]{1,12})$/.exec(String(filename || '').split(/[\\/]/).pop() || '')
  return tail ? tail[1].toLowerCase() : ''
}

/* ------------------------------------------------------------- routes */

const r = Router()

/**
 * Accepts a data URL (what the clipboard and a file input both give us) and
 * writes it under data/uploads, returning a URL to embed in markdown.
 * Content-addressed, so attaching the same file twice costs one file.
 */
r.post('/', h((req) => {
  const { data, filename } = req.body || {}
  if (typeof data !== 'string') throw badRequest('data URL required')

  // The mime is optional: a file the OS has no type for reads back as `data:;`.
  const match = /^data:([\w/+.-]*)(?:;[\w.-]+=[^;,]*)*;base64,(.*)$/s.exec(data)
  if (!match) throw badRequest('expected a base64 data URL')

  const mime = (match[1] || 'application/octet-stream').toLowerCase()
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length) throw badRequest('file is empty')
  if (bytes.length > MAX_BYTES) throw badRequest('file is larger than 20MB')

  const ext = EXT[mime] || extFromFilename(filename) || 'bin'
  // Both are checked: a `.svg` can arrive labelled octet-stream, and a `text/html`
  // can arrive named `notes.txt`. Either one alone would let the other through.
  const blocked = DANGEROUS_MIME.has(mime) ? mime : DANGEROUS_EXT.has(ext) ? `.${ext}` : null
  if (blocked) {
    throw badRequest(`${blocked} renders as markup in this app's own origin, so it cannot be stored — zip it first`)
  }

  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`
  if (!existsSync(join(UPLOAD_DIR, name))) writeFileSync(join(UPLOAD_DIR, name), bytes)

  const index = readIndex()
  // Identical bytes are one file, so a re-upload under a different name keeps
  // the first: notes already link the original label, and rewriting it would
  // leave those links disagreeing with the uploads page.
  if (!index[name]) {
    index[name] = { filename: displayName(filename, name), mime }
    writeIndex(index)
  }

  return entry(name, index)
}))

/** One listing row. Falls back to the on-disk name when the index has nothing. */
function entry(name, index) {
  const { size, mtimeMs } = statSync(join(UPLOAD_DIR, name))
  const saved = index[name] || {}
  const ext = name.slice(name.lastIndexOf('.') + 1)
  return {
    name,
    url: `/uploads/${name}`,
    bytes: size,
    mtime: new Date(mtimeMs).toISOString(),
    filename: saved.filename || name,
    mime: saved.mime || MIME_BY_EXT[ext] || 'application/octet-stream',
  }
}

r.get('/', h(() => {
  if (!existsSync(UPLOAD_DIR)) return []
  const index = readIndex()
  return readdirSync(UPLOAD_DIR)
    .filter((name) => SAFE_NAME.test(name))
    .map((name) => entry(name, index))
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
}))

r.delete('/:name', h((req) => {
  const { name } = req.params
  if (!SAFE_NAME.test(name)) throw badRequest('not a valid upload name')

  const file = join(UPLOAD_DIR, name)
  // SAFE_NAME already makes a separator impossible, so this can never fire
  // today. It is here as the thing a future change to the name shape trips
  // over, rather than silently unlinking outside the uploads directory.
  if (dirname(resolve(file)) !== resolve(UPLOAD_DIR)) throw badRequest('not a valid upload name')
  if (!existsSync(file)) throw notFound('no such upload')

  unlinkSync(file)
  const index = readIndex()
  if (index[name]) { delete index[name]; writeIndex(index) }

  return { ok: true, deleted: name }
}))

/**
 * `setHeaders` for the static mount. Uploads live on the app's own origin, so
 * whatever the browser renders inline renders *there* — refusing markup at the
 * door (above) is the first half of that, and handing everything non-image over
 * as an opaque download is the second, which also covers files stored before
 * the door was closed.
 *
 * Wire it into server/index.js:
 *   app.use('/uploads', express.static(UPLOAD_DIR, {
 *     maxAge: '30d', immutable: true, setHeaders: uploadHeaders,
 *   }))
 */
export function uploadHeaders(res, path) {
  res.setHeader('X-Content-Type-Options', 'nosniff')

  const name = path.slice(path.lastIndexOf('/') + 1)
  if (INLINE_EXT.has(name.slice(name.lastIndexOf('.') + 1))) return

  // The stored name is a hash, so the original goes on the download itself —
  // otherwise every attachment saves as `a1b2c3….pdf`.
  const filename = readIndex()[name]?.filename
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader(
    'Content-Disposition',
    filename ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` : 'attachment'
  )
}

export default r
