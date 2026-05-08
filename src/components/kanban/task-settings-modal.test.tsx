import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockKanbanTask } from '@/test/mocks/tauri'
import { TaskSettingsModal } from './task-settings-modal'

const ipcMocks = vi.hoisted(() => ({
  updateTask: vi.fn(),
  updateTaskTriggers: vi.fn(),
}))

vi.mock('@/lib/ipc', () => ({
  updateTask: async (...args: unknown[]) => {
    const result = await ipcMocks.updateTask(...args) as unknown
    return result
  },
  updateTaskTriggers: async (...args: unknown[]) => {
    const result = await ipcMocks.updateTaskTriggers(...args) as unknown
    return result
  },
}))

describe('TaskSettingsModal runtime override', () => {
  beforeEach(() => {
    ipcMocks.updateTask.mockReset()
    ipcMocks.updateTaskTriggers.mockReset()
  })

  it('saves managed runtime as a task-level override', async () => {
    const task = mockKanbanTask({ agentMode: null })
    ipcMocks.updateTask.mockResolvedValue(task)
    ipcMocks.updateTaskTriggers.mockResolvedValue({ ...task, agentMode: 'managed' })
    const onClose = vi.fn()

    render(<TaskSettingsModal task={task} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: 'managed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipcMocks.updateTask).toHaveBeenCalledWith(task.id, { agentMode: 'managed' })
    })
    expect(ipcMocks.updateTaskTriggers).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('clears an existing runtime override back to column default', async () => {
    const task = mockKanbanTask({ agentMode: 'managed' })
    ipcMocks.updateTask.mockResolvedValue(task)
    ipcMocks.updateTaskTriggers.mockResolvedValue({ ...task, agentMode: null })

    render(<TaskSettingsModal task={task} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipcMocks.updateTask).toHaveBeenCalledWith(task.id, { agentMode: null })
    })
  })
})
