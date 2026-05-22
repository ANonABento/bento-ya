import { useEffect } from 'react'
import { listen } from '@/lib/ipc'

type TaskEventPayload = {
  workspace_id?: string
  workspaceId?: string
}

export function useOrchestratorTaskRefresh(
  workspaceId: string,
  refreshTasks: (workspaceId: string) => Promise<void>,
) {
  useEffect(() => {
    const unsubscribes: Array<() => void> = []

    const setupListeners = async () => {
      const refreshIfMatches = (payload: TaskEventPayload) => {
        const eventWorkspaceId = payload.workspaceId ?? payload.workspace_id
        if (eventWorkspaceId === workspaceId) {
          void refreshTasks(workspaceId)
        }
      }

      const unsubTaskCreated = await listen<TaskEventPayload>('task:created', (payload) => {
        refreshIfMatches(payload)
      })
      unsubscribes.push(unsubTaskCreated)

      const unsubTaskUpdated = await listen<TaskEventPayload>('task:updated', (payload) => {
        refreshIfMatches(payload)
      })
      unsubscribes.push(unsubTaskUpdated)

      const unsubTaskDeleted = await listen<TaskEventPayload>('task:deleted', (payload) => {
        refreshIfMatches(payload)
      })
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
