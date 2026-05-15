import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TaskQuickActions } from './task-quick-actions'

function makeHandlers() {
  return {
    onDelete: vi.fn(),
    onShowMenu: vi.fn(),
  }
}

describe('TaskQuickActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps card quick actions collapsed into the overflow menu', () => {
    render(
      <TaskQuickActions
        {...makeHandlers()}
      />
    )
    expect(screen.getByTitle(/More actions/)).toBeInTheDocument()
    expect(screen.queryByTitle(/Open task/)).not.toBeInTheDocument()
    expect(screen.queryByTitle(/Run agent/)).not.toBeInTheDocument()
    expect(screen.queryByTitle(/Stop agent/)).not.toBeInTheDocument()
    expect(screen.queryByTitle(/Retry pipeline/)).not.toBeInTheDocument()
    expect(screen.queryByTitle(/Move to next column/)).not.toBeInTheDocument()
  })

  it('opens the overflow menu from the single action button', () => {
    const handlers = makeHandlers()
    render(
      <TaskQuickActions
        {...handlers}
      />
    )

    fireEvent.click(screen.getByTitle(/More actions/))
    expect(handlers.onShowMenu).toHaveBeenCalledTimes(1)
  })

  it('shows the temporary delete confirmation without restoring the full action cluster', () => {
    const handlers = makeHandlers()
    render(
      <TaskQuickActions
        {...handlers}
        confirmDeletePending
      />
    )

    expect(screen.getByTitle(/Click again to confirm/)).toBeInTheDocument()
    expect(screen.getByTitle(/More actions/)).toBeInTheDocument()
    fireEvent.click(screen.getByTitle(/Click again to confirm/))
    expect(handlers.onDelete).toHaveBeenCalledTimes(1)
  })
})
