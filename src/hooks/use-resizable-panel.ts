/**
 * Shared hook for drag-to-resize panel behavior.
 * Used by both orchestrator (chef) and agent chat panels.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

type ResizeDirection = 'horizontal' | 'vertical'

type UseResizablePanelOptions = {
  /** Resize axis */
  direction: ResizeDirection
  /** Current size (width or height) */
  size: number
  /** Callback to update size */
  onResize: (size: number) => void
  /** Whether resize is disabled (e.g. panel collapsed) */
  disabled?: boolean
  /** Invert drag direction (true = drag toward start grows panel) */
  invert?: boolean
}

export function useResizablePanel({
  direction,
  size,
  onResize,
  disabled = false,
  invert = true,
}: UseResizablePanelOptions) {
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef(0)
  const dragStartSize = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    dragStart.current = direction === 'horizontal' ? e.clientX : e.clientY
    dragStartSize.current = size
    setIsDragging(true)
  }, [size, disabled, direction])

  useEffect(() => {
    if (!isDragging) return

    const cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      const current = direction === 'horizontal' ? e.clientX : e.clientY
      const delta = invert
        ? dragStart.current - current
        : current - dragStart.current
      onResize(dragStartSize.current + delta)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, direction, invert, onResize])

  return { handleMouseDown, isDragging }
}
