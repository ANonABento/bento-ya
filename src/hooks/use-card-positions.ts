import { createContext, useContext, useCallback, useRef, useEffect, useState } from 'react'

type CardRect = { x: number; y: number; width: number; height: number }

type CardPositionContextValue = {
  registerCard: (taskId: string, element: HTMLElement | null) => void
  positions: Map<string, CardRect>
}

export const CardPositionContext = createContext<CardPositionContextValue>({
  registerCard: () => {},
  positions: new Map(),
})

export function useCardPositionProvider() {
  const refs = useRef(new Map<string, HTMLElement>())
  const [positions, setPositions] = useState(new Map<string, CardRect>())
  const rafRef = useRef<number>(0)

  const updatePositions = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const boardEl = document.querySelector('[data-board-scroll]')
      const boardRect = boardEl?.getBoundingClientRect()
      if (!boardRect) return

      const next = new Map<string, CardRect>()
      refs.current.forEach((el, taskId) => {
        const rect = el.getBoundingClientRect()
        next.set(taskId, {
          x: rect.x - boardRect.x,
          y: rect.y - boardRect.y,
          width: rect.width,
          height: rect.height,
        })
      })

      // Skip update if nothing changed (avoid re-renders on every scroll tick)
      setPositions((prev) => {
        if (prev.size !== next.size) return next
        for (const [id, r] of next) {
          const p = prev.get(id)
          if (!p || p.x !== r.x || p.y !== r.y || p.width !== r.width || p.height !== r.height) return next
        }
        return prev
      })
    })
  }, [])

  const registerCard = useCallback((taskId: string, element: HTMLElement | null) => {
    if (element) {
      refs.current.set(taskId, element)
    } else {
      refs.current.delete(taskId)
    }
    updatePositions()
  }, [updatePositions])

  // Update on scroll and resize
  useEffect(() => {
    const boardEl = document.querySelector('[data-board-scroll]')
    if (!boardEl) return

    const observer = new ResizeObserver(updatePositions)
    observer.observe(boardEl)
    boardEl.addEventListener('scroll', updatePositions)
    window.addEventListener('resize', updatePositions)

    // Initial update
    updatePositions()

    return () => {
      observer.disconnect()
      boardEl.removeEventListener('scroll', updatePositions)
      window.removeEventListener('resize', updatePositions)
      cancelAnimationFrame(rafRef.current)
    }
  }, [updatePositions])

  return { registerCard, positions }
}

export function useCardPosition() {
  return useContext(CardPositionContext)
}
