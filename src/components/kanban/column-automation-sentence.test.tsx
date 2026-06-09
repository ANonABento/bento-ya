import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ExitCriteria, TriggerAction } from '@/types'
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
      'Run an AI agent · advance when the agent finishes',
    )
  })
})
