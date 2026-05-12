import { useMemo } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSettingsStore } from '@/stores/settings-store'
import { parseWorkspaceConfig } from '@/types/workspace'

export type WorkspaceQueueStatus = {
  runningCount: number
  queuedCount: number
  maxConcurrent: number
  /** Task IDs sorted by queuedAt ascending (oldest first = first to run) */
  queuedTaskIds: string[]
  /** 1-based queue position, or 0 if the task is not queued */
  positionOf: (taskId: string) => number
}

/**
 * Derives queue/concurrency state from the task store and settings — no extra IPC.
 * Updates reactively whenever tasks or settings change.
 */
export function useQueueStatus(workspaceId: string | null): WorkspaceQueueStatus {
  const tasks = useTaskStore((s) => s.tasks)
  const activeWorkspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === workspaceId),
  )
  const globalMaxConcurrent = useSettingsStore(
    (s) => s.global.agent.maxConcurrentAgents,
  )

  return useMemo(() => {
    const workspaceTasks = workspaceId
      ? tasks.filter((t) => t.workspaceId === workspaceId)
      : []

    const runningCount = workspaceTasks.filter(
      (t) => t.agentStatus === 'running',
    ).length

    const sortedQueued = workspaceTasks
      .filter((t) => t.agentStatus === 'queued')
      .sort((a, b) => {
        const aMs = a.queuedAt ? new Date(a.queuedAt).getTime() : 0
        const bMs = b.queuedAt ? new Date(b.queuedAt).getTime() : 0
        return aMs - bMs
      })

    const queuedTaskIds = sortedQueued.map((t) => t.id)

    const workspaceConfig = activeWorkspace
      ? parseWorkspaceConfig(activeWorkspace.config)
      : {}
    const maxConcurrent =
      workspaceConfig.maxConcurrentAgents ?? globalMaxConcurrent

    const positionOf = (taskId: string): number => {
      const idx = queuedTaskIds.indexOf(taskId)
      return idx === -1 ? 0 : idx + 1
    }

    return {
      runningCount,
      queuedCount: sortedQueued.length,
      maxConcurrent,
      queuedTaskIds,
      positionOf,
    }
  }, [tasks, workspaceId, activeWorkspace, globalMaxConcurrent])
}
