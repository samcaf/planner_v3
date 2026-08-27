/**
 * Where `g` then a letter goes.
 *
 * Its own module rather than a corner of App.jsx: the keyboard layer needs it
 * too, and importing it from App — which imports the keyboard layer — is a
 * cycle. It happens to work today because nothing reads the table until a key
 * is pressed, which is exactly the kind of thing that stops working later.
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

/** The date the current path is anchored to, or today. */
export function anchorOf(pathname, today) {
  const [, , date] = pathname.split('/')
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today
}
