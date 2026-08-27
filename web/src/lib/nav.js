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
  n: '/notebook',
  h: '/dashboard',
}
