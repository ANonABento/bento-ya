import type { Task, Column } from '@/types'

function hasPipelineError(task: Task): boolean {
  return Boolean(task.pipelineError?.trim())
}

function hasPullRequest(task: Task): boolean {
  return Boolean(task.prUrl?.trim())
}

export function computeProgress(columnId: string, sortedColumns: Column[]): number {
  if (sortedColumns.length === 0) return 0
  const index = sortedColumns.findIndex((c) => c.id === columnId)
  if (index < 0) return 0
  const raw = ((index + 1) / sortedColumns.length) * 100
  return Math.max(5, Math.min(100, Math.round(raw)))
}

export function filterActiveTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.pipelineState !== 'idle' && !hasPipelineError(t))
}

export function filterFailedTasks(tasks: Task[]): Task[] {
  return tasks.filter(hasPipelineError)
}

export function filterRecentCompletions(tasks: Task[], n: number): Task[] {
  return tasks
    .filter(hasPullRequest)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, n)
}

export function computeBatchStats(tasks: Task[]): { active: number; complete: number; failed: number } {
  let active = 0
  let complete = 0
  let failed = 0

  for (const t of tasks) {
    if (hasPipelineError(t)) {
      failed++
    } else if (t.pipelineState !== 'idle') {
      active++
    } else if (hasPullRequest(t)) {
      complete++
    }
  }

  return { active, complete, failed }
}

export function formatElapsed(startDateStr: string): string {
  const start = new Date(startDateStr).getTime()
  if (Number.isNaN(start)) return '0s'

  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - start) / 1000))

  if (diffSec < 60) return `${String(diffSec)}s`
  if (diffSec < 3600) return `${String(Math.floor(diffSec / 60))}m`
  return `${String(Math.floor(diffSec / 3600))}h`
}
