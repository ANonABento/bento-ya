import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChecklistStore } from './checklist-store'

// Mock IPC module
vi.mock('@/lib/ipc', () => ({
  getWorkspaceChecklist: vi.fn(),
  updateChecklistItem: vi.fn(),
  updateChecklistCategory: vi.fn(),
  createWorkspaceChecklist: vi.fn(),
  deleteWorkspaceChecklist: vi.fn(),
  linkChecklistItemToTask: vi.fn(),
  runChecklistDetection: vi.fn(),
}))

import * as ipc from '@/lib/ipc'

const mockIpc = vi.mocked(ipc)

describe('checklist-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store to initial state
    useChecklistStore.setState({
      checklist: null,
      categories: [],
      items: {},
      isOpen: false,
      isLoading: false,
      currentWorkspaceId: null,
    })
  })

  describe('openChecklist / closeChecklist', () => {
    it('should toggle isOpen state', () => {
      expect(useChecklistStore.getState().isOpen).toBe(false)

      useChecklistStore.getState().openChecklist()
      expect(useChecklistStore.getState().isOpen).toBe(true)

      useChecklistStore.getState().closeChecklist()
      expect(useChecklistStore.getState().isOpen).toBe(false)
    })
  })

  describe('loadChecklist', () => {
    it('should load checklist data from IPC', async () => {
      const mockData = {
        checklist: {
          id: 'cl-1',
          workspaceId: 'ws-1',
          name: 'Test Checklist',
          description: 'A test checklist',
          progress: 2,
          totalItems: 5,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        categories: [
          {
            id: 'cat-1',
            checklistId: 'cl-1',
            name: 'Category 1',
            icon: '📋',
            position: 0,
            progress: 1,
            totalItems: 2,
            collapsed: false,
          },
        ],
        items: {
          'cat-1': [
            {
              id: 'item-1',
              categoryId: 'cat-1',
              text: 'Item 1',
              checked: true,
              notes: null,
              position: 0,
              detectType: null,
              detectConfig: null,
              autoDetected: false,
              linkedTaskId: null,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
            {
              id: 'item-2',
              categoryId: 'cat-1',
              text: 'Item 2',
              checked: false,
              notes: 'Some notes',
              position: 1,
              detectType: null,
              detectConfig: null,
              autoDetected: false,
              linkedTaskId: null,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
        },
      }

      mockIpc.getWorkspaceChecklist.mockResolvedValueOnce(mockData)

      await useChecklistStore.getState().loadChecklist('ws-1')

      const state = useChecklistStore.getState()
      expect(state.checklist?.id).toBe('cl-1')
      expect(state.checklist?.name).toBe('Test Checklist')
      expect(state.categories).toHaveLength(1)
      expect(state.items['cat-1']).toHaveLength(2)
      expect(state.isLoading).toBe(false)
      expect(state.currentWorkspaceId).toBe('ws-1')
    })

    it('should handle empty checklist', async () => {
      mockIpc.getWorkspaceChecklist.mockResolvedValueOnce({
        checklist: null,
        categories: [],
        items: {},
      })

      await useChecklistStore.getState().loadChecklist('ws-1')

      const state = useChecklistStore.getState()
      expect(state.checklist).toBeNull()
      expect(state.categories).toHaveLength(0)
      expect(state.isLoading).toBe(false)
    })

    it('should handle load errors gracefully', async () => {
      mockIpc.getWorkspaceChecklist.mockRejectedValueOnce(new Error('Network error'))

      await useChecklistStore.getState().loadChecklist('ws-1')

      const state = useChecklistStore.getState()
      expect(state.isLoading).toBe(false)
    })
  })

  describe('toggleItem', () => {
    beforeEach(() => {
      useChecklistStore.setState({
        items: {
          'cat-1': [
            {
              id: 'item-1',
              categoryId: 'cat-1',
              text: 'Item 1',
              checked: false,
              notes: null,
              position: 0,
              detectType: null,
              detectConfig: null,
              autoDetected: false,
              linkedTaskId: null,
              createdAt: '',
              updatedAt: '',
            },
          ],
        },
      })
    })

    it('should optimistically toggle item checked state', () => {
      mockIpc.updateChecklistItem.mockResolvedValueOnce({} as never)

      useChecklistStore.getState().toggleItem('item-1', 'cat-1')

      const items = useChecklistStore.getState().items['cat-1']
      expect(items?.[0]?.checked).toBe(true)
    })

    it('should call IPC to persist toggle', () => {
      mockIpc.updateChecklistItem.mockResolvedValueOnce({} as never)

      useChecklistStore.getState().toggleItem('item-1', 'cat-1')

      expect(mockIpc.updateChecklistItem).toHaveBeenCalledWith('item-1', true, undefined)
    })

    it('should revert on IPC error', async () => {
      mockIpc.updateChecklistItem.mockRejectedValueOnce(new Error('Failed'))

      useChecklistStore.getState().toggleItem('item-1', 'cat-1')

      // Wait for the promise to reject
      await vi.waitFor(() => {
        const items = useChecklistStore.getState().items['cat-1']
        expect(items?.[0]?.checked).toBe(false)
      })
    })

    it('should do nothing for non-existent item', () => {
      useChecklistStore.getState().toggleItem('non-existent', 'cat-1')
      expect(mockIpc.updateChecklistItem).not.toHaveBeenCalled()
    })
  })

  describe('toggleCategory', () => {
    beforeEach(() => {
      useChecklistStore.setState({
        categories: [
          {
            id: 'cat-1',
            checklistId: 'cl-1',
            name: 'Cat 1',
            icon: '📋',
            position: 0,
            progress: 0,
            totalItems: 1,
            collapsed: false,
          },
        ],
      })
    })

    it('should optimistically toggle category collapsed state', () => {
      mockIpc.updateChecklistCategory.mockResolvedValueOnce({} as never)

      useChecklistStore.getState().toggleCategory('cat-1')

      const categories = useChecklistStore.getState().categories
      expect(categories[0]?.collapsed).toBe(true)
    })

    it('should call IPC to persist toggle', () => {
      mockIpc.updateChecklistCategory.mockResolvedValueOnce({} as never)

      useChecklistStore.getState().toggleCategory('cat-1')

      expect(mockIpc.updateChecklistCategory).toHaveBeenCalledWith('cat-1', true)
    })
  })

  describe('getProgress', () => {
    it('should calculate progress from items', () => {
      useChecklistStore.setState({
        items: {
          'cat-1': [
            {
              id: 'i1',
              categoryId: 'cat-1',
              text: 'Item 1',
              checked: true,
              notes: null,
              position: 0,
              detectType: null,
              detectConfig: null,
              autoDetected: false,
              linkedTaskId: null,
              createdAt: '',
              updatedAt: '',
            },
            {
              id: 'i2',
              categoryId: 'cat-1',
              text: 'Item 2',
              checked: false,
              notes: null,
              position: 1,
              detectType: null,
              detectConfig: null,
              autoDetected: false,
              linkedTaskId: null,
              createdAt: '',
              updatedAt: '',
            },
          ],
          'cat-2': [
            {
              id: 'i3',
              categoryId: 'cat-2',
              text: 'Item 3',
              checked: true,
              notes: null,
              position: 0,
              detectType: null,
              detectConfig: null,
              autoDetected: false,
              linkedTaskId: null,
              createdAt: '',
              updatedAt: '',
            },
          ],
        },
      })

      const progress = useChecklistStore.getState().getProgress()

      expect(progress.progress).toBe(2)
      expect(progress.total).toBe(3)
      expect(progress.percentage).toBe(67)
    })

    it('should return 0% for empty checklist', () => {
      useChecklistStore.setState({ items: {} })

      const progress = useChecklistStore.getState().getProgress()

      expect(progress.percentage).toBe(0)
    })
  })

  describe('createChecklist', () => {
    it('should create checklist via IPC and reload', async () => {
      const mockChecklistData = {
        checklist: {
          id: 'cl-new',
          workspaceId: 'ws-1',
          name: 'New',
          description: null,
          progress: 0,
          totalItems: 2,
          createdAt: '',
          updatedAt: '',
        },
        categories: [],
        items: {},
      }
      mockIpc.createWorkspaceChecklist.mockResolvedValueOnce(mockChecklistData)
      mockIpc.getWorkspaceChecklist.mockResolvedValueOnce(mockChecklistData)

      const template = {
        id: 'tpl-1',
        name: 'Test Template',
        description: 'A template',
        isBuiltIn: true,
        categories: [
          { name: 'Setup', icon: '⚙️', items: [{ text: 'Task 1' }, { text: 'Task 2' }] },
        ],
      }

      await useChecklistStore.getState().createChecklist('ws-1', template)

      expect(mockIpc.createWorkspaceChecklist).toHaveBeenCalledWith(
        'ws-1',
        'Test Template',
        'A template',
        [{ name: 'Setup', icon: '⚙️', items: [{ text: 'Task 1' }, { text: 'Task 2' }] }],
      )
    })
  })

  describe('deleteChecklist', () => {
    it('should delete checklist and clear state', async () => {
      useChecklistStore.setState({
        checklist: {
          id: 'cl-1',
          workspaceId: 'ws-1',
          name: 'Test',
          description: null,
          progress: 0,
          totalItems: 0,
          createdAt: '',
          updatedAt: '',
        },
        categories: [
          {
            id: 'cat-1',
            checklistId: 'cl-1',
            name: 'Cat',
            icon: '📋',
            position: 0,
            progress: 0,
            totalItems: 0,
            collapsed: false,
          },
        ],
        items: { 'cat-1': [] },
      })

      mockIpc.deleteWorkspaceChecklist.mockResolvedValueOnce(undefined)

      await useChecklistStore.getState().deleteChecklist('ws-1')

      const state = useChecklistStore.getState()
      expect(state.checklist).toBeNull()
      expect(state.categories).toHaveLength(0)
      expect(state.items).toEqual({})
    })
  })

  describe('linkItemToTask', () => {
    beforeEach(() => {
      useChecklistStore.setState({
        items: {
          'cat-1': [
            {
              id: 'item-1',
              categoryId: 'cat-1',
              text: 'Item 1',
              checked: false,
              notes: null,
              position: 0,
              detectType: null,
              detectConfig: null,
              autoDetected: false,
              linkedTaskId: 'task-old',
              createdAt: '',
              updatedAt: '',
            },
          ],
        },
      })
    })

    it('should optimistically link item to task', () => {
      mockIpc.linkChecklistItemToTask.mockResolvedValueOnce({} as never)

      useChecklistStore.getState().linkItemToTask('item-1', 'cat-1', 'task-new')

      const item = useChecklistStore.getState().items['cat-1']?.[0]
      expect(item?.linkedTaskId).toBe('task-new')
      expect(mockIpc.linkChecklistItemToTask).toHaveBeenCalledWith('item-1', 'task-new')
    })

    it('should restore previous linked task on IPC error', async () => {
      mockIpc.linkChecklistItemToTask.mockRejectedValueOnce(new Error('Failed'))

      useChecklistStore.getState().linkItemToTask('item-1', 'cat-1', 'task-new')

      await vi.waitFor(() => {
        const item = useChecklistStore.getState().items['cat-1']?.[0]
        expect(item?.linkedTaskId).toBe('task-old')
      })
    })
  })

  describe('getTemplates', () => {
    it('should return built-in templates', () => {
      const templates = useChecklistStore.getState().getTemplates()
      expect(templates.length).toBeGreaterThan(0)
    })
  })

  describe('runDetection', () => {
    it('should run detection and update items based on results', async () => {
      // Set up initial state with items that can be detected
      useChecklistStore.setState({
        checklist: {
          id: 'cl-1',
          workspaceId: 'ws-1',
          name: 'Test',
          description: null,
          progress: 0,
          totalItems: 2,
          createdAt: '',
          updatedAt: '',
        },
        categories: [
          {
            id: 'cat-1',
            checklistId: 'cl-1',
            name: 'Setup',
            icon: '⚙️',
            position: 0,
            progress: 0,
            totalItems: 2,
            collapsed: false,
          },
        ],
        items: {
          'cat-1': [
            {
              id: 'i1',
              categoryId: 'cat-1',
              text: 'Has README',
              checked: false,
              notes: null,
              position: 0,
              detectType: 'file-exists',
              detectConfig: '{"pattern": "README.md"}',
              autoDetected: false,
              linkedTaskId: null,
              createdAt: '',
              updatedAt: '',
            },
            {
              id: 'i2',
              categoryId: 'cat-1',
              text: 'Has tests',
              checked: false,
              notes: null,
              position: 1,
              detectType: 'file-exists',
              detectConfig: '{"pattern": "**/*.test.ts"}',
              autoDetected: false,
              linkedTaskId: null,
              createdAt: '',
              updatedAt: '',
            },
          ],
        },
      })

      // Mock detection results - README exists, tests don't
      mockIpc.runChecklistDetection.mockResolvedValueOnce([
        { itemId: 'i1', detected: true, message: 'File found: README.md' },
        { itemId: 'i2', detected: false, message: 'No matching files' },
      ])

      await useChecklistStore.getState().runDetection('ws-1', '/path/to/repo')

      expect(mockIpc.runChecklistDetection).toHaveBeenCalledWith('ws-1', '/path/to/repo')

      const items = useChecklistStore.getState().items['cat-1']
      expect(items?.find((i) => i.id === 'i1')?.checked).toBe(true)
      expect(items?.find((i) => i.id === 'i1')?.autoDetected).toBe(true)
      expect(items?.find((i) => i.id === 'i2')?.checked).toBe(false)
    })

    it('should handle empty detection results', async () => {
      useChecklistStore.setState({
        checklist: {
          id: 'cl-1',
          workspaceId: 'ws-1',
          name: 'Test',
          description: null,
          progress: 0,
          totalItems: 1,
          createdAt: '',
          updatedAt: '',
        },
        categories: [
          {
            id: 'cat-1',
            checklistId: 'cl-1',
            name: 'Setup',
            icon: '⚙️',
            position: 0,
            progress: 0,
            totalItems: 1,
            collapsed: false,
          },
        ],
        items: {
          'cat-1': [
            {
              id: 'i1',
              categoryId: 'cat-1',
              text: 'Manual item',
              checked: false,
              notes: null,
              position: 0,
              detectType: null,
              detectConfig: null,
              autoDetected: false,
              linkedTaskId: null,
              createdAt: '',
              updatedAt: '',
            },
          ],
        },
      })

      mockIpc.runChecklistDetection.mockResolvedValueOnce([])

      await useChecklistStore.getState().runDetection('ws-1', '/path/to/repo')

      // Items should remain unchanged
      const items = useChecklistStore.getState().items['cat-1']
      expect(items?.find((i) => i.id === 'i1')?.checked).toBe(false)
    })
  })
})
