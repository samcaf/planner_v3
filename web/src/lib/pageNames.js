/**
 * Nicknames for pages.
 *
 * A project lives at /projects/17 and a day at /day/2026-08-29, which are
 * addresses rather than names. A nickname is a word you choose for a page you
 * keep coming back to, so `:goto thesis` gets you there without knowing the
 * number. They are kept in settings, beside everything else the app remembers,
 * so they follow you between browsers rather than living in one.
 */
import { api } from './api.js'

const KEY = 'page_names'

/** Case and stray quotes do not matter: `:goto "Deep Work"` finds `deep work`. */
export const normalise = (s) => String(s || '')
  .trim()
  .replace(/^["'](.*)["']$/s, '$1')
  .trim()
  .toLowerCase()

export async function loadNames() {
  const all = await api.get('/settings').catch(() => null)
  try {
    const parsed = JSON.parse(all?.[KEY] || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const saveNames = (names) => api.patch('/settings', { [KEY]: JSON.stringify(names) })

/** Every name pointing at a path — usually none or one, but nothing forbids two. */
export const namesFor = (names, path) => Object.entries(names)
  .filter(([, p]) => p === path)
  .map(([n]) => n)
