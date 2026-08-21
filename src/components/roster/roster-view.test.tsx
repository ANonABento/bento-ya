import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { RosterView } from './roster-view'
import { useRosterStore } from '@/stores/roster-store'
import * as ipc from '@/lib/ipc'
import type { Agent, AgentUsage } from '@/types'

vi.mock('@/lib/ipc', async (orig) => ({
  ...(await orig<typeof ipc>()),
  getAgentUsage: vi.fn(),
}))

const usageMock = vi.mocked(ipc.getAgentUsage)

function usedBy(...rows: Partial<AgentUsage>[]) {
  usageMock.mockResolvedValue(
    rows.map((r, i) => ({
      workspaceId: 'ws-1',
      workspaceName: 'Alpha',
      columnId: `col-${String(i)}`,
      columnName: 'Working',
      hook: 'on_entry',
      ...r,
    })),
  )
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'a1',
    name: 'Code Smith',
    role: 'Writes the code',
    runtime: 'claude',
    config: JSON.stringify({
      runtime: 'claude',
      systemPrompt: 'Implement it.',
      model: 'opus',
      mcpConfigPath: '',
      allowedTools: [],
      skillIds: [],
    }),
    avatar: JSON.stringify({ initials: 'CS', gradientFrom: '#000', gradientTo: '#111' }),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  }
}

const scriptAgent = agent({
  id: 'a2',
  name: 'Video Editor',
  role: 'Renders the cut',
  runtime: 'script',
  config: JSON.stringify({
    runtime: 'script',
    command: './render.sh',
    args: ['--out', 'cut.mp4'],
    env: { FFMPEG_PRESET: 'fast' },
  }),
  avatar: JSON.stringify({ initials: 'VE', gradientFrom: '#222', gradientTo: '#333' }),
})

function seed(agents: Agent[]) {
  useRosterStore.setState({
    agents,
    skills: [],
    runtimes: [],
    loaded: true,
    load: async () => Promise.resolve(),
    reload: async () => Promise.resolve(),
  })
}

describe('RosterView', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    usageMock.mockResolvedValue([])
  })

  it('the dossier says where an agent actually runs', async () => {
    usedBy({ columnName: 'Working' }, { columnName: 'Review', workspaceName: 'Beta' })
    seed([agent()])
    render(<RosterView />)
    fireEvent.click(screen.getByTestId('agent-tile-a1'))
    expect(await screen.findByText('Working')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('the dossier says so plainly when nothing uses the agent', async () => {
    seed([agent()])
    render(<RosterView />)
    fireEvent.click(screen.getByTestId('agent-tile-a1'))
    expect(await screen.findByText(/Not attached to a column yet/)).toBeInTheDocument()
  })

  it('the delete confirmation names the columns that would break', async () => {
    usedBy({ columnName: 'Working', workspaceName: 'Alpha' })
    seed([agent()])
    render(<RosterView />)
    fireEvent.click(screen.getByTestId('agent-tile-a1'))
    await screen.findByText('Working')
    fireEvent.click(screen.getByTestId('agent-delete'))
    expect(
      await screen.findByText(/Working \(Alpha\) still runs this agent/),
    ).toBeInTheDocument()
  })

  it('filters the grid by runtime', () => {
    seed([agent(), scriptAgent])
    render(<RosterView />)

    expect(screen.getByTestId('agent-tile-a1')).toBeInTheDocument()
    expect(screen.getByTestId('agent-tile-a2')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('roster-filter-script'))

    expect(screen.queryByTestId('agent-tile-a1')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-tile-a2')).toBeInTheDocument()
  })

  it('swaps the dossier shape with the runtime — the load-bearing behaviour', () => {
    seed([agent(), scriptAgent])
    render(<RosterView />)

    fireEvent.click(screen.getByTestId('agent-tile-a1'))
    // LLM agent: instructions / model / tools / skills, and no command.
    expect(screen.getByText('Instructions')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.queryByText('Command')).not.toBeInTheDocument()
    expect(screen.queryByText('Environment')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('agent-tile-a2'))
    // Script agent: command / arguments / environment, and no prompt or skills.
    expect(screen.getByText('Command')).toBeInTheDocument()
    expect(screen.getByText('Environment')).toBeInTheDocument()
    expect(screen.queryByText('Instructions')).not.toBeInTheDocument()
    expect(screen.queryByText('Skills')).not.toBeInTheDocument()
  })

  it('shows an empty dossier prompt until an agent is picked', () => {
    seed([agent()])
    render(<RosterView />)
    expect(screen.queryByTestId('agent-dossier')).not.toBeInTheDocument()
    expect(screen.getByText(/pick an agent/i)).toBeInTheDocument()
  })

  it('drops the selection when the selected agent is filtered out', () => {
    // A dossier for an agent no longer in the visible set would render stale
    // data (or throw, if it had been deleted).
    seed([agent(), scriptAgent])
    render(<RosterView />)

    fireEvent.click(screen.getByTestId('agent-tile-a1'))
    expect(screen.getByTestId('agent-dossier')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('roster-filter-script'))
    expect(screen.queryByTestId('agent-dossier')).not.toBeInTheDocument()
  })

  it('opens the editor prefilled when duplicating', async () => {
    seed([agent()])
    render(<RosterView />)

    fireEvent.click(screen.getByTestId('agent-tile-a1'))
    fireEvent.click(screen.getByTestId('agent-duplicate'))

    await waitFor(() => {
      expect(screen.getByTestId('agent-editor')).toBeInTheDocument()
    })
    expect(screen.getByTestId('agent-name-input')).toHaveValue('Code Smith copy')
  })

  it('confirms before deleting', () => {
    seed([agent()])
    render(<RosterView />)

    fireEvent.click(screen.getByTestId('agent-tile-a1'))
    fireEvent.click(screen.getByTestId('agent-delete'))

    expect(screen.getByTestId('roster-confirm-delete')).toBeInTheDocument()
  })
})
