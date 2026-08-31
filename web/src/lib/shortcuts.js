/**
 * Every key and gesture the app answers to WITHOUT keyboard control on.
 *
 * One table, three readers: the `?` sheet, the Settings page's Keyboard tab,
 * and anyone trying to remember what a chord did. A shortcut documented in one
 * place and bound in another drifts within a week, so the tables live beside
 * nothing but each other and both surfaces render them.
 *
 * The mouse gestures are here because they are as invisible as a keystroke —
 * nothing on screen says that right-clicking a checkbox makes a task optional —
 * and a list of shortcuts that covered only the keyboard would leave out the
 * ones people actually fail to find.
 *
 * The keyboard-control table is NOT here: it lives in VimLayer, next to the
 * switch statement that binds it, for the same reason.
 *
 * KEEPING IT TRUE: a binding added to App.jsx's Shortcuts or to the `g` table
 * in lib/nav.js belongs in this file in the same change.
 */
export const GENERAL = [
  ['Everywhere', [
    ['Ctrl / ⌘ + /', 'search everything'],
    ['Ctrl / ⌘ + K', 'the same, unless you are in a text box'],
    ['Ctrl / ⌘ + Z', 'undo'],
    ['Ctrl / ⌘ + Shift + Z', 'redo'],
    ['Ctrl + Alt + V', 'turn keyboard control on or off'],
    ['Escape', 'close a menu, or leave a field'],
  ]],
  // The same letters mean the same thing with keyboard control on. That is the
  // point of them all starting with g: nothing here changes under you.
  ['Going places', [
    ['g then t', 'today'],
    ['g then d / w / m / n', 'day, week, month, notes — keeping the date you are on'],
    ['g then a / p / e', 'all tasks, projects, people'],
    ['g then r / u / b', 'routines, uploads, notebook'],
    ['g then h / s', 'the dashboard, settings'],
    ['?', 'the shortcut list'],
  ]],
  ['On a day', [
    ['← / →', 'the day before / after'],
    ['Ctrl-click the arrows', 'open that day in a new tab'],
  ]],
  ['While writing', [
    ['Ctrl / ⌘ + K', 'make a hyperlink'],
    ['Ctrl / ⌘ + J', 'hop between a link’s text and its url'],
    ['Ctrl / ⌘ + B  /  I', 'bold, italic'],
    ['Ctrl / ⌘ + Enter', 'save and close the editor'],
    ['[[', 'link a day, project or task'],
  ]],
  ['On the tasks you have picked', [
    ['click a row’s checkbox area', 'select it; shift-click takes the range'],
    ['Alt-↑ / Alt-↓', 'raise / lower the priority of everything selected'],
    ['x / i', 'done / in progress'],
    ['o / O', 'optional / committed'],
    ['b', 'send to the backlog'],
    ['Ctrl / ⌘ + A', 'select every task on the page'],
    ['Escape', 'drop the selection'],
  ]],
  ['On a task', [
    ['click the checkbox', 'done / not done'],
    ['right-click the checkbox', 'optional / committed'],
    ['shift-click the checkbox', 'drop / undrop'],
    ['Tab in the title', 'jump to the timing panel'],
    ['Enter', 'commit an edit and close the menu'],
    ['drag the middle of a row', 'nest it under that row'],
    ['drag near a row’s edge', 'reorder it there'],
  ]],
]
