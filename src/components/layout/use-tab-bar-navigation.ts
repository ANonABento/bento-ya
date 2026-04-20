import { useCallback, useEffect } from 'react'
import { useSwipeNavigation } from '@/hooks/use-swipe'
import type { Workspace } from '@/types'

type UseTabBarNavigationArgs = {
  sortedWorkspaces: Workspace[]
  activeWorkspaceId: string | null
  setActive: (workspaceId: string) => void
  remove: (workspaceId: string) => Promise<void> | void
  openAddDialog: () => void
}

export function useTabBarNavigation({
  sortedWorkspaces,
  activeWorkspaceId,
  setActive,
  remove,
  openAddDialog,
}: UseTabBarNavigationArgs) {
  const selectByIndex = useCallback((index: number) => {
    const workspace = sortedWorkspaces[index]
    if (workspace) {
      setActive(workspace.id)
    }
  }, [sortedWorkspaces, setActive])

  const selectPrev = useCallback(() => {
    const currentIndex = sortedWorkspaces.findIndex((w) => w.id === activeWorkspaceId)
    const newIndex = currentIndex > 0 ? currentIndex - 1 : sortedWorkspaces.length - 1
    selectByIndex(newIndex)
  }, [sortedWorkspaces, activeWorkspaceId, selectByIndex])

  const selectNext = useCallback(() => {
    const currentIndex = sortedWorkspaces.findIndex((w) => w.id === activeWorkspaceId)
    const newIndex = currentIndex < sortedWorkspaces.length - 1 ? currentIndex + 1 : 0
    selectByIndex(newIndex)
  }, [sortedWorkspaces, activeWorkspaceId, selectByIndex])

  const closeCurrentTab = useCallback(() => {
    if (activeWorkspaceId && sortedWorkspaces.length > 1) {
      void remove(activeWorkspaceId)
    }
  }, [activeWorkspaceId, sortedWorkspaces.length, remove])

  useSwipeNavigation(selectPrev, selectNext, sortedWorkspaces.length > 1)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey

      if (isMod && !e.shiftKey) {
        if (e.key >= '1' && e.key <= '9') {
          e.preventDefault()
          const index = parseInt(e.key, 10) - 1
          selectByIndex(index)
          return
        }

        if (e.key === 't') {
          e.preventDefault()
          openAddDialog()
          return
        }

        if (e.key === 'w') {
          e.preventDefault()
          closeCurrentTab()
          return
        }
      }

      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          selectPrev()
        } else {
          selectNext()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [closeCurrentTab, openAddDialog, selectByIndex, selectNext, selectPrev])

  return {
    closeCurrentTab,
    selectNext,
    selectPrev,
  }
}
