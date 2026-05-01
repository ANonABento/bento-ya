import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskCard } from './task-card'
import { useColumnStore } from '@/stores/column-store'
import { useTaskStore } from '@/stores/task-store'
import { useUIStore } from '@/stores/ui-store'
import type { Task } from '@/types'
import { mockKanbanColumn, mockKanbanTask, setupInvokeMock } from '@/test/mocks/tauri'

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

function resetStores(task: Task) {
  useColumnStore.setState({
    columns: [
      mockKanbanColumn(),
      mockKanbanColumn({ id: 'c2', name: 'Doing', position: 1 }),
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

  it('routes command-click and shift-click through selection handling', () => {
    const task = mockKanbanTask()
    const onSelectionChange = vi.fn()
    resetStores(task)

    render(<TaskCard task={task} onSelectionChange={onSelectionChange} />)

    fireEvent.click(screen.getByText('Test task'), { metaKey: true })
    fireEvent.click(screen.getByText('Test task'), { shiftKey: true })

    expect(onSelectionChange).toHaveBeenCalledTimes(2)
    expect(onSelectionChange).toHaveBeenNthCalledWith(1, 't1', expect.objectContaining({ metaKey: true }))
    expect(onSelectionChange).toHaveBeenNthCalledWith(2, 't1', expect.objectContaining({ shiftKey: true }))
  })

  it('does not run card shortcuts for key events from quick-action buttons', () => {
    const task = mockKanbanTask()
    resetStores(task)
    render(<TaskCard task={task} />)

    const deleteButton = screen.getByTitle(/Delete task/)
    fireEvent.keyDown(deleteButton, { key: ' ' })

    expect(useUIStore.getState().activeTaskId).toBeNull()
    expect(useTaskStore.getState().tasks[0]?.agentStatus).toBe('idle')
  })

  it('resets pending delete confirmation when the card task changes', () => {
    const task = mockKanbanTask()
    resetStores(task)
    const { rerender } = render(<TaskCard task={task} />)

    fireEvent.click(screen.getByTitle(/Delete task/))
    expect(screen.getByTitle(/Click again to confirm/)).toBeInTheDocument()

    const nextTask = mockKanbanTask({ id: 't2', title: 'Next task' })
    act(() => {
      resetStores(nextTask)
      rerender(<TaskCard task={nextTask} />)
    })

    expect(screen.getByTitle(/Delete task/)).toBeInTheDocument()
    expect(screen.queryByTitle(/Click again to confirm/)).not.toBeInTheDocument()
  })

  it('keyboard Space starts the agent only when the current column can trigger work', () => {
    const task = mockKanbanTask()
    resetStores(task)
    const { rerender } = render(<TaskCard task={task} />)

    fireEvent.keyDown(screen.getByText('Test task'), { key: ' ' })
    expect(useTaskStore.getState().tasks[0]?.agentStatus).toBe('running')

    const triggerlessTask = mockKanbanTask({ id: 't2', title: 'Triggerless task' })
    act(() => {
      useColumnStore.setState({
        columns: [mockKanbanColumn({ triggers: { on_entry: { type: 'none' }, on_exit: { type: 'none' } } })],
        loaded: true,
      })
      useTaskStore.setState({ tasks: [triggerlessTask], loaded: true })
      rerender(<TaskCard task={triggerlessTask} />)
    })

    fireEvent.keyDown(screen.getByText('Triggerless task'), { key: ' ' })
    expect(useTaskStore.getState().tasks[0]?.agentStatus).toBe('idle')
  })

  it('keyboard Space can stop a running agent even when the current column has no trigger', () => {
    const task = mockKanbanTask({ agentStatus: 'running' })
    useColumnStore.setState({
      columns: [mockKanbanColumn({ triggers: { on_entry: { type: 'none' }, on_exit: { type: 'none' } } })],
      loaded: true,
    })
    useTaskStore.setState({ tasks: [task], loaded: true })
    useUIStore.setState({ viewMode: 'board', activeTaskId: null, modal: null })

    render(<TaskCard task={task} />)

    fireEvent.keyDown(screen.getByText('Test task'), { key: ' ' })
    expect(useTaskStore.getState().tasks[0]?.agentStatus).toBe('stopped')
  })

  it('keyboard ArrowRight moves to the next visible column', async () => {
    const task = mockKanbanTask()
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
    const task = mockKanbanTask()
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
