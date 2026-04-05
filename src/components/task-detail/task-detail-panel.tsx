import { useEffect, useCallback, useState } from 'react'
import type { Task, TaskChecklistItem } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useColumnStore } from '@/stores/column-store'
import { useTaskStore } from '@/stores/task-store'
import { useGit } from '@/hooks/use-git'
import { Badge } from '@/components/shared/badge'
import { ChangesSection } from './changes-section'
import { CommitsSection } from './commits-section'
import { UsageSection } from './usage-section'
import { TaskChecklist } from './task-checklist'
import { NotificationSection } from './notification-section'
import { ReviewActions } from '@/components/review/review-actions'
import { SiegeStatus } from './siege-status'
import * as ipc from '@/lib/ipc'

type TaskDetailPanelProps = {
  task: Task
  onClose: () => void
}

const statusVariant = {
  idle: 'default' as const,
  queued: 'warning' as const,
  running: 'running' as const,
  completed: 'success' as const,
  failed: 'error' as const,
  stopped: 'default' as const,
  needs_attention: 'attention' as const,
}

export function TaskDetailPanel({ task, onClose }: TaskDetailPanelProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const columns = useColumnStore((s) => s.columns)
  const updateTask = useTaskStore((s) => s.updateTask)
  
  const [isReviewPending, setIsReviewPending] = useState(false)

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const column = columns.find((c) => c.id === task.columnId)
  const repoPath = workspace?.repoPath ?? null

  const { changes, commits, loading, fetchAll } = useGit(repoPath)

  // Fetch git data when entering split view
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-default px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          title="Back to board (Esc)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 3L4 7l4 4" />
          </svg>
        </button>
        {column && (
          <span className="text-xs font-medium text-text-secondary">
            {column.name}
          </span>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Task info */}
        <div className="border-b border-border-default px-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium leading-snug text-text-primary">
              {task.title}
            </h3>
            {task.agentStatus && (
              <Badge
                variant={statusVariant[task.agentStatus]}
                className="mt-0.5 shrink-0"
              />
            )}
          </div>

          {task.description && (
            <p className="mt-2 text-xs leading-relaxed text-text-secondary">
              {task.description}
            </p>
          )}

          {task.branch && (
            <div className="mt-2 flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-text-secondary">
                <circle cx="4" cy="3" r="1.5" />
                <circle cx="8" cy="9" r="1.5" />
                <path d="M4 4.5V7.5C4 8.5 5 9 8 9M8 7.5V3" />
              </svg>
              <span className="truncate font-mono text-[11px] text-accent">
                {task.branch}
              </span>
            </div>
          )}

          {task.agentStatus && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[11px] text-text-secondary">Status:</span>
              <span className="text-[11px] font-medium capitalize text-text-primary">
                {task.agentStatus.replace('_', ' ')}
              </span>
            </div>
          )}
        </div>

        {/* Review Actions */}
        <div className="border-b border-border-default px-3">
          <ReviewActions
            reviewStatus={task.reviewStatus}
            onApprove={() => { void handleApprove() }}
            onReject={() => { void handleReject() }}
            disabled={isReviewPending}
          />
        </div>

        {/* Siege Loop Status */}
        {(task.siegeActive || task.siegeIteration > 0) && (
          <div className="border-b border-border-default px-3 py-2">
            <div className="mb-2">
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">
                Siege Loop
              </h4>
            </div>
            <SiegeStatus task={task} onUpdate={updateTask} />
          </div>
        )}

        {/* Test Checklist */}
        <div className="border-b border-border-default px-3 py-2">
          <div className="mb-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">
              Test Checklist
            </h4>
          </div>
          <TaskChecklist
            task={task}
            onUpdate={(items) => { void handleChecklistUpdate(items) }}
            repoPath={repoPath}
          />
        </div>

        {/* Changes */}
        <div className="border-b border-border-default">
          <div className="px-3 pt-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">
              Changes
            </h4>
          </div>
          <ChangesSection changes={changes} loading={loading} />
        </div>

        {/* Commits */}
        <div className="border-b border-border-default">
          <div className="px-3 pt-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">
              Commits
            </h4>
          </div>
          <CommitsSection commits={commits} />
        </div>

        {/* Usage */}
        <div className="p-3">
          <UsageSection
            agentType={task.agentType}
            agentStatus={task.agentStatus}
            startedAt={task.agentStatus === 'running' ? task.updatedAt : null}
          />
        </div>

        {/* Notifications */}
        <div className="px-3 pb-3">
          <NotificationSection
            taskId={task.id}
            stakeholders={task.notifyStakeholders}
            notificationSentAt={task.notificationSentAt}
            onUpdate={() => { void handleNotificationUpdate() }}
          />
        </div>
      </div>
    </div>
  )
}
