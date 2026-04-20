/** Hook for managing the agent chat slide-in panel. */

import { useEffect } from 'react'

import { useUIStore } from '@/stores/ui-store'

export function useChatPanel() {
  const viewMode = useUIStore((s) => s.viewMode)
  const activeTaskId = useUIStore((s) => s.activeTaskId)
  const expandedTaskId = useUIStore((s) => s.expandedTaskId)
  const closeChatAction = useUIStore((s) => s.closeChat)
  const collapseTask = useUIStore((s) => s.collapseTask)

  const isChatOpen = viewMode === 'chat'

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return

      // Cmd+L: toggle agent chat panel
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault()
        if (isChatOpen) {
          closeChatAction()
          collapseTask()
        }
        // Opening requires a task — handled by card click, not shortcut
        return
      }

      // Esc: close chat + collapse card together (they open together)
      if (e.key === 'Escape') {
        if (isChatOpen) {
          e.preventDefault()
          closeChatAction()
          collapseTask()
        } else if (expandedTaskId) {
          e.preventDefault()
          collapseTask()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [isChatOpen, expandedTaskId, closeChatAction, collapseTask])

  return {
    isChatOpen,
    activeTaskId,
    closeChat: closeChatAction,
  }
}
