import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { TaskCardExpanded } from './task-card-expanded'
import { useTaskStore } from '@/stores/task-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { mockKanbanTask, mockWorkspace } from '@/test/mocks/tauri'

const mockInvoke = vi.mocked(invoke)

describe('TaskCardExpanded description', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({
      workspaces: [mockWorkspace({ id: 'ws-1' })],
      activeWorkspaceId: 'ws-1',
    })
    useTaskStore.setState({ tasks: [], loaded: true })
  })

  it('does not render on-card estimate or actual time tracking', () => {
    const task = mockKanbanTask({ estimatedHours: 1, actualHours: 2.25 })

    render(<TaskCardExpanded task={task} />)

    expect(screen.queryByLabelText('Estimate')).not.toBeInTheDocument()
    expect(screen.queryByText('2.3h')).not.toBeInTheDocument()
    expect(screen.queryByText('Actual time is more than 2x the estimate.')).not.toBeInTheDocument()
  })

  it('renders description markdown and keeps editing available', async () => {
    const task = mockKanbanTask({
      description: 'Fix **bold** behavior\n\n- keep markdown',
    })
    const updated = { ...task, description: 'Updated description' }
    mockInvoke.mockResolvedValueOnce(updated)
    useTaskStore.setState({ tasks: [task], loaded: true })

    render(<TaskCardExpanded task={task} />)

    expect(screen.getByText('bold')).toBeInTheDocument()
    expect(screen.getByText('keep markdown')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /fix bold behavior/i }))
    const input = screen.getByLabelText('Edit task description')
    fireEvent.change(input, { target: { value: 'Updated description' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('update_task', {
        id: task.id,
        description: 'Updated description',
      })
    })
  })

  it('uses platform-aware description save shortcut copy', () => {
    const task = mockKanbanTask()

    render(<TaskCardExpanded task={task} />)
    fireEvent.click(screen.getByRole('button', { name: /add a description/i }))

    const userAgent = navigator.userAgent.toLowerCase()
    const expectedModifier = userAgent.includes('mac os') || userAgent.includes('macintosh') ? 'Cmd' : 'Ctrl'
    expect(screen.getByText(`${expectedModifier}+Enter to save, Escape to cancel`)).toBeInTheDocument()
  })

  it('shows compact touched-files and commits on the expanded card', async () => {
    const task = mockKanbanTask({ branch: 'feature/card-files' })
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_changes') {
        return Promise.resolve({
          totalFiles: 2,
          totalAdditions: 12,
          totalDeletions: 3,
          files: [
            { path: 'src/components/panel/agent-panel.tsx', status: 'modified', additions: 10, deletions: 2 },
            { path: 'src/hooks/use-git.ts', status: 'modified', additions: 2, deletions: 1 },
          ],
        })
      }
      if (cmd === 'get_commits') {
        return Promise.resolve([
          {
            hash: 'abc123',
            shortHash: 'abc123',
            message: 'Restore card commits',
            author: 'Agent',
            timestamp: 1,
          },
        ])
      }
      return Promise.reject(new Error(`Unmocked command: ${cmd}`))
    })

    render(<TaskCardExpanded task={task} />)

    expect(await screen.findByTestId('touched-files-summary')).toBeInTheDocument()
    expect(screen.getByText('src/components/panel/agent-panel.tsx')).toBeInTheDocument()
    expect(screen.getByText('src/hooks/use-git.ts')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View all' })).not.toBeInTheDocument()
    expect(screen.getByText('Commits')).toBeInTheDocument()
    expect(screen.getByText('Restore card commits')).toBeInTheDocument()
  })
})
