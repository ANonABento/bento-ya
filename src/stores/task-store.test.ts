import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTaskStore } from './task-store'
import type { Task } from '@/types'

// Mock IPC module
vi.mock('@/lib/ipc', () => ({
  getTasks: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
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

      await useTaskStore.getState().add('ws-1', 'col-1', 'New Task', 'Description')

      const state = useTaskStore.getState()
      expect(state.tasks).toContainEqual(newTask)
      expect(mockIpc.createTask).toHaveBeenCalledWith('ws-1', 'col-1', 'New Task', 'Description')
    })
  })

  describe('remove', () => {
    beforeEach(() => {
      useTaskStore.setState({
        tasks: [
          createMockTask({ id: 'task-1' }),
          createMockTask({ id: 'task-2', position: 1 }),
        ],
      })
    })

    it('should optimistically remove task', async () => {
      mockIpc.deleteTask.mockResolvedValueOnce(undefined)

      await useTaskStore.getState().remove('task-1')

      const state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(1)
      expect(state.tasks[0]?.id).toBe('task-2')
    })

    it('should call IPC to delete task', async () => {
      mockIpc.deleteTask.mockResolvedValueOnce(undefined)

      await useTaskStore.getState().remove('task-1')

      expect(mockIpc.deleteTask).toHaveBeenCalledWith('task-1')
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
        tasks: [
          createMockTask({ id: 'task-1', columnId: 'col-1', position: 0 }),
        ],
      })
    })

    it('should optimistically update task column and position', async () => {
      mockIpc.moveTask.mockResolvedValueOnce(createMockTask({ id: 'task-1', columnId: 'col-2', position: 0 }))

      await useTaskStore.getState().move('task-1', 'col-2', 0)

      const state = useTaskStore.getState()
      expect(state.tasks[0]?.columnId).toBe('col-2')
    })

    it('should call IPC to persist move', async () => {
      mockIpc.moveTask.mockResolvedValueOnce(createMockTask())

      await useTaskStore.getState().move('task-1', 'col-2', 0)

      expect(mockIpc.moveTask).toHaveBeenCalledWith('task-1', 'col-2', 0)
    })

    it('should revert on IPC error', async () => {
      mockIpc.moveTask.mockRejectedValueOnce(new Error('Failed'))

      await useTaskStore.getState().move('task-1', 'col-2', 0)

      const state = useTaskStore.getState()
      expect(state.tasks[0]?.columnId).toBe('col-1')
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
        tasks: [createMockTask({ id: 'task-1', title: 'Original Task', description: 'Some description' })],
      })
    })

    it('should create a copy of the task with "(Copy)" suffix', async () => {
      const duplicatedTask = createMockTask({ id: 'task-dup', title: 'Original Task (Copy)', description: 'Some description' })
      mockIpc.createTask.mockResolvedValueOnce(duplicatedTask)

      const result = await useTaskStore.getState().duplicate('task-1')

      expect(result).toEqual(duplicatedTask)
      expect(mockIpc.createTask).toHaveBeenCalledWith('ws-1', 'col-1', 'Original Task (Copy)', 'Some description')
    })

    it('should add duplicated task to store', async () => {
      const duplicatedTask = createMockTask({ id: 'task-dup', title: 'Original Task (Copy)' })
      mockIpc.createTask.mockResolvedValueOnce(duplicatedTask)

      await useTaskStore.getState().duplicate('task-1')

      const state = useTaskStore.getState()
      expect(state.tasks).toHaveLength(2)
      expect(state.tasks).toContainEqual(duplicatedTask)
    })

    it('should not add extra "(Copy)" if title already ends with it', async () => {
      useTaskStore.setState({
        tasks: [createMockTask({ id: 'task-1', title: 'Already Copied (Copy)' })],
      })
      const duplicatedTask = createMockTask({ id: 'task-dup', title: 'Already Copied (Copy)' })
      mockIpc.createTask.mockResolvedValueOnce(duplicatedTask)

      await useTaskStore.getState().duplicate('task-1')

      expect(mockIpc.createTask).toHaveBeenCalledWith('ws-1', 'col-1', 'Already Copied (Copy)', '')
    })

    it('should return null for non-existent task', async () => {
      const result = await useTaskStore.getState().duplicate('non-existent')

      expect(result).toBeNull()
      expect(mockIpc.createTask).not.toHaveBeenCalled()
    })
  })
})
