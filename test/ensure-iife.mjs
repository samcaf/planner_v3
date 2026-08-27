/**
 * Fail loudly when the bundle jsdom is about to load cannot run in it.
 *
 * jsdom executes no ES modules, so against the production build every page is
 * blank — and a blank page fails every check with a plausible-looking message
 * ("no cursor", "row not found") that says nothing about the real cause. This
 * has cost real time twice; importing it for its side effect costs one line.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = readFileSync(join(ROOT, 'web', 'dist', 'index.html'), 'utf8')

if (/<script[^>]*type="module"/.test(html)) {
  console.error(
    'The build in web/dist is the production ESM bundle, which jsdom cannot run.\n'
    + 'Run `node test/build-iife.mjs` first, or use `npm test`, which does it for you.',
  )
  process.exit(1)
}
