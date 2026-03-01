import { useEffect, useCallback } from 'react'

type ShortcutHandler = () => void

type ShortcutConfig = {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  handler: ShortcutHandler
  preventDefault?: boolean
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase()
        const ctrlMatch = shortcut.ctrl ? event.ctrlKey : !event.ctrlKey || shortcut.meta
        const metaMatch = shortcut.meta ? event.metaKey : !event.metaKey || shortcut.ctrl
        const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey
        const altMatch = shortcut.alt ? event.altKey : !event.altKey

        // For Cmd/Ctrl shortcuts, allow either
        const modifierMatch = shortcut.meta || shortcut.ctrl
          ? (event.metaKey || event.ctrlKey) && shiftMatch && altMatch
          : ctrlMatch && metaMatch && shiftMatch && altMatch

        if (keyMatch && modifierMatch) {
          if (shortcut.preventDefault !== false) {
            event.preventDefault()
          }
          shortcut.handler()
          break
        }
      }
    },
    [shortcuts],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}

// Common shortcut patterns
export function useEscapeKey(handler: ShortcutHandler) {
  useKeyboardShortcuts([{ key: 'Escape', handler }])
}

export function useCommandKey(key: string, handler: ShortcutHandler) {
  useKeyboardShortcuts([{ key, meta: true, handler }])
}
