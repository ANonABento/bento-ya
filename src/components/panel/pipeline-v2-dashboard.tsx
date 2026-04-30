import { useEffect, useRef, useState, useCallback } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useColumnStore } from '@/stores/column-store'
import { listen, type UnlistenFn } from '@/lib/ipc'
import { getWorkspaceUsageSummary, type UsageSummary } from '@/lib/ipc/usage'
import {
  onPipelineRunning,
  onPipelineComplete,
  onPipelineError,
  onPipelineAdvanced,
} from '@/lib/ipc/pipeline'
import { filterActiveTasks } from './pipeline-dashboard-utils'
import type { Task, Column } from '@/types'

type TasksChangedPayload = { workspaceId: string; reason: string }

type PipelineV2DashboardProps = {
  workspaceId: string
}

export function PipelineV2Dashboard({ workspaceId }: PipelineV2DashboardProps) {
  const tasks = useTaskStore((s) => s.tasks)
  const loadTasks = useTaskStore((s) => s.load)
  const columns = useColumnStore((s) => s.columns)

  const [, setTick] = useState(0)
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null)
  const unlistenRefs = useRef<UnlistenFn[]>([])

  useEffect(() => {
    const interval = setInterval(() => { setTick((t) => t + 1) }, 30_000)
    return () => { clearInterval(interval) }
  }, [])

  const fetchUsage = useCallback(async () => {
    try {
      const summary = await getWorkspaceUsageSummary(workspaceId)
      setUsageSummary(summary)
    } catch {
      // Ignore — usage data is best-effort
    }
  }, [workspaceId])

  useEffect(() => {
    void fetchUsage()
  }, [fetchUsage])

  useEffect(() => {
    let cancelled = false

    const refresh = () => {
      if (cancelled) return
      void loadTasks(workspaceId)
      void fetchUsage()
    }

    void listen<TasksChangedPayload>('tasks:changed', (payload) => {
      if (payload.workspaceId === workspaceId) refresh()
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else unlistenRefs.current.push(unlisten)
    })

    for (const sub of [onPipelineRunning, onPipelineComplete, onPipelineError, onPipelineAdvanced]) {
      void sub(refresh).then((unlisten) => {
        if (cancelled) unlisten()
        else unlistenRefs.current.push(unlisten)
      })
    }

    return () => {
      cancelled = true
      for (const unsub of unlistenRefs.current) unsub()
      unlistenRefs.current = []
    }
  }, [workspaceId, loadTasks, fetchUsage])

  const sortedColumns = [...columns]
    .filter((c) => c.visible)
    .sort((a, b) => a.position - b.position)

  const activeTasks = filterActiveTasks(tasks)

  // Column distribution: count active tasks per column
  const colCounts = new Map<string, number>()
  for (const t of activeTasks) {
    colCounts.set(t.columnId, (colCounts.get(t.columnId) ?? 0) + 1)
  }
  const maxCount = Math.max(...Array.from(colCounts.values()), 1)

  // Batch grouping
  const batchGroups = new Map<string, Task[]>()
  for (const t of activeTasks) {
    const bid = t.batchId ?? 'ungrouped'
    const existing = batchGroups.get(bid) ?? []
    existing.push(t)
    batchGroups.set(bid, existing)
  }

  // ETA: use average completion time from tasks that went through the pipeline
  const completedTasks = tasks.filter((t) => t.pipelineState === 'idle' && Boolean(t.prUrl?.trim()))
  const avgCompletionMs = computeAvgCompletionTime(completedTasks)

  return (
    <div className="flex h-full w-72 flex-col overflow-y-auto border-r border-border-default bg-surface-secondary p-3 text-sm">
      {/* Summary stats */}
      <div className="mb-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Pipeline Status</h2>
        <div className="mt-2 flex gap-4">
          <Stat label="In flight" value={String(activeTasks.length)} />
          {colCounts.size > 0 && (
            <Stat label="Active cols" value={String(colCounts.size)} />
          )}
          {usageSummary && usageSummary.totalCostUsd > 0 && (
            <Stat label="Total cost" value={`$${usageSummary.totalCostUsd.toFixed(2)}`} />
          )}
        </div>
      </div>

      {/* Column distribution */}
      {activeTasks.length > 0 && (
        <Section title="Column Distribution">
          {sortedColumns.filter((c) => colCounts.has(c.id)).map((col) => {
            const count = colCounts.get(col.id) ?? 0
            const pct = Math.max(5, Math.round((count / maxCount) * 100))
            return (
              <ColumnBar key={col.id} column={col} count={count} pct={pct} />
            )
          })}
          {colCounts.size === 0 && (
            <span className="text-[10px] text-text-tertiary">No active tasks</span>
          )}
        </Section>
      )}

      {/* ETA section — only shown when we have historical data */}
      {activeTasks.length > 0 && avgCompletionMs > 0 && (
        <Section title="Estimated Completion">
          {activeTasks.slice(0, 6).map((task) => {
            const eta = computeTaskEta(task, sortedColumns, avgCompletionMs)
            return (
              <div key={task.id} className="flex items-center justify-between gap-1">
                <span className="truncate text-[10px] text-text-secondary">{task.title}</span>
                <span className="shrink-0 text-[10px] text-text-tertiary">
                  {eta > 0 ? `~${formatMs(eta)}` : 'soon'}
                </span>
              </div>
            )
          })}
          {activeTasks.length > 6 && (
            <span className="text-[10px] text-text-tertiary">+{activeTasks.length - 6} more</span>
          )}
        </Section>
      )}

      {/* Batch breakdown — only shown when multiple batches */}
      {batchGroups.size > 1 && (
        <Section title="Batches">
          {Array.from(batchGroups.entries()).map(([batchId, batchTasks]) => (
            <div key={batchId} className="flex items-center justify-between gap-1">
              <span className="truncate text-[10px] text-text-secondary">
                {batchId === 'ungrouped' ? 'No batch' : batchId.slice(0, 12)}
              </span>
              <span className="shrink-0 text-[10px] text-text-tertiary">
                {batchTasks.length} {batchTasks.length === 1 ? 'task' : 'tasks'}
              </span>
            </div>
          ))}
        </Section>
      )}

      {/* Usage breakdown by model */}
      {usageSummary && usageSummary.recordCount > 0 && (
        <Section title="Usage">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] text-text-secondary">Input tokens</span>
            <span className="text-[10px] text-text-tertiary">{formatTokens(usageSummary.totalInputTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] text-text-secondary">Output tokens</span>
            <span className="text-[10px] text-text-tertiary">{formatTokens(usageSummary.totalOutputTokens)}</span>
          </div>
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] text-text-secondary">Sessions</span>
            <span className="text-[10px] text-text-tertiary">{usageSummary.recordCount}</span>
          </div>
        </Section>
      )}

      {/* Empty state */}
      {activeTasks.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-xs text-text-tertiary">
          No active pipeline tasks
        </div>
      )}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeAvgCompletionTime(completedTasks: Task[]): number {
  let total = 0
  let count = 0
  for (const t of completedTasks) {
    if (t.pipelineTriggeredAt) {
      const start = new Date(t.pipelineTriggeredAt).getTime()
      const end = new Date(t.updatedAt).getTime()
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
        total += end - start
        count++
      }
    }
  }
  return count > 0 ? total / count : 0
}

