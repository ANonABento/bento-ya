/** Hook for managing the agent chat slide-in panel. */

import { useCallback, useEffect } from 'react'

import { useUIStore } from '@/stores/ui-store'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true
  if (target.isContentEditable) return true
  return false
}

export function useChatPanel() {
  const viewMode = useUIStore((s) => s.viewMode)
  const activeTaskId = useUIStore((s) => s.activeTaskId)
  const expandedTaskId = useUIStore((s) => s.expandedTaskId)
  const closeChatAction = useUIStore((s) => s.closeChat)
  const openChatAction = useUIStore((s) => s.openChat)
  const collapseTask = useUIStore((s) => s.collapseTask)
  const panelView = useUIStore((s) => s.panelView)
  const setPanelView = useUIStore((s) => s.setPanelView)
  const togglePanelView = useUIStore((s) => s.togglePanelView)

  const isChatOpen = viewMode === 'chat'

  // Open the detail view on a specific task (used by cards, command palette).
  const openDetail = useCallback(
    (taskId: string) => {
      setPanelView('detail')
      openChatAction(taskId)
    },
    [openChatAction, setPanelView],
  )

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

      // Cmd+I: toggle detail view on the active/focused task.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) {
        if (isEditableTarget(e.target)) return
        if (isChatOpen && activeTaskId) {
          e.preventDefault()
          togglePanelView()
          return
        }
        if (expandedTaskId) {
          e.preventDefault()
          setPanelView('detail')
          openChatAction(expandedTaskId)
        }
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
  }, [
    isChatOpen,
    expandedTaskId,
    activeTaskId,
    closeChatAction,
    openChatAction,
    collapseTask,
    togglePanelView,
    setPanelView,
  ])

  return {
    isChatOpen,
    activeTaskId,
    panelView,
    closeChat: closeChatAction,
    openDetail,
  }
}
