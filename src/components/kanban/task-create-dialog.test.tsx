import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockKanbanColumn } from '@/test/mocks/tauri'
import { useColumnStore } from '@/stores/column-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useTaskStore } from '@/stores/task-store'
import { TaskCreateDialog } from './task-create-dialog'

const ipcMocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  getWorkspace: vi.fn(),
}))

vi.mock('@/lib/ipc', () => ({
  createTask: (...args: unknown[]) => ipcMocks.createTask(...args) as unknown,
  getWorkspace: (...args: unknown[]) => ipcMocks.getWorkspace(...args) as unknown,
  validateTaskDependencies: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ipc/agent-interactive', () => ({
  interactiveModeDevFlag: vi.fn().mockResolvedValue(true),
}))

describe('TaskCreateDialog', () => {
  beforeEach(() => {
    ipcMocks.createTask.mockReset()
    ipcMocks.getWorkspace.mockReset()
    ipcMocks.getWorkspace.mockResolvedValue({ id: 'ws-1' })
    useTaskStore.setState({ tasks: [], loaded: true })
    useColumnStore.setState({
      columns: [
        mockKanbanColumn({ id: 'col-1', name: 'Backlog', position: 0 }),
        mockKanbanColumn({ id: 'col-2', name: 'In Progress', position: 1 }),
      ],
      loaded: true,
    })
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })
  })

  it('pre-fills the title and creates a task with the chosen options', async () => {
    ipcMocks.createTask.mockResolvedValue({ id: 'task-new', title: 'My Task' })
    const onClose = vi.fn()

    render(<TaskCreateDialog columnId="col-1" initialTitle="My Task" onClose={onClose} />)

    expect(screen.getByLabelText('Title')).toHaveValue('My Task')

    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'col-2' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } })
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } })
    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: 'interactive' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }))

    await waitFor(() => {
      expect(ipcMocks.createTask).toHaveBeenCalledWith(
        'ws-1',
        'col-2',
        'My Task',
        undefined,
        expect.objectContaining({
          model: 'opus',
          priority: 'high',
          runtimeModeOverride: 'interactive',
        }),
      )
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('disables submit until a title is provided', async () => {
    render(<TaskCreateDialog columnId="col-1" onClose={vi.fn()} />)
    // Let the async interactive-mode dev-flag read settle before asserting.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create Task' })).toBeDisabled()
    })
  })
})
