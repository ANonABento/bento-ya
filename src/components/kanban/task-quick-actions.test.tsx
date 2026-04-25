import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskQuickActions } from './task-quick-actions'
import type { Task } from '@/types'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    workspaceId: 'ws-1',
    columnId: 'c1',
    title: 'Test task',
    description: '',
    branch: null,
    agentType: null,
    agentMode: null,
    agentStatus: 'idle',
    queuedAt: null,
    pipelineState: 'idle',
    pipelineTriggeredAt: null,
    pipelineError: null,
    retryCount: 0,
    model: null,
    lastScriptExitCode: null,
    reviewStatus: null,
    prNumber: null,
    prUrl: null,
    siegeIteration: 0,
    siegeActive: false,
    siegeMaxIterations: 3,
    siegeLastChecked: null,
    prMergeable: null,
    prCiStatus: null,
    prReviewDecision: null,
    prCommentCount: 0,
    prIsDraft: false,
    prLabels: '[]',
    prLastFetched: null,
    prHeadSha: null,
    checklist: null,
    notifyStakeholders: null,
    notificationSentAt: null,
    triggerOverrides: null,
    triggerPrompt: null,
    lastOutput: null,
    dependencies: null,
    blocked: false,
    worktreePath: null,
    position: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeHandlers() {
  return {
    onOpen: vi.fn(),
    onToggleAgent: vi.fn(),
    onRetry: vi.fn(),
    onMoveNext: vi.fn(),
    onRequestDelete: vi.fn(),
    onShowMenu: vi.fn(),
  }
}

