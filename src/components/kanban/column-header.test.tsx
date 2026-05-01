import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ColumnHeader } from './column-header'

describe('ColumnHeader', () => {
  it('allows renaming on double-click + Enter', () => {
    const onRename = vi.fn()
    render(
      <ColumnHeader
        name="Backlog"
        icon="list"
        taskCount={3}
        color="#123456"
        onConfigure={vi.fn()}
        onDelete={vi.fn()}
        onRename={onRename}
        onAddTask={vi.fn()}
      />
    )

    const title = screen.getByText('Backlog')
    fireEvent.dblClick(title)

    const input = screen.getByDisplayValue('Backlog')
    fireEvent.change(input, { target: { value: 'Ready' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)

    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('Ready')
  })

  it('cancels rename on Escape', () => {
    const onRename = vi.fn()
    render(
      <ColumnHeader
        name="Backlog"
        icon="list"
        taskCount={1}
        color="#123456"
        onConfigure={vi.fn()}
        onDelete={vi.fn()}
        onRename={onRename}
        onAddTask={vi.fn()}
      />
    )

    const title = screen.getByText('Backlog')
    fireEvent.dblClick(title)

    const input = screen.getByDisplayValue('Backlog')
    fireEvent.change(input, { target: { value: 'Cancelled' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onRename).not.toHaveBeenCalled()
  })

  it('opens column options from the context menu', () => {
    render(
      <ColumnHeader
        name="Backlog"
        icon="list"
        taskCount={1}
        color="#123456"
        onConfigure={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onAddTask={vi.fn()}
      />
    )

    const header = screen.getByText('Backlog').closest('div')
    if (header === null) {
      throw new Error('Expected column header container')
    }
    fireEvent.contextMenu(header)

    expect(screen.getByText('Configure')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})
