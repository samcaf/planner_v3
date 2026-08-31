/**
 * Nicknames, for pages and for URLs.
 *
 * A project lives at /projects/17 and a day at /day/2026-08-29, which are
 * addresses rather than names. A nickname is a word you choose for somewhere
 * you keep coming back to, so `:goto thesis` gets you there without knowing the
 * number. They are kept in settings, beside everything else the app remembers,
 * so they follow you between browsers rather than living in one.
 *
 * TWO stores, not one, and the difference is not filing. A page name resolves
 * to a route this app renders, so it is followed with the router and the tab
 * stays where it is. A link name resolves to somewhere else entirely: nothing
 * here can draw it, so following one means LEAVING, which is a different enough
 * act to be worth a different word for saving it. `:goto` reads both, because
 * from where you are sitting they are the same gesture.
 *
 * The names themselves share a namespace: one word, one destination, whichever
 * kind. Two things answering to "repo" would be a coin toss every time.
 */
import { api } from './api.js'

/** Case and stray quotes do not matter: `:goto "Deep Work"` finds `deep work`. */
export const normalise = (s) => String(s || '')
  .trim()
  .replace(/^["'](.*)["']$/s, '$1')
  .trim()
  .toLowerCase()

/**
 * One store of nicknames, kept in settings under `key`.
 *
 * Both stores are the same shape and the same three operations, so they are
 * built rather than written twice — which is also what stops one of them
 * growing a fix the other does not get.
 */
function store(key) {
  return {
    async load() {
      const all = await api.get('/settings').catch(() => null)
      try {
        const parsed = JSON.parse(all?.[key] || '{}')
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    },
    save: (names) => api.patch('/settings', { [key]: JSON.stringify(names) }),
  }
}

const pages = store('page_names')
const links = store('link_names')

export const loadNames = () => pages.load()
export const saveNames = (names) => pages.save(names)

export const loadLinks = () => links.load()
export const saveLinks = (names) => links.save(names)

/** Both stores at once, for the things that do not care which kind it is. */
export async function loadAll() {
  const [page, link] = await Promise.all([pages.load(), links.load()])
  return { page, link }
}

/** Every name pointing at a path — usually none or one, but nothing forbids two. */
export const namesFor = (names, path) => Object.entries(names)
  .filter(([, p]) => p === path)
  .map(([n]) => n)

/**
 * What you typed, as something a browser will accept.
 *
 * A URL copied from the address bar arrives whole, but one typed from memory is
 * usually `github.com/me/thing` — which a browser reads as a relative path and
 * resolves against this app, landing you on a page that does not exist. The
 * same rule the markdown renderer uses: a bare host has a dot in it.
 *
 * Returns null for anything that could not be a URL at all, so a caller can say
 * so rather than storing a nickname that goes nowhere.
 */
export function asUrl(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  // Anything else with a scheme is not ours to guess at — mailto:, obsidian:,
  // a file path — so it is stored as typed and the browser decides.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw
  const [head] = raw.split(/[/?#]/, 1)
  return head.includes('.') ? `https://${raw}` : null
}
