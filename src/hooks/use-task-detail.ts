/** Shared hook for task detail: git data (changes, commits) + task update. */

import { useEffect } from 'react'
import type { Task } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useTaskStore } from '@/stores/task-store'
import { useGit } from '@/hooks/use-git'

export function useTaskDetail(task: Task) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const updateTask = useTaskStore((s) => s.updateTask)

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const repoPath = workspace?.repoPath ?? null

  const { changes, commits, loading, fetchAll } = useGit(repoPath)

  useEffect(() => {
    if (task.branch) {
      void fetchAll(task.branch)
    }
  }, [task.branch, fetchAll])

  return {
    repoPath,
    updateTask,
    changes,
    commits,
    loading,
  }
}
