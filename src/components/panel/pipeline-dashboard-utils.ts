import type { Task, Column } from '@/types'

export function computeProgress(columnId: string, sortedColumns: Column[]): number {
  if (sortedColumns.length === 0) return 0
  const index = sortedColumns.findIndex((c) => c.id === columnId)
  if (index < 0) return 0
  const raw = ((index + 1) / sortedColumns.length) * 100
  return Math.max(5, Math.min(100, Math.round(raw)))
}

export function filterActiveTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.pipelineState !== 'idle')
}

export function filterFailedTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.pipelineError !== null && t.pipelineError !== '')
}

export function filterRecentCompletions(tasks: Task[], n: number): Task[] {
  return tasks
    .filter((t) => t.prUrl !== null && t.prUrl !== '')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, n)
}

export function computeBatchStats(tasks: Task[]): { active: number; complete: number; failed: number } {
  let active = 0
  let complete = 0
  let failed = 0

  for (const t of tasks) {
    if (t.pipelineError) {
      failed++
    } else if (t.pipelineState !== 'idle') {
      active++
    } else if (t.prUrl) {
      complete++
    }
  }

  return { active, complete, failed }
}

export function formatElapsed(startDateStr: string): string {
  const start = new Date(startDateStr).getTime()
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - start) / 1000))

  if (diffSec < 60) return `${diffSec.toString()}s`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60).toString()}m`
  return `${Math.floor(diffSec / 3600).toString()}h`
}
