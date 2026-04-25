import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { getWorkspaceUsage } from '@/lib/ipc/usage'
import { aggregateUsageByModel } from '@/lib/model-usage'
import { ModelComparisonSection, type ComparableModel } from './model-comparison-section'

vi.mock('@/lib/ipc/usage', () => ({
  getWorkspaceUsage: vi.fn(),
}))

const models: ComparableModel[] = [
  {
    providerId: 'anthropic',
    providerName: 'Anthropic',
    modelId: 'claude-sonnet-4-6-20260217',
  },
]

describe('ModelComparisonSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: 'ws-1',
      loaded: true,
    })
    vi.mocked(getWorkspaceUsage).mockResolvedValue([])
  })

  it('renders collapsed by default', () => {
    render(<ModelComparisonSection models={models} />)

    expect(screen.getByText('Model Comparison')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('persists expanded and collapsed state through localStorage', async () => {
    render(<ModelComparisonSection models={models} />)

    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    await waitFor(() => {
      expect(window.localStorage.getItem('agent-tab-model-comparison-collapsed')).toBe('false')
    })

    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    await waitFor(() => {
      expect(window.localStorage.getItem('agent-tab-model-comparison-collapsed')).toBe('true')
    })
  })

  it('does not call usage IPC while collapsed', () => {
    render(<ModelComparisonSection models={models} />)

    expect(getWorkspaceUsage).not.toHaveBeenCalled()
  })

  it('calls usage IPC when expanded and an active workspace exists', async () => {
    render(<ModelComparisonSection models={models} />)

    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    await waitFor(() => {
      expect(getWorkspaceUsage).toHaveBeenCalledWith('ws-1', 500)
    })
  })

  it('aggregates usage by model id and aliases', async () => {
    vi.mocked(getWorkspaceUsage).mockResolvedValue([
      {
        id: 'usage-1',
        workspaceId: 'ws-1',
        taskId: null,
        sessionId: null,
        provider: 'anthropic',
        model: 'sonnet',
        inputTokens: 1_000,
        outputTokens: 500,
        costUsd: 0.01,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'usage-2',
        workspaceId: 'ws-1',
        taskId: null,
        sessionId: null,
        provider: 'anthropic',
        model: 'claude-sonnet-4-6-20260217',
        inputTokens: 500,
        outputTokens: 1_000,
        costUsd: 0.02,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ])

    render(<ModelComparisonSection models={models} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    const row = await screen.findByRole('row', { name: /claude sonnet 4\.6/i })
    const cells = within(row).getAllByRole('cell')

    expect(cells.map((cell) => cell.textContent)).toEqual(
      expect.arrayContaining(['2', '3.0K', '$0.03']),
    )
  })

  it('shows no-workspace state without calling usage IPC', () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null })

    render(<ModelComparisonSection models={models} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(screen.getByText('Select a workspace to include usage totals.')).toBeInTheDocument()
    expect(getWorkspaceUsage).not.toHaveBeenCalled()
  })

  it('shows empty state without hiding model metadata', async () => {
    render(<ModelComparisonSection models={models} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(await screen.findByText('No usage records in this workspace yet.')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet 4.6')).toBeInTheDocument()
  })

  it('aggregates alias records through the exported helper', () => {
    const usage = aggregateUsageByModel([
      {
        id: 'usage-1',
        workspaceId: 'ws-1',
        taskId: null,
        sessionId: null,
        provider: 'anthropic',
        model: 'sonnet',
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.01,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ])

    expect(usage['anthropic:claude-sonnet-4-6-20260217']).toMatchObject({
      calls: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUsd: 0.01,
    })
  })

  it('keeps usage for identical unknown model ids separate by provider', () => {
    const usage = aggregateUsageByModel([
      {
        id: 'usage-1',
        workspaceId: 'ws-1',
        taskId: null,
        sessionId: null,
        provider: 'openai',
        model: 'shared-model',
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.01,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'usage-2',
        workspaceId: 'ws-1',
        taskId: null,
        sessionId: null,
        provider: 'anthropic',
        model: 'shared-model',
        inputTokens: 20,
        outputTokens: 10,
        costUsd: 0.02,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ])

    expect(usage['openai:shared-model']?.totalTokens).toBe(15)
    expect(usage['anthropic:shared-model']?.totalTokens).toBe(30)
  })

  it('handles empty model lists without fetching usage', () => {
    render(<ModelComparisonSection models={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(screen.getByText('Enable a provider to compare available models.')).toBeInTheDocument()
    expect(getWorkspaceUsage).not.toHaveBeenCalled()
  })
})
