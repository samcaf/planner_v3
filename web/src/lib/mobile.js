import { useEffect, useState } from 'react'

/**
 * Is this the phone layout?
 *
 * The same 700px the stylesheet's `@media (max-width: 700px)` block uses, so
 * "mobile" means one thing whether it is CSS or a component deciding. When one
 * of them moves, they both move.
 *
 * It is a width and not `(hover: none)` deliberately: what is being asked is
 * whether the phone layout is up — the drawer, the single column, the small
 * bar — not whether a finger is doing the pointing. A touchscreen laptop is
 * not a phone.
 */
export const PHONE = '(max-width: 700px)'

const ask = () => {
  try { return !!window.matchMedia?.(PHONE).matches } catch { return false }
}

export function useMobile() {
  const [is, setIs] = useState(ask)
  useEffect(() => {
    const m = window.matchMedia?.(PHONE)
    if (!m) return
    const heard = () => setIs(m.matches)
    heard()
    m.addEventListener('change', heard)
    return () => m.removeEventListener('change', heard)
  }, [])
  return is
}
