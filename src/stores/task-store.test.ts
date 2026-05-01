import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTaskStore } from './task-store'
import type { Task } from '@/types'

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
  getTasks: vi.fn(),
  createTask: vi.fn(),
  duplicateTask: vi.fn(),
  deleteTask: vi.fn(),
  bulkUpdateTasks: vi.fn(),
  moveTask: vi.fn(),
  reorderTasks: vi.fn(),
}))

import * as ipc from '@/lib/ipc'

const mockIpc = vi.mocked(ipc)

const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  workspaceId: 'ws-1',
  columnId: 'col-1',
  title: 'Test Task',
  description: '',
  position: 0,
  agentType: null,
  agentMode: null,
  agentStatus: null,
  pipelineState: 'idle',
  pipelineTriggeredAt: null,
  pipelineError: null,
  retryCount: 0,
  model: null,
  lastScriptExitCode: null,
  reviewStatus: 'pending',
  branch: null,
  prNumber: null,
  prUrl: null,
  prCiStatus: null,
  prReviewDecision: null,
  prMergeable: null,
  prCommentCount: 0,
  prIsDraft: false,
  prLabels: '[]',
  prLastFetched: null,
  prHeadSha: null,
  checklist: null,
  notifyStakeholders: null,
  notificationSentAt: null,
  triggerOverrides: null,
  triggerPrompt: null,
  lastOutput: null,
  dependencies: null,
  blocked: false,
  worktreePath: null,
  siegeIteration: 0,
  siegeActive: false,
  siegeMaxIterations: 3,
  siegeLastChecked: null,
  queuedAt: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('task-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    refreshWorkspace.mockReset()
    useTaskStore.setState({
      tasks: [],
      loaded: false,
    })
  })

  describe('load', () => {
    it('should load tasks from IPC', async () => {
      const mockTasks = [
        createMockTask({ id: 'task-1', title: 'Task 1' }),
        createMockTask({ id: 'task-2', title: 'Task 2', position: 1 }),
      ]
      mockIpc.getTasks.mockResolvedValueOnce(mockTasks)

      await useTaskStore.getState().load('ws-1')

      const state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(2)
      expect(state.loaded).toBe(true)
      expect(mockIpc.getTasks).toHaveBeenCalledWith('ws-1')
    })
  })

  describe('add', () => {
    it('should create task via IPC and add to store', async () => {
      const newTask = createMockTask({ id: 'task-new', title: 'New Task' })
      mockIpc.createTask.mockResolvedValueOnce(newTask)
      refreshWorkspace.mockResolvedValueOnce(undefined)

      const created = await useTaskStore.getState().add('ws-1', 'col-1', 'New Task', 'Description')

      const state = useTaskStore.getState()
      expect(created).toEqual(newTask)
      expect(state.tasks).toContainEqual(newTask)
      expect(mockIpc.createTask).toHaveBeenCalledWith('ws-1', 'col-1', 'New Task', 'Description')
      expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
    })
  })

  describe('remove', () => {
    beforeEach(() => {
      useTaskStore.setState({
        tasks: [createMockTask({ id: 'task-1' }), createMockTask({ id: 'task-2', position: 1 })],
      })
    })

    it('should optimistically remove task', async () => {
      mockIpc.deleteTask.mockResolvedValueOnce(undefined)
      refreshWorkspace.mockResolvedValueOnce(undefined)

      await useTaskStore.getState().remove('task-1')

      const state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(1)
      expect(state.tasks[0]?.id).toBe('task-2')
    })

    it('should call IPC to delete task', async () => {
      mockIpc.deleteTask.mockResolvedValueOnce(undefined)
      refreshWorkspace.mockResolvedValueOnce(undefined)

      await useTaskStore.getState().remove('task-1')

      expect(mockIpc.deleteTask).toHaveBeenCalledWith('task-1')
      expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
    })

    it('should revert on IPC error', async () => {
      mockIpc.deleteTask.mockRejectedValueOnce(new Error('Failed'))

      await useTaskStore.getState().remove('task-1')

      const state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(2)
    })
  })

  describe('move', () => {
    beforeEach(() => {
      useTaskStore.setState({
        tasks: [createMockTask({ id: 'task-1', columnId: 'col-1', position: 0 })],
      })
    })

    it('should optimistically update task column and position', async () => {
      mockIpc.moveTask.mockResolvedValueOnce(
        createMockTask({ id: 'task-1', columnId: 'col-2', position: 0 }),
      )
      refreshWorkspace.mockResolvedValueOnce(undefined)

      await useTaskStore.getState().move('task-1', 'col-2', 0)

      const state = useTaskStore.getState()
      expect(state.tasks[0]?.columnId).toBe('col-2')
    })

    it('should call IPC to persist move', async () => {
      mockIpc.moveTask.mockResolvedValueOnce(createMockTask())
      refreshWorkspace.mockResolvedValueOnce(undefined)

      await useTaskStore.getState().move('task-1', 'col-2', 0)

      expect(mockIpc.moveTask).toHaveBeenCalledWith('task-1', 'col-2', 0)
      expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
    })

    it('should revert on IPC error', async () => {
      mockIpc.moveTask.mockRejectedValueOnce(new Error('Failed'))

      await useTaskStore.getState().move('task-1', 'col-2', 0)

      const state = useTaskStore.getState()
      expect(state.tasks[0]?.columnId).toBe('col-1')
    })
  })

  describe('bulkRemove', () => {
    beforeEach(() => {
      useTaskStore.setState({
        tasks: [
          createMockTask({ id: 'task-1' }),
          createMockTask({ id: 'task-2', position: 1 }),
          createMockTask({ id: 'task-3', position: 2 }),
        ],
      })
    })

    it('should optimistically remove selected tasks', async () => {
      mockIpc.bulkUpdateTasks.mockResolvedValueOnce([])
      refreshWorkspace.mockResolvedValueOnce(undefined)

      const result = await useTaskStore.getState().bulkRemove(['task-1', 'task-3'])

      const state = useTaskStore.getState()
      expect(result).toBe(true)
      expect(state.tasks.map((task) => task.id)).toEqual(['task-2'])
      expect(mockIpc.bulkUpdateTasks).toHaveBeenCalledWith(['task-1', 'task-3'], { delete: true })
      expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
    })

    it('should revert bulk delete on IPC error', async () => {
      mockIpc.bulkUpdateTasks.mockRejectedValueOnce(new Error('Failed'))

      const result = await useTaskStore.getState().bulkRemove(['task-1', 'task-3'])

      const state = useTaskStore.getState()
      expect(result).toBe(false)
      expect(state.tasks).toHaveLength(3)
    })

    it('should report empty bulk delete as not applied', async () => {
      const result = await useTaskStore.getState().bulkRemove([])

      expect(result).toBe(false)
      expect(mockIpc.bulkUpdateTasks).not.toHaveBeenCalled()
    })
  })

  describe('bulkMove', () => {
    beforeEach(() => {
      useTaskStore.setState({
        tasks: [
          createMockTask({ id: 'task-1', columnId: 'col-1', position: 0 }),
          createMockTask({ id: 'task-2', columnId: 'col-1', position: 1 }),
          createMockTask({ id: 'task-3', columnId: 'col-2', position: 0 }),
        ],
      })
    })

    it('should optimistically move selected tasks to target column', async () => {
      mockIpc.bulkUpdateTasks.mockResolvedValueOnce([
        createMockTask({ id: 'task-1', columnId: 'col-2', position: 1 }),
        createMockTask({ id: 'task-2', columnId: 'col-2', position: 2 }),
      ])
      refreshWorkspace.mockResolvedValueOnce(undefined)

      const result = await useTaskStore.getState().bulkMove(['task-1', 'task-2'], 'col-2')

      const state = useTaskStore.getState()
      expect(result).toBe(true)
      expect(state.tasks.find((task) => task.id === 'task-1')?.columnId).toBe('col-2')
      expect(state.tasks.find((task) => task.id === 'task-2')?.columnId).toBe('col-2')
      expect(mockIpc.bulkUpdateTasks).toHaveBeenCalledWith(['task-1', 'task-2'], { targetColumnId: 'col-2' })
      expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
    })

    it('should revert bulk move on IPC error', async () => {
      mockIpc.bulkUpdateTasks.mockRejectedValueOnce(new Error('Failed'))

      const result = await useTaskStore.getState().bulkMove(['task-1', 'task-2'], 'col-2')

      const state = useTaskStore.getState()
      expect(result).toBe(false)
      expect(state.tasks.find((task) => task.id === 'task-1')?.columnId).toBe('col-1')
      expect(state.tasks.find((task) => task.id === 'task-2')?.columnId).toBe('col-1')
    })

    it('should report empty bulk move as not applied', async () => {
      const result = await useTaskStore.getState().bulkMove([], 'col-2')

      expect(result).toBe(false)
      expect(mockIpc.bulkUpdateTasks).not.toHaveBeenCalled()
    })
  })

  describe('reorder', () => {
    beforeEach(() => {
      useTaskStore.setState({
        tasks: [
          createMockTask({ id: 'task-1', columnId: 'col-1', position: 0 }),
          createMockTask({ id: 'task-2', columnId: 'col-1', position: 1 }),
          createMockTask({ id: 'task-3', columnId: 'col-2', position: 0 }),
        ],
      })
    })

    it('should optimistically reorder tasks in column', async () => {
      mockIpc.reorderTasks.mockResolvedValueOnce([])

      await useTaskStore.getState().reorder('col-1', ['task-2', 'task-1'])

      const state = useTaskStore.getState()
      const col1Tasks = state.tasks.filter((t) => t.columnId === 'col-1')
      expect(col1Tasks.find((t) => t.id === 'task-2')?.position).toBe(0)
      expect(col1Tasks.find((t) => t.id === 'task-1')?.position).toBe(1)
    })

    it('should not affect tasks in other columns', async () => {
      mockIpc.reorderTasks.mockResolvedValueOnce([])

      await useTaskStore.getState().reorder('col-1', ['task-2', 'task-1'])

      const state = useTaskStore.getState()
      const col2Task = state.tasks.find((t) => t.columnId === 'col-2')
      expect(col2Task?.position).toBe(0)
    })
  })

  describe('updateTask', () => {
    beforeEach(() => {
      useTaskStore.setState({
        tasks: [createMockTask({ id: 'task-1', title: 'Original Title' })],
      })
    })

    it('should update task in store', () => {
      useTaskStore.getState().updateTask('task-1', { title: 'Updated Title' })

      const state = useTaskStore.getState()
      expect(state.tasks[0]?.title).toBe('Updated Title')
    })

    it('should only update specified fields', () => {
      useTaskStore.getState().updateTask('task-1', { title: 'Updated Title' })

      const state = useTaskStore.getState()
      expect(state.tasks[0]?.description).toBe('')
    })
  })

  describe('getByColumn', () => {
    beforeEach(() => {
      useTaskStore.setState({
        tasks: [
          createMockTask({ id: 'task-1', columnId: 'col-1', position: 1 }),
          createMockTask({ id: 'task-2', columnId: 'col-1', position: 0 }),
          createMockTask({ id: 'task-3', columnId: 'col-2', position: 0 }),
        ],
      })
    })

    it('should return tasks for specified column', () => {
      const tasks = useTaskStore.getState().getByColumn('col-1')

      expect(tasks).toHaveLength(2)
      expect(tasks.every((t) => t.columnId === 'col-1')).toBe(true)
    })

    it('should return tasks sorted by position', () => {
      const tasks = useTaskStore.getState().getByColumn('col-1')

      expect(tasks[0]?.id).toBe('task-2') // position 0
      expect(tasks[1]?.id).toBe('task-1') // position 1
    })

    it('should return empty array for column with no tasks', () => {
      const tasks = useTaskStore.getState().getByColumn('col-nonexistent')

      expect(tasks).toHaveLength(0)
    })
  })

  describe('duplicate', () => {
    beforeEach(() => {
      useTaskStore.setState({
        tasks: [
          createMockTask({ id: 'task-1', title: 'Original Task', description: 'Some description' }),
        ],
      })
    })

    it('should duplicate task', async () => {
      const duplicatedTask = createMockTask({
        id: 'task-dup',
        title: 'Original Task (copy)',
        description: 'Some description',
      })
      mockIpc.duplicateTask.mockResolvedValueOnce(duplicatedTask)
      refreshWorkspace.mockResolvedValueOnce(undefined)

      const result = await useTaskStore.getState().duplicate('task-1')

      expect(result).toEqual(duplicatedTask)
      expect(mockIpc.duplicateTask).toHaveBeenCalledWith('task-1')
      expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
    })

    it('should add duplicated task to store', async () => {
      const duplicatedTask = createMockTask({ id: 'task-dup', title: 'Original Task (copy)' })
      mockIpc.duplicateTask.mockResolvedValueOnce(duplicatedTask)

      await useTaskStore.getState().duplicate('task-1')

      const state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(2)
      expect(state.tasks).toContainEqual(duplicatedTask)
    })

    it('should shift following tasks in the same column', async () => {
      useTaskStore.setState({
        tasks: [
          createMockTask({ id: 'task-1', columnId: 'col-1', position: 0 }),
          createMockTask({ id: 'task-2', columnId: 'col-1', position: 1 }),
          createMockTask({ id: 'task-3', columnId: 'col-2', position: 1 }),
        ],
      })
      const duplicatedTask = createMockTask({
        id: 'task-dup',
        columnId: 'col-1',
        position: 1,
        title: 'Original Task (copy)',
      })
      mockIpc.duplicateTask.mockResolvedValueOnce(duplicatedTask)

      await useTaskStore.getState().duplicate('task-1')

      const tasks = useTaskStore.getState().tasks
      expect(tasks.find((task) => task.id === 'task-2')?.position).toBe(2)
      expect(tasks.find((task) => task.id === 'task-3')?.position).toBe(1)
      expect(useTaskStore.getState().getByColumn('col-1').map((task) => task.id)).toEqual([
        'task-1',
        'task-dup',
        'task-2',
      ])
    })

    it('should return null for non-existent task', async () => {
      const result = await useTaskStore.getState().duplicate('non-existent')

      expect(result).toBeNull()
      expect(mockIpc.duplicateTask).not.toHaveBeenCalled()
    })
  })
})
