/** Shared hook for task detail: git data (changes, commits, diff) + task update. */

import { useCallback, useEffect } from 'react'
import type { Task } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useTaskStore } from '@/stores/task-store'
import { useGit } from '@/hooks/use-git'

export function useTaskDetail(task: Task) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const updateTask = useTaskStore((s) => s.updateTask)

  const workspace = workspaces.find((w) => w.id === task.workspaceId)
  const repoPath = workspace?.repoPath ?? null

  const {
    changes,
    commits,
    loading,
    diffByFile,
    diffLoading,
    diffError,
    fetchAll,
    fetchDiff,
  } = useGit(repoPath)

  useEffect(() => {
    if (task.branch) {
      void fetchAll(task.branch)
    }
  }, [task.branch, fetchAll])

  const loadDiff = useCallback(
    async (filePath: string | null) => {
      if (!task.branch) return ''
      return fetchDiff(task.branch, filePath)
    },
    [task.branch, fetchDiff],
  )

  return {
    repoPath,
    updateTask,
    changes,
    commits,
    loading,
    diffByFile,
    diffLoading,
    diffError,
    loadDiff,
  }
}
