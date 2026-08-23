import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from './api.js'

const UndoContext = createContext(null)

export const useUndo = () => useContext(UndoContext)

const LIMIT = 100

/**
 * Undo/redo as a stack of inverse operations rather than snapshots — the app is
 * small enough that every mutation can describe how to reverse itself, and this
 * avoids holding copies of the whole day in memory.
 *
 * Ctrl/Cmd+Z undoes, Ctrl+Y (or Ctrl/Cmd+Shift+Z) redoes. Both are ignored
 * while a text field has focus so the browser's own text undo still works.
 */
export function UndoProvider({ children, onChange }) {
  const undoStack = useRef([])
  const redoStack = useRef([])
  const [, force] = useState(0)
  const bump = () => force((n) => n + 1)

  const record = useCallback((op) => {
    undoStack.current = [...undoStack.current.slice(-(LIMIT - 1)), op]
    redoStack.current = []
    bump()
  }, [])

  const run = useCallback(async (from, to, key) => {
    const op = from.current[from.current.length - 1]
    if (!op) return null
    from.current = from.current.slice(0, -1)
    await op[key]()
    to.current = [...to.current, op]
    bump()
    onChange?.()
    return op
  }, [onChange])

  const undo = useCallback(() => run(undoStack, redoStack, 'undo'), [run])
  const redo = useCallback(() => run(redoStack, undoStack, 'redo'), [run])

  useEffect(() => {
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey)) return

      // Yield to the browser's own text undo only where there is text to undo.
      // The old test was any INPUT at all, which meant that after editing a
      // title, setting a time or typing a duration — that is, after almost any
      // edit, because focus stays where you left it — Ctrl+Z did nothing and
      // the feature looked dead. Non-text controls have no native undo, so
      // they should fall through to ours.
      const el = document.activeElement
      const TEXTUAL = /^(text|search|url|email|password|tel|)$/
      const isTextField = !!el && (
        el.isContentEditable
        || el.tagName === 'TEXTAREA'
        || (el.tagName === 'INPUT' && TEXTUAL.test(el.getAttribute('type') || ''))
      )
      if (isTextField) return

      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const value = {
    record,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    nextUndoLabel: undoStack.current[undoStack.current.length - 1]?.label,
  }

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>
}

/**
 * Undo/redo as visible controls. The keyboard shortcut alone gave no way to
 * tell "nothing to undo" from "the shortcut is not working", and named the last
 * action nowhere — so the one reversible thing in the app was invisible.
 */
export function UndoButtons() {
  const u = useUndo()
  if (!u) return null

  return (
    <div className="sb-undo">
      <button
        className="btn ghost sm"
        disabled={!u.canUndo}
        onClick={u.undo}
        title={u.canUndo ? `Undo ${u.nextUndoLabel || 'last change'} (Ctrl+Z)` : 'Nothing to undo'}
      >
        <Icon name="undo" size={13} /> Undo
      </button>
      <button
        className="btn ghost sm"
        disabled={!u.canRedo}
        onClick={u.redo}
        title={u.canRedo ? 'Redo (Ctrl+Y)' : 'Nothing to redo'}
      >
        <Icon name="redo" size={13} />
      </button>
    </div>
  )
}

/**
 * Task mutations bound to an undo stack. `patch` captures the fields it is about
 * to overwrite so the inverse is exact, and `remove` reinstates the whole row —
 * including its id, so anything nested under it still points at the right parent.
 */
export function taskOps(undoCtx, refresh) {
  const record = undoCtx?.record

  return {
    async patch(task, changes, label) {
      const before = {}
      for (const k of Object.keys(changes)) before[k] = task[k] ?? null

      await api.patch(`/tasks/${task.id}`, changes)
      refresh()

      record?.({
        label: label || 'change',
        undo: async () => { await api.patch(`/tasks/${task.id}`, before) },
        redo: async () => { await api.patch(`/tasks/${task.id}`, changes) },
      })
    },

    async remove(task, label = 'delete') {
      const snapshot = await api.get(`/tasks/${task.id}`)
      await api.del(`/tasks/${task.id}`)
      refresh()

      const restore = async () => { await api.post('/tasks/restore', snapshot) }

      record?.({
        label,
        undo: restore,
        redo: async () => { await api.del(`/tasks/${snapshot.id}`) },
      })

      return restore
    },
  }
}
