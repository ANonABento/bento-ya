/**
 * Hook that listens for backend task mutation events and re-fetches the task store.
 * Ensures the UI stays in sync when tasks are created/moved/deleted by the pipeline
 * engine, triggers, or any other backend process that bypasses the Zustand store.
 */

import { useEffect, useRef } from 'react'
import { listen, type UnlistenFn } from '@/lib/ipc'
import { useTaskStore } from '@/stores/task-store'

type TasksChangedPayload = {
  workspaceId?: string
  workspace_id?: string
  reason: string
}

export function useTaskSync(workspaceId: string | null) {
  const loadTasks = useTaskStore((s) => s.load)
  const unlistenRef = useRef<UnlistenFn | null>(null)

  useEffect(() => {
    if (!workspaceId) return

    let cancelled = false

    void listen<TasksChangedPayload>('tasks:changed', (payload) => {
      if (cancelled) return
      if ((payload.workspaceId ?? payload.workspace_id) === workspaceId) {
        void loadTasks(workspaceId)
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten()
      } else {
        unlistenRef.current = unlisten
      }
    })

    return () => {
      cancelled = true
      unlistenRef.current?.()
      unlistenRef.current = null
    }
  }, [workspaceId, loadTasks])
}
