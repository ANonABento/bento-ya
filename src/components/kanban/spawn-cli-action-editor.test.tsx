import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SpawnCliAction } from '@/types'
import { SpawnCliActionEditor } from './spawn-cli-action-editor'

const baseAction: SpawnCliAction = {
  type: 'spawn_cli',
  cli: 'claude',
  command: '/start-task',
  prompt_template: '{task.title}',
  use_queue: true,
  runtime_mode: 'terminal',
}

describe('SpawnCliActionEditor', () => {
  it('shows terminal runtime as the default selected mode', () => {
    render(<SpawnCliActionEditor action={{ ...baseAction, runtime_mode: undefined }} setAction={vi.fn()} />)

    expect(screen.getByRole('button', { name: /terminal/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /managed/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('sets managed runtime mode', () => {
    const setAction = vi.fn()

    render(<SpawnCliActionEditor action={baseAction} setAction={setAction} />)
    fireEvent.click(screen.getByRole('button', { name: /managed/i }))

    expect(setAction).toHaveBeenCalledWith({
      ...baseAction,
      runtime_mode: 'managed',
    })
  })

  it('sets terminal runtime mode', () => {
    const setAction = vi.fn()

    render(<SpawnCliActionEditor action={{ ...baseAction, runtime_mode: 'managed' }} setAction={setAction} />)
    fireEvent.click(screen.getByRole('button', { name: /terminal/i }))

    expect(setAction).toHaveBeenCalledWith({
      ...baseAction,
      runtime_mode: 'terminal',
    })
  })

  it('shows Auto model as selected by default when no model set', () => {
    render(<SpawnCliActionEditor action={baseAction} setAction={vi.fn()} />)

    expect(screen.getByRole('button', { name: /auto/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /opus/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('selects Opus model and calls setAction with model value', () => {
    const setAction = vi.fn()
    render(<SpawnCliActionEditor action={baseAction} setAction={setAction} />)

    fireEvent.click(screen.getByRole('button', { name: /opus/i }))

    expect(setAction).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-5' })
    )
  })

  it('selects Sonnet model and calls setAction with model value', () => {
    const setAction = vi.fn()
    render(<SpawnCliActionEditor action={baseAction} setAction={setAction} />)

    fireEvent.click(screen.getByRole('button', { name: /sonnet/i }))

    expect(setAction).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-5' })
    )
  })

  it('clears model when Auto is selected', () => {
    const setAction = vi.fn()
    render(
      <SpawnCliActionEditor
        action={{ ...baseAction, model: 'claude-opus-4-5' }}
        setAction={setAction}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /auto/i }))

    const call = setAction.mock.calls[0][0] as SpawnCliAction
    expect(call.model).toBeUndefined()
  })

  it('shows warning when managed runtime is selected', () => {
    render(<SpawnCliActionEditor action={{ ...baseAction, runtime_mode: 'managed' }} setAction={vi.fn()} />)

    expect(screen.getByText(/managed mode streams structured events/i)).toBeInTheDocument()
  })

  it('does not show managed warning for terminal mode', () => {
    render(<SpawnCliActionEditor action={baseAction} setAction={vi.fn()} />)

    expect(screen.queryByText(/managed mode streams/i)).not.toBeInTheDocument()
  })

  it('shows queue badge with max 3 concurrent text', () => {
    render(<SpawnCliActionEditor action={baseAction} setAction={vi.fn()} />)

    expect(screen.getByText(/max 3 concurrent/i)).toBeInTheDocument()
  })
})
