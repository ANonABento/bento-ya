import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTaskStore } from '@/stores/task-store'
import { useColumnStore } from '@/stores/column-store'
import { useUIStore } from '@/stores/ui-store'
import { listen, type UnlistenFn } from '@/lib/ipc'
import {
  onPipelineRunning,
  onPipelineComplete,
  onPipelineError,
  onPipelineAdvanced,
} from '@/lib/ipc/pipeline'
import { PIPELINE_LABELS, formatRelativeTime } from '@/components/kanban/task-card-utils'
import {
  computeProgress,
  filterActiveTasks,
  filterFailedTasks,
  filterRecentCompletions,
  computeBatchStats,
  formatElapsed,
  type TasksChangedPayload,
} from './pipeline-dashboard-utils'

type PipelineDashboardProps = {
  workspaceId: string
}

export function PipelineDashboard({ workspaceId }: PipelineDashboardProps) {
  const tasks = useTaskStore((s) => s.tasks)
  const loadTasks = useTaskStore((s) => s.load)
  const columns = useColumnStore((s) => s.columns)
  const openChat = useUIStore((s) => s.openChat)

  const [, setTick] = useState(0)
  const unlistenRefs = useRef<UnlistenFn[]>([])

  // Force re-render every 30s for elapsed timers
  useEffect(() => {
    const interval = setInterval(() => { setTick((t) => t + 1) }, 30_000)
    return () => { clearInterval(interval) }
  }, [])

  // Subscribe to task/pipeline events
  useEffect(() => {
    let cancelled = false

    const refresh = () => {
      if (!cancelled) void loadTasks(workspaceId)
    }

    // tasks:changed
    void listen<TasksChangedPayload>('tasks:changed', (payload) => {
      if (payload.workspaceId === workspaceId) refresh()
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else unlistenRefs.current.push(unlisten)
    })

    // Pipeline events
    const pipelineListeners = [onPipelineRunning, onPipelineComplete, onPipelineError, onPipelineAdvanced]
    for (const sub of pipelineListeners) {
      void sub(() => { refresh() }).then((unlisten) => {
        if (cancelled) unlisten()
        else unlistenRefs.current.push(unlisten)
      })
    }

    return () => {
      cancelled = true
      for (const unsub of unlistenRefs.current) unsub()
      unlistenRefs.current = []
    }
  }, [workspaceId, loadTasks])

  const sortedColumns = [...columns]
    .filter((c) => c.visible)
    .sort((a, b) => a.position - b.position)

  const activeTasks = filterActiveTasks(tasks)
  const failedTasks = filterFailedTasks(tasks)
  const recentCompletions = filterRecentCompletions(tasks, 5)
  const stats = computeBatchStats(tasks)

  return (
    <div className="flex h-full w-64 flex-col overflow-y-auto border-r border-border-default bg-surface-secondary p-3 text-sm">
      {/* Batch summary */}
      <div className="mb-3 flex items-center gap-2 text-xs text-text-secondary">
        {stats.active > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-running" />
            {stats.active} active
          </span>
        )}
        {stats.complete > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {stats.complete} done
          </span>
        )}
        {stats.failed > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-error" />
            {stats.failed} failed
          </span>
        )}
        {stats.active === 0 && stats.complete === 0 && stats.failed === 0 && (
          <span>No pipeline activity</span>
        )}
      </div>

      {/* Active tasks */}
      {activeTasks.length > 0 && (
        <Section title="Active">
          <AnimatePresence initial={false}>
            {activeTasks.map((task) => {
              const col = sortedColumns.find((c) => c.id === task.columnId)
              const progress = computeProgress(task.columnId, sortedColumns)
              const elapsed = formatElapsed(task.pipelineTriggeredAt ?? task.createdAt)
              const label = PIPELINE_LABELS[task.pipelineState]

              return (
                <motion.button
                  key={task.id}
                  type="button"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  onClick={() => { openChat(task.id) }}
                  className="w-full rounded-md bg-surface p-2 text-left transition-colors hover:bg-surface-hover"
                  style={{ cursor: 'pointer' }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-medium text-text-primary">{task.title}</span>
                    <span className="shrink-0 text-[10px] text-text-tertiary">{elapsed}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-[10px] text-text-tertiary">{col?.name ?? 'Unknown'}</span>
                    {label && <span className="text-[10px] text-accent">{label}</span>}
                  </div>
                  {/* Progress bar */}
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-hover">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{ width: `${String(progress)}%` }}
                    />
                  </div>
                </motion.button>
              )
            })}
          </AnimatePresence>
        </Section>
      )}

      {/* Failures */}
      {failedTasks.length > 0 && (
        <Section title="Failures">
          {failedTasks.map((task) => {
            const col = sortedColumns.find((c) => c.id === task.columnId)
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => { openChat(task.id) }}
                className="w-full rounded-md bg-surface p-2 text-left transition-colors hover:bg-surface-hover"
                style={{ cursor: 'pointer' }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-medium text-text-primary">{task.title}</span>
                  <span className="text-[10px] text-text-tertiary">{formatRelativeTime(task.updatedAt)}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-text-tertiary">{col?.name ?? 'Unknown'}</div>
                {task.pipelineError && (
                  <div className="mt-1 line-clamp-2 text-[10px] text-error">{task.pipelineError}</div>
                )}
              </button>
            )
          })}
        </Section>
      )}

      {/* Recent completions */}
      {recentCompletions.length > 0 && (
        <Section title="Completions">
          {recentCompletions.map((task) => {
            const prUrl = task.prUrl

            return (
              <div
                key={task.id}
                className="rounded-md bg-surface p-2"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-medium text-text-primary">{task.title}</span>
                  <span className="text-[10px] text-text-tertiary">{formatRelativeTime(task.updatedAt)}</span>
                </div>
                {prUrl && (
                  <button
                    type="button"
                    onClick={() => { window.open(prUrl, '_blank') }}
                    className="mt-0.5 text-[10px] text-accent hover:underline"
                    style={{ cursor: 'pointer' }}
                  >
                    {task.prNumber ? `PR #${String(task.prNumber)}` : 'View PR'}
                  </button>
                )}
              </div>
            )
          })}
        </Section>
      )}

      {/* Empty state */}
      {activeTasks.length === 0 && failedTasks.length === 0 && recentCompletions.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-xs text-text-tertiary">
          No tasks in flight
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{title}</h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  )
}
