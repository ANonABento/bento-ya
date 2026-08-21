import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { RosterView } from './roster-view'
import { useRosterStore } from '@/stores/roster-store'
import type { Agent } from '@/types'

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
    // LLM agent: prompt/model/skills, no command.
    expect(screen.getByText('prompt')).toBeInTheDocument()
    expect(screen.getByText('model')).toBeInTheDocument()
    expect(screen.queryByText('command')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('agent-tile-a2'))
    // Script agent: command/args/env, no prompt.
    expect(screen.getByText('command')).toBeInTheDocument()
    expect(screen.getByText('env')).toBeInTheDocument()
    expect(screen.queryByText('prompt')).not.toBeInTheDocument()
  })

  it('shows an empty dossier prompt until an agent is picked', () => {
    seed([agent()])
    render(<RosterView />)
    expect(screen.queryByTestId('agent-dossier')).not.toBeInTheDocument()
    expect(screen.getByText(/select an agent/i)).toBeInTheDocument()
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
