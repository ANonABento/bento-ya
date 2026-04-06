/** Hook for managing the agent chat slide-in panel. */

import { useCallback, useEffect } from 'react'

import { useUIStore } from '@/stores/ui-store'

export function useChatPanel() {
  const viewMode = useUIStore((s) => s.viewMode)
  const activeTaskId = useUIStore((s) => s.activeTaskId)
  const expandedTaskId = useUIStore((s) => s.expandedTaskId)
  const closeChatAction = useUIStore((s) => s.closeChat)
  const collapseTask = useUIStore((s) => s.collapseTask)

  const isChatOpen = viewMode === 'chat'

  const closeChat = useCallback(() => {
    closeChatAction()
  }, [closeChatAction])

  // Esc key: close chat first, then collapse expanded card
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (isChatOpen) {
        e.preventDefault()
        closeChat()
      } else if (expandedTaskId) {
        e.preventDefault()
        collapseTask()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [isChatOpen, expandedTaskId, closeChat, collapseTask])

  return {
    isChatOpen,
    activeTaskId,
    closeChat,
  }
}
