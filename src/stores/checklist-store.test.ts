import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useChecklistStore } from './checklist-store'
import type { ChecklistItem, ChecklistCategory } from '@/types/checklist'

vi.mock('@tauri-apps/api/core')

const mockChecklistItem: ChecklistItem = {
  id: 'item-1',
  categoryId: 'cat-1',
  text: 'Test item',
  checked: false,
  notes: null,
  position: 0,
  detectType: null,
  detectConfig: null,
  autoDetected: false,
  linkedTaskId: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const mockCategory: ChecklistCategory = {
  id: 'cat-1',
  checklistId: 'checklist-1',
  name: 'Test Category',
  icon: '📋',
  position: 0,
  progress: 0,
  totalItems: 1,
  collapsed: false,
}

const mockChecklist = {
  id: 'checklist-1',
  workspaceId: 'ws-1',
  name: 'Test Checklist',
  description: 'A test checklist',
  progress: 0,
  totalItems: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('checklist-store', () => {
  beforeEach(() => {
    useChecklistStore.setState({
      checklist: null,
      categories: [],
      items: {},
      isOpen: false,
      isLoading: false,
      currentWorkspaceId: null,
    })
    vi.clearAllMocks()
  })

  describe('openChecklist / closeChecklist', () => {
    it('should open checklist panel', () => {
      useChecklistStore.getState().openChecklist()
      expect(useChecklistStore.getState().isOpen).toBe(true)
    })

    it('should close checklist panel', () => {
      useChecklistStore.setState({ isOpen: true })
      useChecklistStore.getState().closeChecklist()
      expect(useChecklistStore.getState().isOpen).toBe(false)
    })
  })

  describe('loadChecklist', () => {
    it('should load checklist data from backend', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({
        checklist: mockChecklist,
        categories: [mockCategory],
        items: { 'cat-1': [mockChecklistItem] },
      })

      await useChecklistStore.getState().loadChecklist('ws-1')

      expect(invoke).toHaveBeenCalledWith('get_workspace_checklist', { workspaceId: 'ws-1' })
      expect(useChecklistStore.getState().checklist).toEqual(mockChecklist)
      expect(useChecklistStore.getState().categories).toHaveLength(1)
      expect(useChecklistStore.getState().items['cat-1']).toHaveLength(1)
      expect(useChecklistStore.getState().isLoading).toBe(false)
    })

    it('should handle empty checklist', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({
        checklist: null,
        categories: [],
        items: {},
      })

      await useChecklistStore.getState().loadChecklist('ws-1')

      expect(useChecklistStore.getState().checklist).toBeNull()
      expect(useChecklistStore.getState().categories).toEqual([])
    })
  })

  describe('toggleItem', () => {
    it('should toggle item checked state', () => {
      useChecklistStore.setState({
        items: { 'cat-1': [mockChecklistItem] },
      })
      vi.mocked(invoke).mockResolvedValueOnce({ ...mockChecklistItem, checked: true })

      useChecklistStore.getState().toggleItem('item-1', 'cat-1')

      const items = useChecklistStore.getState().items['cat-1']
      expect(items[0].checked).toBe(true)
    })
  })

  describe('toggleCategory', () => {
    it('should toggle category collapsed state', () => {
      useChecklistStore.setState({
        categories: [mockCategory],
      })
      vi.mocked(invoke).mockResolvedValueOnce({ ...mockCategory, collapsed: true })

      useChecklistStore.getState().toggleCategory('cat-1')

      const categories = useChecklistStore.getState().categories
      expect(categories[0].collapsed).toBe(true)
    })
  })

  describe('getProgress', () => {
    it('should calculate progress correctly', () => {
      const checkedItem = { ...mockChecklistItem, id: 'item-2', checked: true }
      useChecklistStore.setState({
        items: { 'cat-1': [mockChecklistItem, checkedItem] },
      })

      const progress = useChecklistStore.getState().getProgress()

      expect(progress.progress).toBe(1)
      expect(progress.total).toBe(2)
      expect(progress.percentage).toBe(50)
    })

    it('should return 0 for empty checklist', () => {
      const progress = useChecklistStore.getState().getProgress()

      expect(progress.progress).toBe(0)
      expect(progress.total).toBe(0)
      expect(progress.percentage).toBe(0)
    })
  })

  describe('getTemplates', () => {
    it('should return built-in templates', () => {
      const templates = useChecklistStore.getState().getTemplates()

      expect(templates.length).toBeGreaterThan(0)
      expect(templates[0]).toHaveProperty('id')
      expect(templates[0]).toHaveProperty('name')
      expect(templates[0]).toHaveProperty('categories')
    })
  })

  describe('linkItemToTask', () => {
    it('should link item to task', () => {
      useChecklistStore.setState({
        items: { 'cat-1': [mockChecklistItem] },
      })
      vi.mocked(invoke).mockResolvedValueOnce({ ...mockChecklistItem, linkedTaskId: 'task-1' })

      useChecklistStore.getState().linkItemToTask('item-1', 'cat-1', 'task-1')

      const items = useChecklistStore.getState().items['cat-1']
      expect(items[0].linkedTaskId).toBe('task-1')
    })
  })
})
