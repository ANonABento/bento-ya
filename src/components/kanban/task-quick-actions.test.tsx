import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskQuickActions } from './task-quick-actions'
import { mockKanbanTask } from '@/test/mocks/tauri'

function makeHandlers() {
  return {
    onOpen: vi.fn(),
    onToggleAgent: vi.fn(),
    onRetry: vi.fn(),
    onMoveNext: vi.fn(),
    onDelete: vi.fn(),
    onShowMenu: vi.fn(),
  }
}

describe('TaskQuickActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Play when task is idle', () => {
    render(
      <TaskQuickActions
        task={mockKanbanTask({ agentStatus: 'idle' })}
        hasNextColumn={false}
        {...makeHandlers()}
      />
    )
    expect(screen.getByTitle(/Run agent/)).toBeInTheDocument()
  })

  it('shows Stop when task is running', () => {
    render(
      <TaskQuickActions
        task={mockKanbanTask({ agentStatus: 'running' })}
        hasNextColumn={false}
        {...makeHandlers()}
      />
    )
    expect(screen.getByTitle(/Stop agent/)).toBeInTheDocument()
  })

  it('shows Retry only when task.pipelineError is truthy', () => {
    const handlers = makeHandlers()
    const { rerender } = render(
      <TaskQuickActions
        task={mockKanbanTask({ pipelineError: null })}
        hasNextColumn={false}
        {...handlers}
      />
    )
    expect(screen.queryByTitle(/Retry pipeline/)).not.toBeInTheDocument()

    rerender(
      <TaskQuickActions
        task={mockKanbanTask({ pipelineError: 'boom' })}
        hasNextColumn={false}
        {...handlers}
      />
    )
    expect(screen.getByTitle(/Retry pipeline/)).toBeInTheDocument()
  })

  it('shows Move-next only when hasNextColumn is true', () => {
    const handlers = makeHandlers()
    const { rerender } = render(
      <TaskQuickActions
        task={mockKanbanTask()}
        hasNextColumn={false}
        {...handlers}
      />
    )
    expect(screen.queryByTitle(/Move to next column/)).not.toBeInTheDocument()

    rerender(
      <TaskQuickActions
        task={mockKanbanTask()}
        hasNextColumn={true}
        {...handlers}
      />
    )
    expect(screen.getByTitle(/Move to next column/)).toBeInTheDocument()
  })

  it('delete button has two-click confirm behavior', () => {
    const handlers = makeHandlers()
    render(
      <TaskQuickActions
        task={mockKanbanTask()}
        hasNextColumn={false}
        {...handlers}
      />
    )
    // First click arms confirmation (internal state)
    fireEvent.click(screen.getByTitle(/Delete task/))
    // After first click, button should show confirm state
    expect(screen.getByTitle(/Click again to confirm/)).toBeInTheDocument()

    // Second click fires the actual delete
    fireEvent.click(screen.getByTitle(/Click again to confirm/))
    expect(handlers.onDelete).toHaveBeenCalledTimes(1)
  })

  it('always renders Open and More buttons', () => {
    render(
      <TaskQuickActions
        task={mockKanbanTask()}
        hasNextColumn={false}
        {...makeHandlers()}
      />
    )
    expect(screen.getByTitle(/Open task/)).toBeInTheDocument()
    expect(screen.getByTitle(/More actions/)).toBeInTheDocument()
  })
})
