/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useColumnStore } from './column-store'
import type { Column } from '@/types'

const refreshWorkspace = vi.fn()

vi.mock('./workspace-store', () => ({
  useWorkspaceStore: {
    getState: () => ({
      refreshWorkspace,
    }),
  },
}))

// Mock IPC module
vi.mock('@/lib/ipc', () => ({
  getColumns: vi.fn(),
  createColumn: vi.fn(),
  deleteColumn: vi.fn(),
  reorderColumns: vi.fn(),
  updateColumn: vi.fn(),
}))

import * as ipc from '@/lib/ipc'

const mockIpc = vi.mocked(ipc)

const createMockColumn = (overrides: Partial<Column> = {}): Column => ({
  id: 'col-1',
  workspaceId: 'ws-1',
  name: 'Test Column',
  icon: 'list',
  position: 0,
  color: '#E8A87C',
  visible: true,
  triggers: {
    on_entry: { type: 'none' },
    on_exit: { type: 'none' },
    exit_criteria: { type: 'manual', auto_advance: false },
  },
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('column-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    refreshWorkspace.mockReset()
    useColumnStore.setState({
      columns: [],
      loaded: false,
    })
  })

  describe('load', () => {
    it('should load columns from IPC', async () => {
      const mockColumns = [
        createMockColumn({ id: 'col-1', name: 'Backlog', position: 0 }),
        createMockColumn({ id: 'col-2', name: 'In Progress', position: 1 }),
      ]
      mockIpc.getColumns.mockResolvedValueOnce(mockColumns)

      await useColumnStore.getState().load('ws-1')

      const state = useColumnStore.getState()
      expect(state.columns).toHaveLength(2)
      expect(state.loaded).toBe(true)
      expect(mockIpc.getColumns).toHaveBeenCalledWith('ws-1')
    })
  })

  describe('add', () => {
    it('should add a new column', async () => {
      const newColumn = createMockColumn({ id: 'col-new', name: 'New Column', position: 0 })
      mockIpc.createColumn.mockResolvedValueOnce(newColumn)
      refreshWorkspace.mockResolvedValueOnce(undefined)

      const result = await useColumnStore.getState().add('ws-1', 'New Column')

      const state = useColumnStore.getState()
      expect(state.columns).toHaveLength(1)
      expect(state.columns[0]!.name).toBe('New Column')
      expect(result).toEqual(newColumn)
      expect(mockIpc.createColumn).toHaveBeenCalledWith('ws-1', 'New Column', 0)
      expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
    })

    it('should use correct position based on existing columns', async () => {
      useColumnStore.setState({
        columns: [
          createMockColumn({ id: 'col-1', position: 0 }),
          createMockColumn({ id: 'col-2', position: 1 }),
        ],
        loaded: true,
      })

      const newColumn = createMockColumn({ id: 'col-3', name: 'Third', position: 2 })
      mockIpc.createColumn.mockResolvedValueOnce(newColumn)
      refreshWorkspace.mockResolvedValueOnce(undefined)

      await useColumnStore.getState().add('ws-1', 'Third')

      expect(mockIpc.createColumn).toHaveBeenCalledWith('ws-1', 'Third', 2)
      expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
    })
  })

  describe('remove', () => {
    it('should remove a column optimistically', async () => {
      useColumnStore.setState({
        columns: [createMockColumn({ id: 'col-1' }), createMockColumn({ id: 'col-2' })],
        loaded: true,
      })
      mockIpc.deleteColumn.mockResolvedValueOnce(undefined)
      refreshWorkspace.mockResolvedValueOnce(undefined)

      await useColumnStore.getState().remove('col-1')

      const state = useColumnStore.getState()
      expect(state.columns).toHaveLength(1)
      expect(state.columns[0]!.id).toBe('col-2')
      expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
    })

    it('should revert on IPC error', async () => {
      const original = [createMockColumn({ id: 'col-1' }), createMockColumn({ id: 'col-2' })]
      useColumnStore.setState({
        columns: original,
        loaded: true,
      })
      mockIpc.deleteColumn.mockRejectedValueOnce(new Error('Failed'))

      await useColumnStore.getState().remove('col-1')

      const state = useColumnStore.getState()
      expect(state.columns).toHaveLength(2)
    })
  })

  describe('reorder', () => {
    it('should reorder columns optimistically', async () => {
      useColumnStore.setState({
        columns: [
          createMockColumn({ id: 'col-1', position: 0 }),
          createMockColumn({ id: 'col-2', position: 1 }),
          createMockColumn({ id: 'col-3', position: 2 }),
        ],
        loaded: true,
      })
      mockIpc.reorderColumns.mockResolvedValueOnce(undefined as unknown as Column[])
      refreshWorkspace.mockResolvedValueOnce(undefined)

      await useColumnStore.getState().reorder('ws-1', ['col-3', 'col-1', 'col-2'])

      const state = useColumnStore.getState()
      expect(state.columns[0]!.id).toBe('col-3')
      expect(state.columns[0]!.position).toBe(0)
      expect(state.columns[1]!.id).toBe('col-1')
      expect(state.columns[1]!.position).toBe(1)
      expect(state.columns[2]!.id).toBe('col-2')
      expect(state.columns[2]!.position).toBe(2)
      expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
    })

    it('should revert on IPC error', async () => {
      const original = [
        createMockColumn({ id: 'col-1', position: 0 }),
        createMockColumn({ id: 'col-2', position: 1 }),
      ]
      useColumnStore.setState({
        columns: original,
        loaded: true,
      })
      mockIpc.reorderColumns.mockRejectedValueOnce(new Error('Failed'))

      await useColumnStore.getState().reorder('ws-1', ['col-2', 'col-1'])

      const state = useColumnStore.getState()
      expect(state.columns[0]!.id).toBe('col-1')
      expect(state.columns[0]!.position).toBe(0)
    })
  })

  describe('updateColumn', () => {
    it('should update column synchronously', () => {
      useColumnStore.setState({
        columns: [createMockColumn({ id: 'col-1', name: 'Original' })],
        loaded: true,
      })

      useColumnStore.getState().updateColumn('col-1', { name: 'Updated' })

      const state = useColumnStore.getState()
      expect(state.columns[0]!.name).toBe('Updated')
    })

    it('should not affect other columns', () => {
      useColumnStore.setState({
        columns: [
          createMockColumn({ id: 'col-1', name: 'First' }),
          createMockColumn({ id: 'col-2', name: 'Second' }),
        ],
        loaded: true,
      })

      useColumnStore.getState().updateColumn('col-1', { name: 'Updated First' })

      const state = useColumnStore.getState()
      expect(state.columns[0]!.name).toBe('Updated First')
      expect(state.columns[1]!.name).toBe('Second')
    })
  })

  describe('updateColumnAsync', () => {
    it('should update column and sync with backend', async () => {
      useColumnStore.setState({
        columns: [createMockColumn({ id: 'col-1', name: 'Original' })],
        loaded: true,
      })
      const updated = createMockColumn({ id: 'col-1', name: 'From Backend' })
      mockIpc.updateColumn.mockResolvedValueOnce(updated)

      await useColumnStore.getState().updateColumnAsync('col-1', { name: 'Updated' })

      const state = useColumnStore.getState()
      expect(state.columns[0]!.name).toBe('From Backend')
      expect(mockIpc.updateColumn).toHaveBeenCalledWith('col-1', { name: 'Updated' })
    })

    it('should revert on IPC error', async () => {
      useColumnStore.setState({
        columns: [createMockColumn({ id: 'col-1', name: 'Original' })],
        loaded: true,
      })
      mockIpc.updateColumn.mockRejectedValueOnce(new Error('Failed'))

      await useColumnStore.getState().updateColumnAsync('col-1', { name: 'Updated' })

      const state = useColumnStore.getState()
      expect(state.columns[0]!.name).toBe('Original')
    })

    it('should handle partial updates', async () => {
      useColumnStore.setState({
        columns: [createMockColumn({ id: 'col-1', name: 'Name', icon: 'list', color: '#fff' })],
        loaded: true,
      })
      const updated = createMockColumn({ id: 'col-1', name: 'Name', icon: 'check', color: '#fff' })
      mockIpc.updateColumn.mockResolvedValueOnce(updated)

      await useColumnStore.getState().updateColumnAsync('col-1', { icon: 'check' })

      const state = useColumnStore.getState()
      expect(state.columns[0]!.icon).toBe('check')
      expect(state.columns[0]!.name).toBe('Name')
    })

    it('should ignore invalid trigger JSON during optimistic update', async () => {
      const original = createMockColumn({ id: 'col-1' })
      useColumnStore.setState({
        columns: [original],
        loaded: true,
      })
      mockIpc.updateColumn.mockResolvedValueOnce(original)

      await expect(
        useColumnStore.getState().updateColumnAsync('col-1', { triggers: '{invalid-json' }),
      ).resolves.toBeUndefined()

      expect(useColumnStore.getState().columns[0]!.triggers).toEqual(original.triggers)
      expect(mockIpc.updateColumn).toHaveBeenCalledWith('col-1', { triggers: '{invalid-json' })
    })
  })
})
