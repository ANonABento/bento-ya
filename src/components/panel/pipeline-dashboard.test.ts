import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Task } from '@/types'
import type { Column } from '@/types'
import {
  computeProgress,
  filterActiveTasks,
  filterFailedTasks,
  filterRecentCompletions,
  computeBatchStats,
  formatElapsed,
} from './pipeline-dashboard-utils'

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: 'col-1',
    workspaceId: 'ws-1',
    name: 'Backlog',
    icon: '',
    position: 0,
    color: '',
    visible: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    workspaceId: 'ws-1',
    columnId: 'col-1',
    title: 'Test task',
    description: '',
    branch: null,
    agentType: null,
    agentMode: null,
    agentStatus: null,
    queuedAt: null,
    pipelineState: 'idle',
    pipelineTriggeredAt: null,
    pipelineError: null,
    retryCount: 0,
    model: null,
    lastScriptExitCode: null,
    reviewStatus: null,
    prNumber: null,
    prUrl: null,
    siegeIteration: 0,
    siegeActive: false,
    siegeMaxIterations: 0,
    siegeLastChecked: null,
    prMergeable: null,
    prCiStatus: null,
    prReviewDecision: null,
    prCommentCount: 0,
    prIsDraft: false,
    prLabels: '[]',
    prLastFetched: null,
    prHeadSha: null,
    checklist: null,
    notifyStakeholders: null,
    notificationSentAt: null,
    triggerOverrides: null,
    triggerPrompt: null,
    lastOutput: null,
    dependencies: null,
    blocked: false,
    worktreePath: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('computeProgress', () => {
  const columns = [
    makeColumn({ id: 'col-1', position: 0 }),
    makeColumn({ id: 'col-2', position: 1 }),
    makeColumn({ id: 'col-3', position: 2 }),
    makeColumn({ id: 'col-4', position: 3 }),
    makeColumn({ id: 'col-5', position: 4 }),
    makeColumn({ id: 'col-6', position: 5 }),
    makeColumn({ id: 'col-7', position: 6 }),
  ]

  it('returns ~14% for first column', () => {
    expect(computeProgress('col-1', columns)).toBe(14)
  })

  it('returns 100% for last column', () => {
    expect(computeProgress('col-7', columns)).toBe(100)
  })

  it('returns 0 for unknown columnId', () => {
    expect(computeProgress('unknown', columns)).toBe(0)
  })

  it('returns 0 for empty columns', () => {
    expect(computeProgress('col-1', [])).toBe(0)
  })

  it('clamps minimum to 5%', () => {
    // 1/100 = 1% → should clamp to 5
    const manyColumns = Array.from({ length: 100 }, (_, i) =>
      makeColumn({ id: `col-${String(i)}`, position: i }),
    )
    expect(computeProgress('col-0', manyColumns)).toBe(5)
  })
})

describe('filterActiveTasks', () => {
  it('excludes idle tasks', () => {
    const tasks = [
      makeTask({ id: 't1', pipelineState: 'idle' }),
      makeTask({ id: 't2', pipelineState: 'running' }),
      makeTask({ id: 't3', pipelineState: 'triggered' }),
      makeTask({ id: 't4', pipelineState: 'evaluating' }),
      makeTask({ id: 't5', pipelineState: 'advancing' }),
    ]
    const result = filterActiveTasks(tasks)
    expect(result.map((t) => t.id)).toEqual(['t2', 't3', 't4', 't5'])
  })

  it('excludes failed tasks from active results', () => {
    const tasks = [
      makeTask({ id: 't1', pipelineState: 'running', pipelineError: 'agent failed' }),
      makeTask({ id: 't2', pipelineState: 'running', pipelineError: null }),
    ]
    const result = filterActiveTasks(tasks)
    expect(result.map((t) => t.id)).toEqual(['t2'])
  })

  it('returns empty for all idle', () => {
    const tasks = [makeTask({ pipelineState: 'idle' })]
    expect(filterActiveTasks(tasks)).toEqual([])
  })
})

describe('filterFailedTasks', () => {
  it('includes only tasks with pipelineError', () => {
    const tasks = [
      makeTask({ id: 't1', pipelineError: 'some error' }),
      makeTask({ id: 't2', pipelineError: null }),
      makeTask({ id: 't3', pipelineError: '' }),
    ]
    const result = filterFailedTasks(tasks)
    expect(result.map((t) => t.id)).toEqual(['t1'])
  })
})

describe('filterRecentCompletions', () => {
  it('returns at most n tasks with prUrl, sorted by updatedAt desc', () => {
    const tasks = [
      makeTask({ id: 't1', prUrl: 'https://github.com/pr/1', updatedAt: '2026-01-01T00:00:00Z' }),
      makeTask({ id: 't2', prUrl: 'https://github.com/pr/2', updatedAt: '2026-01-03T00:00:00Z' }),
      makeTask({ id: 't3', prUrl: 'https://github.com/pr/3', updatedAt: '2026-01-02T00:00:00Z' }),
      makeTask({ id: 't4', prUrl: null }), // no PR
    ]
    const result = filterRecentCompletions(tasks, 2)
    expect(result.map((t) => t.id)).toEqual(['t2', 't3'])
  })

  it('returns empty when no tasks have prUrl', () => {
    const tasks = [makeTask({ prUrl: null })]
    expect(filterRecentCompletions(tasks, 5)).toEqual([])
  })
})

describe('computeBatchStats', () => {
  it('counts active, failed, and complete correctly', () => {
    const tasks = [
      makeTask({ pipelineState: 'running', pipelineError: null, prUrl: null }),
      makeTask({ pipelineState: 'triggered', pipelineError: null, prUrl: null }),
      makeTask({ pipelineState: 'idle', pipelineError: 'err', prUrl: null }),
      makeTask({ pipelineState: 'idle', pipelineError: null, prUrl: 'https://pr' }),
      makeTask({ pipelineState: 'idle', pipelineError: null, prUrl: null }),
    ]
    expect(computeBatchStats(tasks)).toEqual({ active: 2, complete: 1, failed: 1 })
  })

  it('returns zeros for empty', () => {
    expect(computeBatchStats([])).toEqual({ active: 0, complete: 0, failed: 0 })
  })
})

describe('formatElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T01:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats seconds', () => {
    expect(formatElapsed('2026-01-01T00:59:30Z')).toBe('30s')
  })

  it('formats minutes', () => {
    expect(formatElapsed('2026-01-01T00:55:00Z')).toBe('5m')
  })

  it('formats hours', () => {
    expect(formatElapsed('2025-12-31T23:00:00Z')).toBe('2h')
  })

  it('returns 0s for future date', () => {
    expect(formatElapsed('2026-01-01T02:00:00Z')).toBe('0s')
  })

  it('returns 0s for invalid dates', () => {
    expect(formatElapsed('not-a-date')).toBe('0s')
  })
})
