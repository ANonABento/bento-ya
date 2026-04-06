/** Shared hook for task detail actions (approve, reject, checklist, git, notifications). */

import { useEffect, useCallback, useState } from 'react'
import type { Task, TaskChecklistItem } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useTaskStore } from '@/stores/task-store'
import { useGit } from '@/hooks/use-git'
import * as ipc from '@/lib/ipc'

export const STATUS_VARIANT = {
  idle: 'default' as const,
  queued: 'warning' as const,
  running: 'running' as const,
  completed: 'success' as const,
  failed: 'error' as const,
  stopped: 'default' as const,
  needs_attention: 'attention' as const,
}

export function useTaskDetail(task: Task) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const updateTask = useTaskStore((s) => s.updateTask)

  const [isReviewPending, setIsReviewPending] = useState(false)

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const repoPath = workspace?.repoPath ?? null

  const { changes, commits, loading, fetchAll } = useGit(repoPath)

  useEffect(() => {
    if (task.branch) {
      void fetchAll(task.branch)
    }
  }, [task.branch, fetchAll])

  const handleApprove = useCallback(async () => {
    setIsReviewPending(true)
    try {
      const updatedTask = await ipc.approveTask(task.id)
      updateTask(task.id, updatedTask)
    } catch (err) {
      console.error('Failed to approve task:', err)
    } finally {
      setIsReviewPending(false)
    }
  }, [task.id, updateTask])

  const handleReject = useCallback(async () => {
    const reason = window.prompt('Rejection reason (optional):')
    setIsReviewPending(true)
    try {
      const updatedTask = await ipc.rejectTask(task.id, reason ?? undefined)
      updateTask(task.id, updatedTask)
    } catch (err) {
      console.error('Failed to reject task:', err)
    } finally {
      setIsReviewPending(false)
    }
  }, [task.id, updateTask])

  const handleChecklistUpdate = useCallback(async (items: TaskChecklistItem[]) => {
    try {
      const checklist = JSON.stringify(items)
      const updatedTask = await ipc.updateTask(task.id, { checklist })
      updateTask(task.id, updatedTask)
    } catch (err) {
      console.error('Failed to update checklist:', err)
    }
  }, [task.id, updateTask])

  const handleNotificationUpdate = useCallback(async () => {
    try {
      const updatedTask = await ipc.getTask(task.id)
      updateTask(task.id, updatedTask)
    } catch (err) {
      console.error('Failed to refresh task:', err)
    }
  }, [task.id, updateTask])

  return {
    repoPath,
    updateTask,
    isReviewPending,
    changes,
    commits,
    loading,
    handleApprove,
    handleReject,
    handleChecklistUpdate,
    handleNotificationUpdate,
  }
}
