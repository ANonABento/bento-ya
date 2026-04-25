import { useCallback, useEffect, useState } from 'react'
import type { Task, TaskChecklistItem } from '@/types'
import * as ipc from '@/lib/ipc'
import { useTaskDetail } from '@/hooks/use-task-detail'
import { ChangesSection } from './changes-section'
import { CommitsSection } from './commits-section'
import { UsageSection } from './usage-section'
import { NotificationSection } from './notification-section'
import { TaskChecklist } from './task-checklist'
import { SiegeStatus } from './siege-status'

type Tab = 'overview' | 'changes' | 'commits' | 'usage'

const TABS: readonly Tab[] = ['overview', 'changes', 'commits', 'usage'] as const

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  changes: 'Changes',
  commits: 'Commits',
  usage: 'Usage',
}

type TaskDetailPanelProps = {
  task: Task
  onClose: () => void
  onSwitchToTerminal: () => void
}

export function TaskDetailPanel({
  task,
  onClose,
  onSwitchToTerminal,
}: TaskDetailPanelProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const { changes, commits, loading, updateTask, repoPath } = useTaskDetail(task)

  // Refresh the local task in the store from the backend (used by
  // NotificationSection after it mutates stakeholders/notification state).
  const refreshTask = useCallback(async () => {
    const fresh = await ipc.getTask(task.id)
    updateTask(task.id, fresh)
  }, [task.id, updateTask])

  // Persist checklist edits to backend + store.
  const handleChecklistUpdate = useCallback(
    (items: TaskChecklistItem[]) => {
      const json = JSON.stringify(items)
      updateTask(task.id, { checklist: json })
      void ipc.updateTask(task.id, { checklist: json })
    },
    [task.id, updateTask],
  )

  // Keyboard: 1–4 switches tabs, but only when focus isn't in an input.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      const idx = ['1', '2', '3', '4'].indexOf(e.key)
      if (idx >= 0) {
        const next = TABS[idx]
        if (next) {
          e.preventDefault()
          setTab(next)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 3l5 4-5 4" />
            </svg>
          </button>
          <span className="text-xs font-medium text-text-primary">Detail</span>
          <span className="truncate text-[10px] text-text-secondary max-w-[160px]">
            {task.title}
          </span>
        </div>
        <button
          type="button"
          onClick={onSwitchToTerminal}
          className="rounded border border-border-default px-2 py-1 text-[10px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          title="Switch to terminal (⌘I)"
        >
          Terminal
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border-default px-3">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t) }}
            className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <OverviewTab
            task={task}
            repoPath={repoPath}
            onRefresh={() => { void refreshTask() }}
            onChecklistUpdate={handleChecklistUpdate}
            onTaskUpdate={updateTask}
          />
        )}
        {tab === 'changes' && (
          <div className="p-3">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
              Changes
            </h4>
            <ChangesSection changes={changes} loading={loading} />
          </div>
        )}
        {tab === 'commits' && (
          <div className="p-3">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
              Commits
            </h4>
            <CommitsSection commits={commits} />
          </div>
        )}
        {tab === 'usage' && (
          <div className="p-3">
            <UsageSection
              agentType={task.agentType}
              agentStatus={task.agentStatus}
              startedAt={task.pipelineTriggeredAt}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Overview tab ───────────────────────────────────────────────────────────

type OverviewTabProps = {
  task: Task
  repoPath: string | null
  onRefresh: () => void
  onChecklistUpdate: (items: TaskChecklistItem[]) => void
  onTaskUpdate: (id: string, updates: Partial<Task>) => void
}

function OverviewTab({
  task,
  repoPath,
  onRefresh,
  onChecklistUpdate,
  onTaskUpdate,
}: OverviewTabProps) {
  const labels = (() => {
    try {
      return JSON.parse(task.prLabels || '[]') as string[]
    } catch {
      return []
    }
  })()

  const showSiege = task.siegeActive || task.siegeIteration > 0

  return (
    <div className="p-3 space-y-4">
      {/* Description */}
      {task.description && (
        <section>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
            Description
          </h4>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-primary">
            {task.description}
          </p>
        </section>
      )}

      {/* Metadata row */}
      <section className="flex flex-wrap items-center gap-2">
        {task.branch && (
          <div className="flex items-center gap-1.5">
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              className="text-text-secondary shrink-0"
            >
              <circle cx="4" cy="3" r="1.5" />
              <circle cx="8" cy="9" r="1.5" />
              <path d="M4 4.5V7.5C4 8.5 5 9 8 9M8 7.5V3" />
            </svg>
            <span
              className="truncate font-mono text-[11px] text-accent max-w-[220px]"
              title={task.branch}
            >
              {task.branch}
            </span>
            {task.worktreePath && (
              <span
                className="rounded bg-purple-500/10 px-1 py-0.5 text-[10px] font-medium text-purple-400"
                title={task.worktreePath}
              >
                worktree
              </span>
            )}
          </div>
        )}
        {task.model && (
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
            {task.model}
          </span>
        )}
        {task.agentType && (
          <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-secondary">
            {task.agentType}
          </span>
        )}
        {task.prNumber && (
          <a
            href={task.prUrl ?? '#'}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => { if (!task.prUrl) e.preventDefault() }}
            className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-text-primary hover:text-accent"
          >
            PR #{task.prNumber}
            {task.prIsDraft ? ' · draft' : ''}
          </a>
        )}
      </section>

      {/* Labels */}
      {labels.length > 0 && (
        <section>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
            Labels
          </h4>
          <div className="flex flex-wrap items-center gap-1">
            {labels.map((label) => (
              <span
                key={label}
                className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-secondary"
              >
                {label}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Siege Loop (only when active/iterating) */}
      {showSiege && (
        <section>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
            Siege Loop
          </h4>
          <SiegeStatus task={task} onUpdate={onTaskUpdate} />
        </section>
      )}

      {/* Checklist */}
      <section>
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-2">
          Checklist
        </h4>
        <TaskChecklist
          task={task}
          onUpdate={onChecklistUpdate}
          repoPath={repoPath}
        />
      </section>

      {/* Notifications */}
      <section>
        <NotificationSection
          taskId={task.id}
          stakeholders={task.notifyStakeholders}
          notificationSentAt={task.notificationSentAt}
          onUpdate={onRefresh}
        />
      </section>

      {/* Timestamps */}
      <section className="grid grid-cols-2 gap-2 text-[11px] text-text-secondary">
        <div>
          <div className="font-medium uppercase tracking-wider">Created</div>
          <div className="text-text-primary">
            {new Date(task.createdAt).toLocaleString()}
          </div>
        </div>
        <div>
          <div className="font-medium uppercase tracking-wider">Updated</div>
          <div className="text-text-primary">
            {new Date(task.updatedAt).toLocaleString()}
          </div>
        </div>
      </section>
    </div>
  )
}
