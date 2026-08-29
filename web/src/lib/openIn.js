/**
 * Opening a thing, and doing it in a new tab.
 *
 * Two kinds of thing can be opened: a real link, and a card. A card is a whole
 * clickable panel — a project, say — which cannot be an <a> because it has
 * selects and buttons inside it, and nesting those in a link is invalid markup
 * that breaks them. So a card says where it goes with `data-open` instead, and
 * this is the one place that knows both spellings mean the same thing.
 *
 * `data-open` is also what makes something a stop in vim mode, so a card is
 * navigable by keyboard for the same reason it is shift-clickable: it declared
 * where it goes.
 */

/** Where clicking this element would take you, if anywhere. */
export function hrefOf(el) {
  if (!el) return null
  if (el.dataset?.open) return el.dataset.open
  return el.tagName === 'A' ? el.getAttribute('href') : null
}

/** The nearest thing under a click that knows where it goes. */
export const openable = (target) => target?.closest?.('a[href], [data-open]') || null

/**
 * Controls own their own clicks. A select or a button inside a card is not a
 * way of opening the card, and this listener runs in the capture phase — ahead
 * of the stopPropagation those controls use to defend themselves.
 */
const OWNS_ITS_CLICK = 'select, button, input, textarea, [contenteditable="true"]'

export function openTab(href) {
  if (!href) return false
  // noopener because the new tab gets no business with this one, and without
  // it the opened page can reach back through window.opener.
  window.open(href, '_blank', 'noopener,noreferrer')
  return true
}

/**
 * Shift-click opens in a new tab, everywhere.
 *
 * The browser's own shift-click opens a new *window*, and only for real links —
 * a card, which navigates from JavaScript, ignored the modifier entirely and
 * opened in the tab you were already in. One listener gives both the same
 * meaning.
 */
export function installShiftOpen() {
  const onClick = (e) => {
    if (!e.shiftKey || e.button !== 0) return
    // Ctrl/Cmd already mean new tab to the browser; leave them be.
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target.closest?.(OWNS_ITS_CLICK)) return

    const el = openable(e.target)
    const href = hrefOf(el)
    if (!href || href.startsWith('#')) return

    e.preventDefault()
    e.stopPropagation()
    openTab(href)
  }

  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
