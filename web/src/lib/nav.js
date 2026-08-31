/**
 * Where `g` then a letter goes.
 *
 * Its own module rather than a corner of App.jsx: the keyboard layer needs it
 * too, and importing it from App — which imports the keyboard layer — is a
 * cycle. It happens to work today because nothing reads the table until a key
 * is pressed, which is exactly the kind of thing that stops working later.
 *
 * ONE table, read by both layers. Keyboard control and the plain app used to
 * keep their own idea of where the letters went, so `t` meant "today" in one
 * and "optional" in the other — a key that changes meaning depending on a mode
 * you cannot see is worse than no key at all. Everything you can go to now
 * starts with `g`, in both.
 */
export const GO_TO = {
  p: '/projects',
  e: '/people',
  a: '/tasks',
  r: '/routines',
  u: '/uploads',
  // The notebook moved to b — n belongs to the notes page, so that the four
  // dated views sit together under one prefix.
  b: '/notebook',
  h: '/dashboard',
  s: '/settings',
}

/**
 * The dated views, which need the date you are on rather than a fixed path.
 *
 * Under the same `g` as everything else so there is one way to go somewhere,
 * and so a bare `d` or `w` is free for the keyboard to use on a task.
 */
export const GO_DATED = { d: 'day', w: 'week', m: 'month', n: 'notes' }

/**
 * `gt` — the Today page, at today's date rather than at the date you are on.
 *
 * It is the one destination that is a moment rather than a view, which is why
 * it cannot be a `GO_DATED` entry: those keep your place in the calendar and
 * this one deliberately does not. The bare `t` it replaces could not exist in
 * keyboard control, where `t` marks a task optional — so it moved under `g`
 * with everything else rather than meaning two things.
 */
export const GO_TODAY = 't'

/** The date the current path is anchored to, or today. */
export function anchorOf(pathname, today) {
  const [, , date] = pathname.split('/')
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today
}

/**
 * Where `g` then `k` should take you, or null if that letter goes nowhere.
 *
 * The whole `g` table in one function, so the two layers that answer `g`
 * cannot disagree about a letter. `today` is passed in rather than read here
 * because the day view resolves its own date and this module has no clock.
 */
export function goTarget(key, { pathname, today }) {
  if (key === GO_TODAY) return `/day/${today}`
  if (GO_TO[key]) return GO_TO[key]
  const dated = GO_DATED[key]
  return dated ? `/${dated}/${anchorOf(pathname, today)}` : null
}
