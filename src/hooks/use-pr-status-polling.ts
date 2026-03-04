import { useEffect, useRef, useCallback } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSettingsStore } from '@/stores/settings-store'
import { fetchPrStatusBatch, shouldRefreshPrStatus } from '@/lib/ipc'
import { DEFAULT_SETTINGS } from '@/types/settings'
import type { PrMergeable, PrCiStatus, PrReviewDecision } from '@/types/task'

/**
 * Hook to automatically poll PR status for tasks with PRs.
 * Uses smart refresh to avoid excessive API calls:
 * - Only fetches if data is stale (older than maxAgeSeconds)
 * - Batches requests to minimize API calls
 * - Respects configurable poll interval from settings
 */
export function usePrStatusPolling(options?: {
  enabled?: boolean
}) {
  const tasks = useTaskStore((s) => s.tasks)
  const updateTask = useTaskStore((s) => s.updateTask)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const cardSettings = useSettingsStore((s) => s.global.cards) ?? DEFAULT_SETTINGS.cards

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isPollingRef = useRef(false)

  // Get settings from card config
  const pollIntervalMs = cardSettings.prPollingIntervalSeconds * 1000
  const maxAgeSeconds = cardSettings.prCacheMaxAgeSeconds
  const pollingEnabled = (options?.enabled ?? true) && cardSettings.prPollingEnabled

  const pollPrStatuses = useCallback(async () => {
    if (!activeWorkspace?.repoPath || isPollingRef.current) return

    // Find tasks with PRs that need refresh
    const tasksWithPrs = tasks.filter((t) => t.prNumber !== null)
    if (tasksWithPrs.length === 0) return

    // Check which tasks need refresh
    const taskIdsToRefresh: string[] = []
    for (const task of tasksWithPrs) {
      try {
        const needsRefresh = await shouldRefreshPrStatus(task.id, maxAgeSeconds)
        if (needsRefresh) {
          taskIdsToRefresh.push(task.id)
        }
      } catch {
        // If we can't check, assume it needs refresh
        taskIdsToRefresh.push(task.id)
      }
    }

    if (taskIdsToRefresh.length === 0) return

    isPollingRef.current = true
    try {
      const results = await fetchPrStatusBatch(taskIdsToRefresh, activeWorkspace.repoPath)

      // Update tasks with new PR status
      for (const status of results) {
        updateTask(status.taskId, {
          prMergeable: status.mergeable as PrMergeable,
          prCiStatus: status.ciStatus as PrCiStatus,
          prReviewDecision: (status.reviewDecision?.toLowerCase() ?? null) as PrReviewDecision | null,
          prCommentCount: status.commentCount,
          prIsDraft: status.isDraft,
          prLabels: JSON.stringify(status.labels),
          prLastFetched: new Date().toISOString(),
          prHeadSha: status.headSha,
        })
      }
    } catch (error) {
      console.error('Failed to fetch PR statuses:', error)
    } finally {
      isPollingRef.current = false
    }
  }, [tasks, activeWorkspace?.repoPath, maxAgeSeconds, updateTask])

  // Set up polling interval
  useEffect(() => {
    if (!pollingEnabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Initial poll
    void pollPrStatuses()

    // Set up interval
    intervalRef.current = setInterval(() => {
      void pollPrStatuses()
    }, pollIntervalMs)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [pollingEnabled, pollIntervalMs, pollPrStatuses])

  // Return a function to trigger manual refresh
  return { refreshPrStatuses: pollPrStatuses }
}
