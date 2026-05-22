/** Shared hook for task detail: git data (changes, commits, diff) + task update. */

import { useCallback, useEffect } from 'react'
import type { Task } from '@/types'
import { parseWorkspaceConfig } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useTaskStore } from '@/stores/task-store'
import { useGit } from '@/hooks/use-git'

type UseTaskDetailOptions = {
  fallbackCommitHash?: string | null
}

export type ChangeReferenceKind = 'branch' | 'commit' | 'none'

export function useTaskDetail(task: Task, options: UseTaskDetailOptions = {}) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const updateTask = useTaskStore((s) => s.updateTask)

  const workspace = workspaces.find((w) => w.id === task.workspaceId)
  const repoPath = task.worktreePath ?? workspace?.repoPath ?? null
  const baseBranch = workspace ? parseWorkspaceConfig(workspace.config).defaultBaseBranch : undefined

  const {
    changes,
    commits,
    loading,
    diffByFile,
    diffLoading,
    diffError,
    fetchAll,
    fetchDiff,
    fetchCommitAll,
    fetchCommitDiff,
  } = useGit(repoPath, baseBranch)

  const fallbackCommitHash = task.branch ? null : options.fallbackCommitHash
  const changeReference = task.branch ?? fallbackCommitHash ?? null
  const changeReferenceKind: ChangeReferenceKind = task.branch ? 'branch' : fallbackCommitHash ? 'commit' : 'none'

  useEffect(() => {
    if (task.branch) {
      void fetchAll(task.branch)
    } else if (fallbackCommitHash) {
      void fetchCommitAll(fallbackCommitHash)
    }
  }, [fallbackCommitHash, fetchAll, fetchCommitAll, task.agentStatus, task.branch, task.updatedAt])

  const loadDiff = useCallback(
    async (filePath: string | null) => {
      if (task.branch) {
        return fetchDiff(task.branch, filePath)
      }
      if (fallbackCommitHash) {
        return fetchCommitDiff(fallbackCommitHash, filePath)
      }
      return ''
    },
    [fallbackCommitHash, fetchCommitDiff, fetchDiff, task.branch],
  )

  return {
    repoPath,
    changeReference,
    changeReferenceKind,
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
