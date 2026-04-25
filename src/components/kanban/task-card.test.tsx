import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskCard } from './task-card'
import { useColumnStore } from '@/stores/column-store'
import { useTaskStore } from '@/stores/task-store'
import { useUIStore } from '@/stores/ui-store'
import type { Column, Task } from '@/types'
import { setupInvokeMock } from '@/test/mocks/tauri'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => undefined,
    },
  },
}))

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

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: 'c1',
    workspaceId: 'ws-1',
    name: 'Todo',
    icon: '',
    position: 0,
    color: '',
    visible: true,
    triggers: {
      on_entry: { type: 'spawn_cli' },
      on_exit: { type: 'none' },
      exit_criteria: { type: 'manual', auto_advance: false },
    },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function resetStores(task: Task) {
  useColumnStore.setState({
    columns: [
      makeColumn(),
      makeColumn({ id: 'c2', name: 'Doing', position: 1 }),
    ],
    loaded: true,
  })
  useTaskStore.setState({ tasks: [task], loaded: true })
  useUIStore.setState({ viewMode: 'board', activeTaskId: null, modal: null })
}

describe('TaskCard quick-action keyboard behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not run card shortcuts for key events from quick-action buttons', () => {
    const task = makeTask()
    resetStores(task)
    render(<TaskCard task={task} />)

    const deleteButton = screen.getByTitle(/Delete task/)
    fireEvent.keyDown(deleteButton, { key: ' ' })

    expect(useUIStore.getState().activeTaskId).toBeNull()
    expect(useTaskStore.getState().tasks[0]?.agentStatus).toBe('idle')
  })

  it('resets pending delete confirmation when the card task changes', () => {
    const task = makeTask()
    resetStores(task)
    const { rerender } = render(<TaskCard task={task} />)

    fireEvent.click(screen.getByTitle(/Delete task/))
    expect(screen.getByTitle(/Click again to confirm/)).toBeInTheDocument()

    const nextTask = makeTask({ id: 't2', title: 'Next task' })
    act(() => {
      resetStores(nextTask)
      rerender(<TaskCard task={nextTask} />)
    })

    expect(screen.getByTitle(/Delete task/)).toBeInTheDocument()
    expect(screen.queryByTitle(/Click again to confirm/)).not.toBeInTheDocument()
  })

  it('keyboard Space toggles the agent only when the current column can trigger work', () => {
    const task = makeTask()
    resetStores(task)
    const { rerender } = render(<TaskCard task={task} />)

    fireEvent.keyDown(screen.getByText('Test task'), { key: ' ' })
    expect(useTaskStore.getState().tasks[0]?.agentStatus).toBe('running')

    const triggerlessTask = makeTask({ id: 't2', title: 'Triggerless task' })
    act(() => {
      useColumnStore.setState({
        columns: [makeColumn({ triggers: { on_entry: { type: 'none' }, on_exit: { type: 'none' } } })],
        loaded: true,
      })
      useTaskStore.setState({ tasks: [triggerlessTask], loaded: true })
      rerender(<TaskCard task={triggerlessTask} />)
    })

    fireEvent.keyDown(screen.getByText('Triggerless task'), { key: ' ' })
    expect(useTaskStore.getState().tasks[0]?.agentStatus).toBe('idle')
  })

  it('keyboard ArrowRight moves to the next visible column', async () => {
    const task = makeTask()
    const invoke = await setupInvokeMock({ move_task: { ...task, columnId: 'c2', position: 0 } })
    resetStores(task)
    render(<TaskCard task={task} />)

    fireEvent.keyDown(screen.getByText('Test task'), { key: 'ArrowRight' })

    expect(useTaskStore.getState().tasks[0]?.columnId).toBe('c2')
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('move_task', { id: 't1', targetColumnId: 'c2', position: 0 })
    })
  })

  it('keyboard Delete requires a second confirmation before removing the task', async () => {
    const task = makeTask()
    const invoke = await setupInvokeMock({ delete_task: undefined })
    resetStores(task)
    render(<TaskCard task={task} />)

    fireEvent.keyDown(screen.getByText('Test task'), { key: 'Delete' })
    expect(useTaskStore.getState().tasks).toHaveLength(1)
    expect(screen.getByTitle(/Click again to confirm/)).toBeInTheDocument()

    fireEvent.keyDown(screen.getByText('Test task'), { key: 'Delete' })

    expect(useTaskStore.getState().tasks).toHaveLength(0)
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('delete_task', { id: 't1' })
    })
  })
})
