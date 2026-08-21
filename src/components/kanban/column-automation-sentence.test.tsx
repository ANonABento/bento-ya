import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Agent, ExitCriteria, TriggerAction } from '@/types'
import { useRosterStore } from '@/stores/roster-store'
import { AutomationSentence } from './column-automation-sentence'
import { automationSummary } from './column-recipes'

function setup(onEntry: TriggerAction = { type: 'none' }, exit: ExitCriteria = { type: 'manual' }) {
  const setOnEntry = vi.fn()
  const setExitCriteria = vi.fn()
  render(
    <AutomationSentence
      onEntry={onEntry}
      setOnEntry={setOnEntry}
      exitCriteria={exit}
      setExitCriteria={setExitCriteria}
    />,
  )
  return { setOnEntry, setExitCriteria }
}

const agent = (id: string, name: string, runtime: Agent['runtime']): Agent => ({
  id,
  name,
  role: '',
  runtime,
  config: JSON.stringify({ runtime }),
  avatar: '{}',
  createdAt: '',
  updatedAt: '',
})

/** Seed the roster without hitting IPC — `load()` is a no-op once `loaded`. */
function seedRoster(agents: Agent[]) {
  useRosterStore.setState({ agents, skills: [], runtimes: [], loaded: true })
}

beforeEach(() => {
  seedRoster([])
})

describe('AutomationSentence', () => {
  it('renders the sentence and the recipe gallery', () => {
    setup()
    expect(screen.getByTestId('automation-sentence')).toBeInTheDocument()
    expect(screen.getByText('Code it')).toBeInTheDocument()
    expect(screen.getByText('Review + approve')).toBeInTheDocument()
  })

  it('"Code it" recipe wires spawn_cli + agent_complete + auto-advance', () => {
    const { setOnEntry, setExitCriteria } = setup()
    fireEvent.click(screen.getByText('Code it'))
    expect(setOnEntry).toHaveBeenCalledWith(expect.objectContaining({ type: 'spawn_cli', cli: 'claude' }))
    expect(setExitCriteria).toHaveBeenCalledWith({ type: 'agent_complete', auto_advance: true })
  })

  it('shows the CLI + model tokens only for the run-an-agent action', () => {
    setup({ type: 'spawn_cli', cli: 'claude' })
    expect(screen.getByLabelText('Model')).toBeInTheDocument()
    expect(screen.getByLabelText('CLI')).toBeInTheDocument()
  })

  it('hides the agent tokens for non-agent actions', () => {
    setup({ type: 'create_pr', base_branch: 'main' })
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument()
  })

  it('offers roster agents alongside the bare-CLI escape hatch', () => {
    seedRoster([agent('a1', 'Code Smith', 'claude')])
    setup({ type: 'spawn_cli', cli: 'claude' })
    const picker = screen.getByLabelText('Agent')
    expect(picker).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Code Smith' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'a bare CLI' })).toBeInTheDocument()
  })

  it('attaching an agent removes the CLI token, because the agent owns it', () => {
    seedRoster([agent('a1', 'Code Smith', 'claude')])
    setup({ type: 'spawn_cli', agent_id: 'a1' })
    expect(screen.queryByLabelText('CLI')).not.toBeInTheDocument()
    // Model survives — the one override the spec allows a column to keep.
    expect(screen.getByLabelText('Model')).toBeInTheDocument()
  })

  it('relabels the default model option to point at the agent', () => {
    seedRoster([agent('a1', 'Code Smith', 'claude')])
    setup({ type: 'spawn_cli', agent_id: 'a1' })
    expect(screen.getByRole('option', { name: "the agent's model" })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'auto' })).not.toBeInTheDocument()
  })

  it('drops the model token for a script agent, which has no model', () => {
    seedRoster([agent('a2', 'Video Editor', 'script')])
    setup({ type: 'spawn_cli', agent_id: 'a2' })
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('CLI')).not.toBeInTheDocument()
    expect(screen.getByText('as-is')).toBeInTheDocument()
  })

  it('surfaces an agent the roster no longer has instead of silently resetting', () => {
    seedRoster([agent('a1', 'Code Smith', 'claude')])
    setup({ type: 'spawn_cli', agent_id: 'deleted-agent' })
    expect(screen.getByRole('option', { name: 'missing agent' })).toBeInTheDocument()
  })

  it('choosing the bare CLI clears the agent and restores a CLI', () => {
    seedRoster([agent('a1', 'Code Smith', 'claude')])
    const { setOnEntry } = setup({ type: 'spawn_cli', agent_id: 'a1' })
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: '__bare_cli__' } })
    expect(setOnEntry).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: undefined, cli: 'claude' }),
    )
  })

  it('picking an agent stores its id', () => {
    seedRoster([agent('a1', 'Code Smith', 'claude')])
    const { setOnEntry } = setup({ type: 'spawn_cli', cli: 'claude' })
    fireEvent.change(screen.getByLabelText('Agent'), { target: { value: 'a1' } })
    expect(setOnEntry).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'a1' }))
  })

  it('picking a real exit condition implies auto-advance; "manually" does not', () => {
    const { setExitCriteria } = setup({ type: 'spawn_cli' }, { type: 'manual' })
    fireEvent.change(screen.getByLabelText('Advance when'), { target: { value: 'agent_complete' } })
    expect(setExitCriteria).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent_complete', auto_advance: true }))
    fireEvent.change(screen.getByLabelText('Advance when'), { target: { value: 'manual' } })
    expect(setExitCriteria).toHaveBeenCalledWith(expect.objectContaining({ type: 'manual', auto_advance: false }))
  })
})

describe('automationSummary', () => {
  it('reads "No automation" for a plain column', () => {
    expect(automationSummary({ type: 'none' }, { type: 'manual' })).toBe('No automation')
  })
  it('reads a plain-language summary for an agent column', () => {
    expect(automationSummary({ type: 'spawn_cli' }, { type: 'agent_complete' })).toBe(
      'Run an agent · advance when the agent finishes',
    )
  })
})
