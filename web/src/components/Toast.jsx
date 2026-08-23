import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import Icon from './Icon.jsx'

const ToastContext = createContext(() => {})

export const useToast = () => useContext(ToastContext)

const LIFETIME_MS = 15000

/**
 * Transient confirmations that can carry an action — used for undoing a delete.
 * Each fades on its own after 15s, or goes away when dismissed.
 */
export function ToastHost({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((toast) => {
    // Date.now alone can collide when two land in the same millisecond.
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts((list) => [...list, { ...toast, id }])
    return id
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-host">
          {toasts.map((t) => <Toast key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
        </div>
      )}
    </ToastContext.Provider>
  )
}

function Toast({ toast, onDismiss }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // Start the fade slightly before removal so it doesn't vanish abruptly.
    const fade = setTimeout(() => setLeaving(true), LIFETIME_MS - 400)
    const kill = setTimeout(onDismiss, LIFETIME_MS)
    return () => { clearTimeout(fade); clearTimeout(kill) }
  }, [onDismiss])

  return (
    <div className={`toast ${leaving ? 'is-leaving' : ''}`} role="status">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          className="toast-action"
          onClick={() => { toast.action.onClick(); onDismiss() }}
        >
          {toast.action.label}
        </button>
      )}
      <button className="toast-x" onClick={onDismiss} aria-label="Dismiss">
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