describe('TaskQuickActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Play when task is idle and column has a trigger', () => {
    render(
      <TaskQuickActions
        task={makeTask({ agentStatus: 'idle' })}
        hasNextColumn={false}
        columnHasTrigger={true}
        isDeleteConfirmPending={false}
        {...makeHandlers()}
      />
    )
    expect(screen.getByTitle(/Run agent/)).toBeInTheDocument()
  })

  it('hides Play when column has no trigger and task is idle', () => {
    render(
      <TaskQuickActions
        task={makeTask({ agentStatus: 'idle' })}
        hasNextColumn={false}
        columnHasTrigger={false}
        isDeleteConfirmPending={false}
        {...makeHandlers()}
      />
    )
    expect(screen.queryByTitle(/Run agent/)).not.toBeInTheDocument()
    expect(screen.queryByTitle(/Stop agent/)).not.toBeInTheDocument()
  })

  it('shows Stop whenever task is running, regardless of trigger', () => {
    render(
      <TaskQuickActions
        task={makeTask({ agentStatus: 'running' })}
        hasNextColumn={false}
        columnHasTrigger={false}
        isDeleteConfirmPending={false}
        {...makeHandlers()}
      />
    )
    expect(screen.getByTitle(/Stop agent/)).toBeInTheDocument()
  })

  it('shows Retry only when task.pipelineError is truthy', () => {
    const handlers = makeHandlers()
    const { rerender } = render(
      <TaskQuickActions
        task={makeTask({ pipelineError: null })}
        hasNextColumn={false}
        columnHasTrigger={false}
        isDeleteConfirmPending={false}
        {...handlers}
      />
    )
    expect(screen.queryByTitle(/Retry pipeline/)).not.toBeInTheDocument()

    rerender(
      <TaskQuickActions
        task={makeTask({ pipelineError: 'boom' })}
        hasNextColumn={false}
        columnHasTrigger={false}
        isDeleteConfirmPending={false}
        {...handlers}
      />
    )
    expect(screen.getByTitle(/Retry pipeline/)).toBeInTheDocument()
  })

  it('shows Move-next only when hasNextColumn is true', () => {
    const handlers = makeHandlers()
    const { rerender } = render(
      <TaskQuickActions
        task={makeTask()}
        hasNextColumn={false}
        columnHasTrigger={false}
        isDeleteConfirmPending={false}
        {...handlers}
      />
    )
    expect(screen.queryByTitle(/Move to next column/)).not.toBeInTheDocument()

    rerender(
      <TaskQuickActions
        task={makeTask()}
        hasNextColumn={true}
        columnHasTrigger={false}
        isDeleteConfirmPending={false}
        {...handlers}
      />
    )
    expect(screen.getByTitle(/Move to next column/)).toBeInTheDocument()
  })

  it('delete button title and style reflect isDeleteConfirmPending prop', () => {
    const handlers = makeHandlers()
    const { rerender } = render(
      <TaskQuickActions
        task={makeTask()}
        hasNextColumn={false}
        columnHasTrigger={false}
        isDeleteConfirmPending={false}
        {...handlers}
      />
    )
    expect(screen.getByTitle(/Delete task/)).not.toHaveClass('bg-error/20')
    expect(screen.queryByTitle(/Click again to confirm/)).not.toBeInTheDocument()

    rerender(
      <TaskQuickActions
        task={makeTask()}
        hasNextColumn={false}
        columnHasTrigger={false}
        isDeleteConfirmPending={true}
        {...handlers}
      />
    )
    expect(screen.getByTitle(/Click again to confirm/)).toHaveClass('bg-error/20')
    expect(screen.queryByTitle(/^Delete task/)).not.toBeInTheDocument()
  })

  it('delete button calls onRequestDelete and stops propagation', () => {
    const handlers = makeHandlers()
    const cardClick = vi.fn()
    render(
      <div onClick={cardClick}>
        <TaskQuickActions
          task={makeTask()}
          hasNextColumn={false}
          columnHasTrigger={false}
          isDeleteConfirmPending={false}
          {...handlers}
        />
      </div>
    )
    fireEvent.click(screen.getByTitle(/Delete task/))
    expect(handlers.onRequestDelete).toHaveBeenCalledTimes(1)
    expect(cardClick).not.toHaveBeenCalled()
  })

  it('button keyboard events do not bubble to card shortcuts', () => {
    const handlers = makeHandlers()
    const cardKeyDown = vi.fn()
    render(
      <div onKeyDown={cardKeyDown}>
        <TaskQuickActions
          task={makeTask({ pipelineError: 'boom' })}
          hasNextColumn={true}
          columnHasTrigger={true}
          isDeleteConfirmPending={false}
          {...handlers}
        />
      </div>
    )
    fireEvent.keyDown(screen.getByTitle(/Delete task/), { key: 'Enter' })
    expect(cardKeyDown).not.toHaveBeenCalled()
  })

  it('two-click confirm-to-delete: first click arms, second click fires', () => {
    const handlers = makeHandlers()
    const { rerender } = render(
      <TaskQuickActions
        task={makeTask()}
        hasNextColumn={false}
        columnHasTrigger={false}
        isDeleteConfirmPending={false}
        {...handlers}
      />
    )
    // First click — parent would arm confirmation
    fireEvent.click(screen.getByTitle(/Delete task/))
    expect(handlers.onRequestDelete).toHaveBeenCalledTimes(1)

    // Parent rerenders in armed state
    rerender(
      <TaskQuickActions
        task={makeTask()}
        hasNextColumn={false}
        columnHasTrigger={false}
        isDeleteConfirmPending={true}
        {...handlers}
      />
    )
    // Second click on the armed button — parent would fire the actual delete
    fireEvent.click(screen.getByTitle(/Click again to confirm/))
    expect(handlers.onRequestDelete).toHaveBeenCalledTimes(2)
  })

  it('always renders Open and More buttons', () => {
    render(
      <TaskQuickActions
        task={makeTask()}
        hasNextColumn={false}
        columnHasTrigger={false}
        isDeleteConfirmPending={false}
        {...makeHandlers()}
      />
    )
    expect(screen.getByTitle(/Open task/)).toBeInTheDocument()
    expect(screen.getByTitle(/More actions/)).toBeInTheDocument()
  })

  it('does not intercept card clicks while visually hidden', () => {
    const { container } = render(
      <TaskQuickActions
        task={makeTask()}
        hasNextColumn={true}
        columnHasTrigger={true}
        isDeleteConfirmPending={false}
        {...makeHandlers()}
      />
    )

    const actionStrip = container.querySelector('[data-task-quick-actions="true"]')
    expect(actionStrip).toHaveClass('pointer-events-none')
    expect(actionStrip).toHaveClass('group-hover:pointer-events-auto')
    expect(actionStrip).toHaveClass('focus-within:pointer-events-auto')
  })
})
