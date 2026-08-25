/**
 * Run the jsdom suites against the dev API.
 *
 * These are end-to-end: they drive the real built app in jsdom and talk to the
 * real server, because the bugs worth catching here are interaction bugs that a
 * green build and a passing curl both miss.
 *
 * Requires `npm run dev` to be up. Rows are created on far-future dates and
 * deleted by id at the end of each suite, so nothing of yours is touched — but
 * a suite killed part-way leaves its probe rows behind and the next run will
 * see them, so stop runs cleanly.
 *
 *   npm test                 all suites
 *   npm test batch27         one, or several
 */
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.PLANNER_API || 'http://localhost:8787'

const pick = process.argv.slice(2)
const all = readdirSync(HERE)
  .filter((f) => f.endsWith('.mjs') && !['run.mjs', 'build-iife.mjs'].includes(f))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
const suites = pick.length
  ? all.filter((f) => pick.some((p) => f === p || f === `${p}.mjs`))
  : all

if (!suites.length) {
  console.error(`No suites matched ${pick.join(', ')}. Available: ${all.join(', ')}`)
  process.exit(1)
}

// Fail fast and legibly rather than emitting a wall of parse errors from every
// suite in turn.
try {
  const res = await fetch(`${BASE}/api/settings`)
  if (!res.ok) throw new Error(String(res.status))
} catch {
  console.error(`Cannot reach the API at ${BASE}. Start it with \`npm run dev\`.`)
  process.exit(1)
}

const node = (file, args = []) =>
  spawnSync(process.execPath, [join(HERE, file), ...args], { stdio: 'inherit' })

console.log('Building an IIFE bundle for jsdom…')
if (node('build-iife.mjs').status !== 0) {
  console.error('The test build failed; nothing was run.')
  process.exit(1)
}

const failed = []
try {
  for (const suite of suites) {
    console.log(`\n── ${suite} ${'─'.repeat(Math.max(0, 56 - suite.length))}`)
    if (node(suite).status !== 0) failed.push(suite)
  }
} finally {
  // Always: leaving the IIFE bundle in place would ship a debug build.
  console.log('\nRestoring the production bundle…')
  spawnSync('npm', ['run', 'build'], { cwd: join(HERE, '..'), stdio: 'ignore' })
}

console.log(failed.length
  ? `\n${failed.length} suite(s) failed: ${failed.join(', ')}`
  : `\n${suites.length} suite(s) passed.`)
process.exit(failed.length ? 1 : 0)
