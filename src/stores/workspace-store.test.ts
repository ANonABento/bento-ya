import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspaceStore } from './workspace-store'
import type { Workspace } from '@/types'

vi.mock('@tauri-apps/api/core')

const mockWorkspace: Workspace = {
  id: 'ws-1',
  name: 'Test Workspace',
  repoPath: '/path/to/repo',
  tabOrder: 0,
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('workspace-store', () => {
  beforeEach(() => {
    // Reset store state
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      loaded: false,
    })
    vi.clearAllMocks()
  })

  describe('load', () => {
    it('should load workspaces from backend', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([mockWorkspace])

      await useWorkspaceStore.getState().load()

      expect(invoke).toHaveBeenCalled()
      expect(useWorkspaceStore.getState().workspaces).toEqual([mockWorkspace])
      expect(useWorkspaceStore.getState().loaded).toBe(true)
    })

    it('should set active workspace to first one if none active', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([mockWorkspace])

      await useWorkspaceStore.getState().load()

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1')
    })
  })

  describe('add', () => {
    it('should create workspace and add to store', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(mockWorkspace)

      await useWorkspaceStore.getState().add('New Workspace', '/new/path')

      expect(invoke).toHaveBeenCalledWith('create_workspace', {
        name: 'New Workspace',
        repoPath: '/new/path',
      })
      expect(useWorkspaceStore.getState().workspaces).toContainEqual(mockWorkspace)
    })

    it('should not auto-activate new workspace (use setActive manually)', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(mockWorkspace)

      await useWorkspaceStore.getState().add('New Workspace', '/new/path')

      // add() doesn't set active - caller must use setActive() explicitly
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull()
    })
  })

  describe('setActive', () => {
    it('should update active workspace id', () => {
      useWorkspaceStore.setState({
        workspaces: [mockWorkspace],
        activeWorkspaceId: null,
      })

      useWorkspaceStore.getState().setActive('ws-1')

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1')
    })
  })

  describe('remove', () => {
    it('should delete workspace and remove from store', async () => {
      useWorkspaceStore.setState({
        workspaces: [mockWorkspace],
        activeWorkspaceId: 'ws-1',
      })
      vi.mocked(invoke).mockResolvedValueOnce(undefined)

      await useWorkspaceStore.getState().remove('ws-1')

      expect(invoke).toHaveBeenCalledWith('delete_workspace', { id: 'ws-1' })
      expect(useWorkspaceStore.getState().workspaces).toEqual([])
    })

    it('should clear active workspace if deleted', async () => {
      useWorkspaceStore.setState({
        workspaces: [mockWorkspace],
        activeWorkspaceId: 'ws-1',
      })
      vi.mocked(invoke).mockResolvedValueOnce(undefined)

      await useWorkspaceStore.getState().remove('ws-1')

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull()
    })

    it('should rollback on error', async () => {
      useWorkspaceStore.setState({
        workspaces: [mockWorkspace],
        activeWorkspaceId: 'ws-1',
      })
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Delete failed'))

      await useWorkspaceStore.getState().remove('ws-1')

      // Should rollback to previous state
      expect(useWorkspaceStore.getState().workspaces).toContainEqual(mockWorkspace)
    })
  })

  describe('reorder', () => {
    it('should reorder workspaces and call backend', async () => {
      const ws1 = { ...mockWorkspace, id: 'ws-1', tabOrder: 0 }
      const ws2 = { ...mockWorkspace, id: 'ws-2', tabOrder: 1 }
      useWorkspaceStore.setState({
        workspaces: [ws1, ws2],
      })
      vi.mocked(invoke).mockResolvedValueOnce(undefined)

      await useWorkspaceStore.getState().reorder(['ws-2', 'ws-1'])

      expect(invoke).toHaveBeenCalledWith('reorder_workspaces', {
        ids: ['ws-2', 'ws-1'],
      })
    })
  })
})
