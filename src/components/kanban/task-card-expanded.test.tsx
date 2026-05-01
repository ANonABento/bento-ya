import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { TaskCardExpanded } from './task-card-expanded'
import { useTaskStore } from '@/stores/task-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { mockKanbanTask, mockWorkspace } from '@/test/mocks/tauri'

const mockInvoke = vi.mocked(invoke)

describe('TaskCardExpanded time tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({
      workspaces: [mockWorkspace({ id: 'ws-1' })],
      activeWorkspaceId: 'ws-1',
    })
    useTaskStore.setState({ tasks: [], loaded: true })
  })

  it('shows estimate and actual hours side-by-side with an overrun warning', () => {
    const task = mockKanbanTask({ estimatedHours: 1, actualHours: 2.25 })

    render(<TaskCardExpanded task={task} />)

    expect(screen.getByLabelText('Estimate')).toHaveValue(1)
    expect(screen.getByText('2.3h')).toBeInTheDocument()
    expect(screen.getByText('Actual time is more than 2x the estimate.')).toBeInTheDocument()
  })

  it('persists edited estimate values', async () => {
    const task = mockKanbanTask({ estimatedHours: null, actualHours: 0.5 })
    const updated = { ...task, estimatedHours: 3 }
    mockInvoke.mockResolvedValueOnce(updated)
    useTaskStore.setState({ tasks: [task], loaded: true })

    render(<TaskCardExpanded task={task} />)

    const input = screen.getByLabelText('Estimate')
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('update_task', {
        id: task.id,
        estimatedHours: 3,
      })
    })
    expect(useTaskStore.getState().tasks[0]?.estimatedHours).toBe(3)
  })
})
