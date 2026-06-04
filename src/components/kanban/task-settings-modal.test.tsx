import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockKanbanTask } from '@/test/mocks/tauri'
import { TaskSettingsModal } from './task-settings-modal'

const ipcMocks = vi.hoisted(() => ({
  updateTask: vi.fn(),
  updateTaskTriggers: vi.fn(),
  setTaskRuntimeModeOverride: vi.fn(),
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
  setTaskRuntimeModeOverride: async (...args: unknown[]) => {
    const result = await ipcMocks.setTaskRuntimeModeOverride(...args) as unknown
    return result
  },
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('@/lib/ipc/agent-interactive', () => ({
  interactiveModeDevFlag: vi.fn().mockResolvedValue(false),
  resolveRuntimeMode: vi.fn().mockResolvedValue({
    mode: 'headless',
    render: 'bubbles',
    source: 'default',
    interactiveDevFlagRequired: false,
  }),
}))

vi.mock('@/hooks/use-resolved-runtime-mode', () => ({
  useResolvedRuntimeMode: vi.fn().mockReturnValue({
    mode: 'headless',
    render: 'bubbles',
    source: 'default',
    interactiveDevFlagRequired: false,
    isLoading: false,
    error: null,
  }),
}))

describe('TaskSettingsModal runtime override', () => {
  beforeEach(() => {
    ipcMocks.updateTask.mockReset()
    ipcMocks.updateTaskTriggers.mockReset()
    ipcMocks.setTaskRuntimeModeOverride.mockReset()
  })

  it('saves managed runtime via the runtime_mode_override write path', async () => {
    const task = mockKanbanTask({ runtimeModeOverride: null })
    ipcMocks.setTaskRuntimeModeOverride.mockResolvedValue({ ...task, runtimeModeOverride: 'managed' })
    ipcMocks.updateTaskTriggers.mockResolvedValue({ ...task, runtimeModeOverride: 'managed' })
    const onClose = vi.fn()

    render(<TaskSettingsModal task={task} onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: 'managed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipcMocks.setTaskRuntimeModeOverride).toHaveBeenCalledWith(task.id, 'managed')
    })
    // Model unchanged → no updateTask call.
    expect(ipcMocks.updateTask).not.toHaveBeenCalled()
    expect(ipcMocks.updateTaskTriggers).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('clears an existing runtime override back to column default', async () => {
    const task = mockKanbanTask({ runtimeModeOverride: 'managed' })
    ipcMocks.setTaskRuntimeModeOverride.mockResolvedValue({ ...task, runtimeModeOverride: null })
    ipcMocks.updateTaskTriggers.mockResolvedValue({ ...task, runtimeModeOverride: null })

    render(<TaskSettingsModal task={task} onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipcMocks.setTaskRuntimeModeOverride).toHaveBeenCalledWith(task.id, null)
    })
  })
})