function computeTaskEta(task: Task, sortedColumns: Column[], avgCompletionMs: number): number {
  const startTime = task.pipelineTriggeredAt
    ? new Date(task.pipelineTriggeredAt).getTime()
    : new Date(task.createdAt).getTime()
  const elapsed = Date.now() - startTime
  const colIdx = sortedColumns.findIndex((c) => c.id === task.columnId)
  const remainingCols = sortedColumns.length - Math.max(colIdx, 0) - 1
  const avgPerCol = sortedColumns.length > 0 ? avgCompletionMs / sortedColumns.length : avgCompletionMs
  return Math.max(0, remainingCols * avgPerCol - elapsed)
}

function formatMs(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${String(sec)}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${String(min)}m`
  return `${String(Math.floor(min / 60))}h`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium text-text-primary">{value}</span>
      <span className="text-[10px] text-text-tertiary">{label}</span>
    </div>
  )
}

function ColumnBar({ column, count, pct }: { column: Column; count: number; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate text-[10px] text-text-secondary">{column.name}</span>
      <div className="flex-1 overflow-hidden rounded-full bg-surface-hover" style={{ height: 5 }}>
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${String(pct)}%` }}
        />
      </div>
      <span className="w-4 shrink-0 text-right text-[10px] text-text-tertiary">{count}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{title}</h3>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}
