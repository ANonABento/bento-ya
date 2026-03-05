import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useTaskStore } from './task-store'
import type { Task } from '@/types'

vi.mock('@tauri-apps/api/core')

const mockTask: Task = {
  id: 'task-1',
  workspaceId: 'ws-1',
  columnId: 'col-1',
  title: 'Test Task',
  description: 'A test task',
  branch: null,
  agentType: null,
  agentMode: null,
  agentStatus: null,
  pipelineState: 'idle',
  pipelineTriggeredAt: null,
  pipelineError: null,
  lastScriptExitCode: null,
  reviewStatus: null,
  prNumber: null,
  prUrl: null,
  siegeIteration: 0,
  siegeActive: false,
  siegeMaxIterations: 3,
  siegeLastChecked: null,
  prMergeable: null,
  prCiStatus: null,
  prReviewDecision: null,
  prCommentCount: 0,
  prIsDraft: false,
  prLabels: '[]',
  prLastFetched: null,
  prHeadSha: null,
  checklist: null,
  notifyStakeholders: null,
  notificationSentAt: null,
  position: 0,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('task-store', () => {
  beforeEach(() => {
    useTaskStore.setState({
      tasks: [],
      loaded: false,
    })
    vi.clearAllMocks()
  })

  describe('load', () => {
    it('should load tasks from backend', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([mockTask])

      await useTaskStore.getState().load('ws-1')

      expect(invoke).toHaveBeenCalledWith('list_tasks', { workspaceId: 'ws-1' })
      expect(useTaskStore.getState().tasks).toEqual([mockTask])
      expect(useTaskStore.getState().loaded).toBe(true)
    })
  })

  describe('add', () => {
    it('should create task and add to store', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(mockTask)

      await useTaskStore.getState().add('ws-1', 'col-1', 'New Task', 'Description')

      expect(invoke).toHaveBeenCalledWith('create_task', {
        workspaceId: 'ws-1',
        columnId: 'col-1',
        title: 'New Task',
        description: 'Description',
      })
      expect(useTaskStore.getState().tasks).toContainEqual(mockTask)
    })
  })

  describe('remove', () => {
    it('should delete task and remove from store', async () => {
      useTaskStore.setState({ tasks: [mockTask] })
      vi.mocked(invoke).mockResolvedValueOnce(undefined)

      await useTaskStore.getState().remove('task-1')

      expect(invoke).toHaveBeenCalledWith('delete_task', { id: 'task-1' })
      expect(useTaskStore.getState().tasks).toEqual([])
    })

    it('should rollback on error', async () => {
      useTaskStore.setState({ tasks: [mockTask] })
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Delete failed'))

      await useTaskStore.getState().remove('task-1')

      expect(useTaskStore.getState().tasks).toContainEqual(mockTask)
    })
  })

  describe('move', () => {
    it('should move task to new column', async () => {
      useTaskStore.setState({ tasks: [mockTask] })
      vi.mocked(invoke).mockResolvedValueOnce(undefined)

      await useTaskStore.getState().move('task-1', 'col-2', 0)

      expect(invoke).toHaveBeenCalledWith('move_task', {
        id: 'task-1',
        targetColumnId: 'col-2',
        position: 0,
      })
      const task = useTaskStore.getState().tasks.find(t => t.id === 'task-1')
      expect(task?.columnId).toBe('col-2')
    })
  })

  describe('updateTask', () => {
    it('should update task in store', () => {
      useTaskStore.setState({ tasks: [mockTask] })

      useTaskStore.getState().updateTask('task-1', { title: 'Updated Title' })

      const task = useTaskStore.getState().tasks.find(t => t.id === 'task-1')
      expect(task?.title).toBe('Updated Title')
    })

    it('should update notification fields', () => {
      useTaskStore.setState({ tasks: [mockTask] })

      useTaskStore.getState().updateTask('task-1', {
        notifyStakeholders: '["user@example.com"]',
        notificationSentAt: '2024-01-01T12:00:00Z',
      })

      const task = useTaskStore.getState().tasks.find(t => t.id === 'task-1')
      expect(task?.notifyStakeholders).toBe('["user@example.com"]')
      expect(task?.notificationSentAt).toBe('2024-01-01T12:00:00Z')
    })

    it('should update checklist field', () => {
      useTaskStore.setState({ tasks: [mockTask] })
      const checklistData = JSON.stringify([{ id: '1', text: 'Item 1', checked: false }])

      useTaskStore.getState().updateTask('task-1', { checklist: checklistData })

      const task = useTaskStore.getState().tasks.find(t => t.id === 'task-1')
      expect(task?.checklist).toBe(checklistData)
    })
  })

  describe('getByColumn', () => {
    it('should return tasks for specific column', () => {
      const task2 = { ...mockTask, id: 'task-2', columnId: 'col-2' }
      useTaskStore.setState({ tasks: [mockTask, task2] })

      const col1Tasks = useTaskStore.getState().getByColumn('col-1')
      const col2Tasks = useTaskStore.getState().getByColumn('col-2')

      expect(col1Tasks).toHaveLength(1)
      expect(col1Tasks[0]?.id).toBe('task-1')
      expect(col2Tasks).toHaveLength(1)
      expect(col2Tasks[0]?.id).toBe('task-2')
    })
  })
})
