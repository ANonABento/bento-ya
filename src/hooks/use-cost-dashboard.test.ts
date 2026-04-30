import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCostDashboard } from './use-cost-dashboard'
import { getCostDashboard, type CostDashboard } from '@/lib/ipc'

vi.mock('@/lib/ipc', () => ({
  getCostDashboard: vi.fn(),
}))

const mockGetCostDashboard = vi.mocked(getCostDashboard)

const dashboard: CostDashboard = {
  total: {
    totalInputTokens: 100,
    totalOutputTokens: 50,
    totalCostUsd: 1.25,
    recordCount: 1,
  },
  workspaces: [
    {
      workspaceId: 'workspace-1',
      workspaceName: 'Alpha',
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCostUsd: 1.25,
      recordCount: 1,
    },
  ],
  columns: [
    {
      workspaceId: 'workspace-1',
      workspaceName: 'Alpha',
      columnName: 'Todo',
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCostUsd: 1.25,
      recordCount: 1,
    },
  ],
  topTasks: [
    {
      taskId: 'task-1',
      taskTitle: 'Build API',
      workspaceId: 'workspace-1',
      workspaceName: 'Alpha',
      columnName: 'Todo',
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCostUsd: 1.25,
      recordCount: 1,
    },
  ],
  daily: [
    {
      date: '2026-04-30',
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCostUsd: 1.25,
      recordCount: 1,
    },
  ],
}

describe('useCostDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the cost dashboard when enabled', async () => {
    mockGetCostDashboard.mockResolvedValue(dashboard)

    const { result } = renderHook(() => useCostDashboard())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.dashboard).toEqual(dashboard)
    expect(result.current.error).toBeNull()
  })

  it('surfaces load errors', async () => {
    mockGetCostDashboard.mockRejectedValue(new Error('database unavailable'))

    const { result } = renderHook(() => useCostDashboard())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.dashboard).toBeNull()
    expect(result.current.error).toBe('database unavailable')
  })

  it('ignores stale responses after the hook is disabled', async () => {
    let resolveRequest: (value: CostDashboard) => void = () => {}
    mockGetCostDashboard.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )

    const { result, rerender } = renderHook(({ enabled }) => useCostDashboard({ enabled }), {
      initialProps: { enabled: true },
    })

    rerender({ enabled: false })
    resolveRequest(dashboard)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.dashboard).toBeNull()
  })
})
