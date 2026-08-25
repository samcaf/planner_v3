/**
 * Build the app as an IIFE and point index.html at it.
 *
 * jsdom cannot execute `<script type="module">`, so the production ESM bundle
 * loads as a blank page under test — and every check then "passes" against an
 * empty document, which is worse than failing. This emits a single classic
 * script and rewrites the tag to match.
 *
 * `npm test` does this first and restores the real bundle afterwards; run
 * `npm run build` by hand if you stop a run part-way through.
 */
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  root: join(ROOT, 'web'),
  configFile: false,
  plugins: [react()],
  logLevel: 'error',
  build: {
    outDir: join(ROOT, 'web', 'dist'),
    emptyOutDir: true,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
})

const index = join(ROOT, 'web', 'dist', 'index.html')
const html = readFileSync(index, 'utf8')
const patched = html.replace(/<script type="module"([^>]*)>/g, '<script$1>')
if (patched === html) throw new Error('no module script tag found — has the build shape changed?')
writeFileSync(index, patched)
