/** Hook for managing board/task split view layout. */

import { useCallback, useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'

export function useSplitView() {
  const viewMode = useUIStore((s) => s.viewMode)
  const activeTaskId = useUIStore((s) => s.activeTaskId)
  const openTask = useUIStore((s) => s.openTask)
  const closeTask = useUIStore((s) => s.closeTask)

  const isSplitView = viewMode === 'split'

  const openSplitView = useCallback(
    (taskId: string) => {
      openTask(taskId)
    },
    [openTask],
  )

  const closeSplitView = useCallback(() => {
    closeTask()
  }, [closeTask])

  // Esc key closes split view
  useEffect(() => {
    if (!isSplitView) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeSplitView()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [isSplitView, closeSplitView])

  return {
    isSplitView,
    activeTaskId,
    openSplitView,
    closeSplitView,
  }
}
