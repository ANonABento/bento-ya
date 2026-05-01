import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { getWorkspaceUsage, type UsageRecord } from '@/lib/ipc/usage'
import { ModelComparisonSection, type ComparableModel } from './model-comparison-section'

vi.mock('@/lib/ipc/usage', () => ({
  getWorkspaceUsage: vi.fn(),
}))

const models: ComparableModel[] = [
  {
    providerId: 'anthropic',
    providerName: 'Anthropic',
    id: 'claude-sonnet-4-6-20260217',
    displayName: 'Claude Sonnet 4.6',
    alias: 'sonnet',
    tier: 'standard',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    inputCostPerM: 3,
    outputCostPerM: 15,
    capabilities: ['code', 'tools', 'vision', 'reasoning'],
    isNew: false,
  },
]

const usageRecord = (overrides: Partial<UsageRecord>): UsageRecord => ({
  id: 'usage-1',
  workspaceId: 'ws-1',
  taskId: null,
  sessionId: null,
  provider: 'anthropic',
  model: 'claude-sonnet-4-6-20260217',
  inputTokens: 1_000,
  outputTokens: 500,
  costUsd: 0.01,
  columnName: null,
  durationSeconds: 0,
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

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
      usageRecord({
        id: 'usage-1',
        model: 'sonnet',
        inputTokens: 1_000,
        outputTokens: 500,
        costUsd: 0.01,
      }),
      usageRecord({
        id: 'usage-2',
        model: 'claude-sonnet-4-6-20260217',
        inputTokens: 500,
        outputTokens: 1_000,
        costUsd: 0.02,
      }),
    ])

    render(<ModelComparisonSection models={models} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    await waitFor(() => {
      const row = screen.getByRole('row', { name: /claude sonnet 4\.6/i })
      const cells = within(row).getAllByRole('cell')

      expect(cells.map((cell) => cell.textContent)).toEqual(
        expect.arrayContaining(['2', '3.0K', '$0.03']),
      )
    })
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
    expect(screen.getByText('$3')).toBeInTheDocument()
    expect(screen.getByText('$15')).toBeInTheDocument()
  })

  it('handles empty model lists without fetching usage', () => {
    render(<ModelComparisonSection models={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(screen.getByText('Enable a provider to compare available models.')).toBeInTheDocument()
    expect(getWorkspaceUsage).not.toHaveBeenCalled()
  })

  it('shows usage error state without hiding model metadata', async () => {
    vi.mocked(getWorkspaceUsage).mockRejectedValue(new Error('usage failed'))

    render(<ModelComparisonSection models={models} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(await screen.findByText('Usage data is unavailable right now.')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet 4.6')).toBeInTheDocument()
  })

  it('renders dynamic rows with null prices and no capabilities', async () => {
    const dynamicModels: ComparableModel[] = [
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        id: 'codex-preview-custom',
        displayName: 'Codex Preview Custom',
        alias: null,
        tier: 'flagship',
        contextWindow: 128_000,
        maxOutputTokens: 32_000,
        inputCostPerM: null,
        outputCostPerM: null,
        capabilities: [],
        isNew: true,
      },
    ]

    render(<ModelComparisonSection models={dynamicModels} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(await screen.findByText('No usage records in this workspace yet.')).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /codex preview custom/i })
    expect(within(row).getAllByText('--')).toHaveLength(3)
    expect(within(row).getByText('New')).toBeInTheDocument()
  })
})
