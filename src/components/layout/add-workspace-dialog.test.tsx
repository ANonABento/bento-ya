import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddWorkspaceDialog } from './add-workspace-dialog'
import { useWorkspaceStore } from '@/stores/workspace-store'
import type { Workspace } from '@/types'

const workspace: Workspace = {
  id: 'ws-new',
  name: 'New Workspace',
  repoPath: '/repo/new',
  config: '{}',
  tabOrder: 0,
  isActive: false,
  createdAt: '2026-05-20T00:00:00Z',
  updatedAt: '2026-05-20T00:00:00Z',
  activeTaskCount: 0,
}

describe('AddWorkspaceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      loaded: true,
    })
  })

  it('creates and activates the selected workspace', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(workspace)
    const onClose = vi.fn()

    render(<AddWorkspaceDialog onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText('My Project'), {
      target: { value: 'New Workspace' },
    })
    fireEvent.change(screen.getByPlaceholderText('/path/to/repo'), {
      target: { value: '/repo/new' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(invoke).toHaveBeenCalledWith('create_workspace', {
      name: 'New Workspace',
      repoPath: '/repo/new',
    })
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-new')
  })

  it('shows workspace creation errors inline', async () => {
    vi.mocked(invoke).mockRejectedValueOnce({
      kind: 'InvalidInput',
      message: 'Repository path is not inside a git repository: /repo/broken',
    })

    render(<AddWorkspaceDialog onClose={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('My Project'), {
      target: { value: 'Broken Workspace' },
    })
    fireEvent.change(screen.getByPlaceholderText('/path/to/repo'), {
      target: { value: '/repo/broken' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid repository path. Select a local git repository and try again.',
    )
  })
})
