import { useCallback, useRef, useEffect } from 'react'

/**
 * Hook that bridges native DOM input events to React state.
 * WebDriver fires native events that React's synthetic system misses.
 * Attach the returned ref to an <input> and pass your setState setter.
 */
export function useNativeInput(onChange: (value: string) => void) {
  const ref = useRef<HTMLInputElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const handler = () => {
      onChangeRef.current(el.value)
    }

    // Listen for native 'input' events (fired by WebDriver)
    el.addEventListener('input', handler)
    return () => { el.removeEventListener('input', handler) }
  }, [])

  // Stable onChange for React's synthetic events
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChangeRef.current(e.target.value)
    },
    [],
  )

  return { ref, handleChange }
}
