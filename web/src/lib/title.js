import { useEffect } from 'react'

const APP = 'Planner'

/**
 * What the browser tab says.
 *
 * Every page used to read "Planner", which is useless the moment more than one
 * is open — and this app is built to have several days open side by side, which
 * is exactly when you cannot tell them apart.
 *
 * The app name comes last so the distinguishing part survives the truncation a
 * narrow tab applies from the right.
 */
export function usePageTitle(what) {
  useEffect(() => {
    document.title = what ? `${what} · ${APP}` : APP
    // Back to the plain name on unmount, so a page that sets nothing does not
    // inherit the last one's title.
    return () => { document.title = APP }
  }, [what])
}

/** dd-mm-yy, which is what the user asked a day's tab to read. */
export function tabDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? `${m[3]}-${m[2]}-${m[1].slice(2)}` : (iso || '')
}
