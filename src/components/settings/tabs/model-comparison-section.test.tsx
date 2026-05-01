import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { getWorkspaceUsage } from '@/lib/ipc/usage'
import { ModelComparisonSection, type ComparableModel } from './model-comparison-section'

vi.mock('@/lib/ipc/usage', () => ({
  getWorkspaceUsage: vi.fn(),
}))

const model = (overrides: Partial<ComparableModel> = {}): ComparableModel => ({
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
  capabilities: ['code', 'tools', 'vision'],
  isNew: false,
  ...overrides,
})

const models: ComparableModel[] = [model()]

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
    expect(getWorkspaceUsage).not.toHaveBeenCalled()
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

  it('calls usage IPC when expanded and an active workspace exists', async () => {
    render(<ModelComparisonSection models={models} />)

    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    await waitFor(() => {
      expect(getWorkspaceUsage).toHaveBeenCalledWith('ws-1', 500)
    })
  })

  it('does not call usage IPC without an active workspace', () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null })

    render(<ModelComparisonSection models={models} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(screen.getByText('Select a workspace to include usage totals.')).toBeInTheDocument()
    expect(getWorkspaceUsage).not.toHaveBeenCalled()
  })

  it('does not call usage IPC when there are zero comparable models', () => {
    render(<ModelComparisonSection models={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(screen.getByText('Enable a provider to compare available models.')).toBeInTheDocument()
    expect(getWorkspaceUsage).not.toHaveBeenCalled()
  })

  it('shows exact ID usage in the matching row', async () => {
    vi.mocked(getWorkspaceUsage).mockResolvedValue([
      {
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
      },
    ])

    render(<ModelComparisonSection models={models} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    await waitFor(() => {
      const row = screen.getByRole('row', { name: /claude sonnet 4\.6/i })
      const cells = within(row).getAllByRole('cell')

      expect(cells.map((cell) => cell.textContent)).toEqual(
        expect.arrayContaining(['1', '1.5K', '$0.01']),
      )
    })
  })

  it('shows alias usage in the matching row', async () => {
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
        columnName: null,
        durationSeconds: 0,
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
        columnName: null,
        durationSeconds: 0,
        createdAt: '2026-01-01T00:00:00Z',
      },
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

  it('renders static model metadata from props when usage is empty', async () => {
    render(<ModelComparisonSection models={models} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(await screen.findByText('No usage records in this workspace yet.')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet 4.6')).toBeInTheDocument()
    expect(screen.getByText('claude-sonnet-4-6-20260217')).toBeInTheDocument()
    expect(screen.getByText('alias: sonnet')).toBeInTheDocument()
    expect(screen.getByText('$3')).toBeInTheDocument()
    expect(screen.getByText('$15')).toBeInTheDocument()
    expect(screen.getByText('200.0K')).toBeInTheDocument()
    expect(screen.getByText('64.0K')).toBeInTheDocument()
  })

  it('shows a non-fatal usage error state', async () => {
    vi.mocked(getWorkspaceUsage).mockRejectedValue(new Error('usage failed'))

    render(<ModelComparisonSection models={models} />)
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(await screen.findByText('Usage data is unavailable right now.')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet 4.6')).toBeInTheDocument()
  })

  it('renders unknown and new dynamic model metadata without crashing', async () => {
    render(
      <ModelComparisonSection
        models={[
          model({
            providerId: 'custom',
            providerName: 'Custom',
            id: 'provider-new-model-2026',
            displayName: 'Provider New Model',
            alias: null,
            tier: 'fast',
            inputCostPerM: null,
            outputCostPerM: null,
            capabilities: [],
            isNew: true,
          }),
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /model comparison/i }))

    expect(await screen.findByText('Provider New Model')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(3)
  })
})
