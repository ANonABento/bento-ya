import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TriggerAction } from '@/types'
import { AdvancedTriggerEditor } from './column-trigger-advanced-editor'

const { actionEditorSpy } = vi.hoisted(() => ({
  actionEditorSpy: vi.fn(({ showMoveColumn }: { showMoveColumn?: boolean }) => (
    <div data-testid={showMoveColumn ? 'exit-editor' : 'entry-editor'} />
  )),
}))

vi.mock('./column-trigger-action-editors', () => ({
  ActionEditor: actionEditorSpy,
}))

describe('AdvancedTriggerEditor', () => {
  it('renders entry and exit sections and only enables move-column actions on exit', () => {
    const action = { type: 'none' } as TriggerAction

    render(
      <AdvancedTriggerEditor
        onEntry={action}
        setOnEntry={vi.fn()}
        onExit={action}
        setOnExit={vi.fn()}
      />,
    )

    expect(screen.getByText('On Entry')).toBeInTheDocument()
    expect(screen.getByText('On Exit')).toBeInTheDocument()
    expect(screen.getByTestId('entry-editor')).toBeInTheDocument()
    expect(screen.getByTestId('exit-editor')).toBeInTheDocument()
    expect(actionEditorSpy).toHaveBeenCalledTimes(2)
    expect(actionEditorSpy.mock.calls[0]?.[0].showMoveColumn).toBeUndefined()
    expect(actionEditorSpy.mock.calls[1]?.[0].showMoveColumn).toBe(true)
  })
})
