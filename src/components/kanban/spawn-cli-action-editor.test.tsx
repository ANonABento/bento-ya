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
})
