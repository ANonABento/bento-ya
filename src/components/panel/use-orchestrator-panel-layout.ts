import { useState, useEffect, useRef, useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import { useUIStore } from '@/stores/ui-store'

const COLLAPSED_HEIGHT = 40

export function useOrchestratorPanelLayout() {
  const panelHeight = useUIStore((s) => s.panelHeight)
  const panelWidth = useUIStore((s) => s.panelWidth)
  const panelDock = useUIStore((s) => s.panelDock)
  const isPanelCollapsed = useUIStore((s) => s.isPanelCollapsed)
  const setPanelHeight = useUIStore((s) => s.setPanelHeight)
  const setPanelWidth = useUIStore((s) => s.setPanelWidth)
  const setPanelDock = useUIStore((s) => s.setPanelDock)
  const togglePanel = useUIStore((s) => s.togglePanel)

  const [isDragging, setIsDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)
  const isRightDock = panelDock === 'right'

  const handleResizeMouseDown = useCallback((e: ReactMouseEvent) => {
    if (isPanelCollapsed) return
    e.preventDefault()
    e.stopPropagation()
    dragStartY.current = isRightDock ? e.clientX : e.clientY
    dragStartHeight.current = isRightDock ? panelWidth : panelHeight
    setIsDragging(true)
  }, [isPanelCollapsed, isRightDock, panelHeight, panelWidth])

  const handleHeaderClick = useCallback((e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    togglePanel()
  }, [togglePanel])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [togglePanel])

  useEffect(() => {
    if (!isDragging) return

    document.body.style.cursor = isRightDock ? 'ew-resize' : 'ns-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (isRightDock) {
        const deltaX = dragStartY.current - e.clientX
        setPanelWidth(dragStartHeight.current + deltaX)
        return
      }

      const deltaY = dragStartY.current - e.clientY
      setPanelHeight(dragStartHeight.current + deltaY)
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
  }, [isDragging, isRightDock, setPanelHeight, setPanelWidth])

  useEffect(() => {
    setPanelHeight(panelHeight)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- clamp once on mount

  useEffect(() => {
    const handleResize = () => {
      const state = useUIStore.getState()
      setPanelHeight(state.panelHeight)
      setPanelWidth(state.panelWidth)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [setPanelHeight, setPanelWidth])

  return {
    panelRef,
    panelDock,
    isPanelCollapsed,
    isRightDock,
    isDragging,
    displayHeight: isPanelCollapsed ? COLLAPSED_HEIGHT : (isRightDock ? undefined : panelHeight),
    displayWidth: isPanelCollapsed ? COLLAPSED_HEIGHT : (isRightDock ? panelWidth : undefined),
    setPanelDock,
    togglePanel,
    handleResizeMouseDown,
    handleHeaderClick,
  }
}
