import { useEffect } from 'react'
import { listen } from '@/lib/ipc'
import { getWorkspaceEventId, type WorkspaceScopedEventPayload } from '@/types/events'

export function useOrchestratorTaskRefresh(
  workspaceId: string,
  refreshTasks: (workspaceId: string) => Promise<void>,
) {
  useEffect(() => {
    const unsubscribes: Array<() => void> = []

    const setupListeners = async () => {
      const refreshIfMatches = (payload: WorkspaceScopedEventPayload) => {
        if (getWorkspaceEventId(payload) === workspaceId) {
          void refreshTasks(workspaceId)
        }
      }

      const unsubTaskCreated = await listen<WorkspaceScopedEventPayload>(
        'task:created',
        refreshIfMatches,
      )
      unsubscribes.push(unsubTaskCreated)

      const unsubTaskUpdated = await listen<WorkspaceScopedEventPayload>(
        'task:updated',
        refreshIfMatches,
      )
      unsubscribes.push(unsubTaskUpdated)

      const unsubTaskDeleted = await listen<WorkspaceScopedEventPayload>(
        'task:deleted',
        refreshIfMatches,
      )
      unsubscribes.push(unsubTaskDeleted)
    }

    void setupListeners()

    return () => {
      unsubscribes.forEach((unsub) => {
        unsub()
      })
    }
  }, [refreshTasks, workspaceId])
}
