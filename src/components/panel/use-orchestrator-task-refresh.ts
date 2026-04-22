import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'

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
        if ((payload.workspaceId ?? payload.workspace_id) === workspaceId) {
          void refreshTasks(workspaceId)
        }
      }

      const unsubTaskCreated = await listen('task:created', (event) => {
        refreshIfMatches(event.payload as TaskEventPayload)
      })
      unsubscribes.push(unsubTaskCreated)

      const unsubTaskUpdated = await listen('task:updated', (event) => {
        refreshIfMatches(event.payload as TaskEventPayload)
      })
      unsubscribes.push(unsubTaskUpdated)

      const unsubTaskDeleted = await listen('task:deleted', (event) => {
        refreshIfMatches(event.payload as TaskEventPayload)
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
