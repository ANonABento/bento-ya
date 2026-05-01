import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Task, TaskTemplate } from '@/types'

vi.mock('@/lib/ipc', () => ({
  listTaskTemplates: vi.fn(),
  createTaskTemplateFromTask: vi.fn(),
  updateTaskTemplate: vi.fn(),
  deleteTaskTemplate: vi.fn(),
  createTaskFromTemplate: vi.fn(),
}))

import * as ipc from '@/lib/ipc'
import { useTaskTemplateStore } from './task-template-store'
import { useTaskStore } from './task-store'
import { useWorkspaceStore } from './workspace-store'

const mockIpc = vi.mocked(ipc)

const template = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
  id: 'template-1',
  workspaceId: 'ws-1',
  title: 'Template',
  description: null,
  labels: '[]',
  model: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  workspaceId: 'ws-1',
  columnId: 'col-1',
  title: 'Task',
  description: '',
  branch: null,
  agentType: null,
  agentMode: null,
  agentStatus: null,
  queuedAt: null,
  batchId: null,
  pipelineState: 'idle',
  pipelineTriggeredAt: null,
  pipelineError: null,
  retryCount: 0,
  model: null,
  lastScriptExitCode: null,
  reviewStatus: null,
  prNumber: null,
  prUrl: null,
  siegeIteration: 0,
  siegeActive: false,
  siegeMaxIterations: 5,
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
  triggerOverrides: null,
  triggerPrompt: null,
  lastOutput: null,
  dependencies: null,
  blocked: false,
  worktreePath: null,
  position: 0,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('task-template-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTaskTemplateStore.setState({
      templates: [],
      loadedWorkspaceId: null,
      loadingWorkspaceId: null,
    })
    useTaskStore.setState({ tasks: [], loaded: false })
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      loaded: false,
    })
    useWorkspaceStore.setState({ refreshWorkspace: vi.fn() })
  })

  it('clears templates while loading a different workspace', async () => {
    useTaskTemplateStore.setState({
      templates: [template({ workspaceId: 'ws-1' })],
      loadedWorkspaceId: 'ws-1',
      loadingWorkspaceId: null,
    })

    let resolveTemplates: (templates: TaskTemplate[]) => void = () => {}
    mockIpc.listTaskTemplates.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTemplates = resolve
      }),
    )

    const loadPromise = useTaskTemplateStore.getState().load('ws-2')

    expect(useTaskTemplateStore.getState().templates).toEqual([])
    expect(useTaskTemplateStore.getState().loadedWorkspaceId).toBeNull()
    expect(useTaskTemplateStore.getState().loadingWorkspaceId).toBe('ws-2')

    const nextTemplates = [template({ id: 'template-2', workspaceId: 'ws-2' })]
    resolveTemplates(nextTemplates)
    await loadPromise

    expect(useTaskTemplateStore.getState().templates).toEqual(nextTemplates)
    expect(useTaskTemplateStore.getState().loadedWorkspaceId).toBe('ws-2')
  })

  it('only prepends a saved template when its workspace is loaded', async () => {
    useTaskTemplateStore.setState({
      templates: [template({ id: 'existing', workspaceId: 'ws-1' })],
      loadedWorkspaceId: 'ws-1',
      loadingWorkspaceId: null,
    })
    mockIpc.createTaskTemplateFromTask.mockResolvedValueOnce(
      template({ id: 'other-workspace-template', workspaceId: 'ws-2' }),
    )

    await useTaskTemplateStore.getState().saveFromTask('task-1')

    expect(useTaskTemplateStore.getState().templates.map((item) => item.id)).toEqual(['existing'])
  })

  it('keeps templates sorted after save and edit', async () => {
    useTaskTemplateStore.setState({
      templates: [
        template({ id: 'old', title: 'Old', updatedAt: '2024-01-01T00:00:00Z' }),
        template({ id: 'middle', title: 'Middle', updatedAt: '2024-01-02T00:00:00Z' }),
      ],
      loadedWorkspaceId: 'ws-1',
      loadingWorkspaceId: null,
    })
    mockIpc.createTaskTemplateFromTask.mockResolvedValueOnce(
      template({ id: 'new', title: 'New', updatedAt: '2024-01-03T00:00:00Z' }),
    )
    mockIpc.updateTaskTemplate.mockResolvedValueOnce(
      template({ id: 'old', title: 'Old edited', updatedAt: '2024-01-04T00:00:00Z' }),
    )

    await useTaskTemplateStore.getState().saveFromTask('task-1')
    expect(useTaskTemplateStore.getState().templates.map((item) => item.id)).toEqual(['new', 'middle', 'old'])

    await useTaskTemplateStore.getState().update('old', {
      title: 'Old edited',
      description: null,
      labels: '[]',
      model: null,
    })

    expect(useTaskTemplateStore.getState().templates.map((item) => item.id)).toEqual(['old', 'new', 'middle'])
  })

  it('adds a task from a template and refreshes its workspace', async () => {
    const refreshWorkspace = vi.fn().mockResolvedValue(undefined)
    useWorkspaceStore.setState({ refreshWorkspace })
    const createdTask = task({ id: 'created-task', workspaceId: 'ws-1', columnId: 'col-1' })
    mockIpc.createTaskFromTemplate.mockResolvedValueOnce(createdTask)
    mockIpc.listTaskTemplates.mockResolvedValueOnce([
      template({ id: 'template-1', workspaceId: 'ws-1' }),
    ])
    useTaskTemplateStore.setState({
      templates: [template({ id: 'template-1', workspaceId: 'ws-1' })],
      loadedWorkspaceId: 'ws-1',
      loadingWorkspaceId: null,
    })

    await useTaskTemplateStore.getState().createTask('template-1', 'col-1')

    expect(mockIpc.createTaskFromTemplate).toHaveBeenCalledWith('template-1', 'col-1')
    expect(useTaskStore.getState().tasks).toEqual([createdTask])
    expect(refreshWorkspace).toHaveBeenCalledWith('ws-1')
  })

  it('ignores stale load responses when switching workspaces quickly', async () => {
    let resolveWs1: (templates: TaskTemplate[]) => void = () => {}
    let resolveWs2: (templates: TaskTemplate[]) => void = () => {}
    mockIpc.listTaskTemplates
      .mockReturnValueOnce(new Promise((resolve) => { resolveWs1 = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveWs2 = resolve }))

    const ws1Load = useTaskTemplateStore.getState().load('ws-1')
    const ws2Load = useTaskTemplateStore.getState().load('ws-2')

    const ws2Templates = [template({ id: 'template-2', workspaceId: 'ws-2' })]
    resolveWs2(ws2Templates)
    await ws2Load

    resolveWs1([template({ id: 'template-1', workspaceId: 'ws-1' })])
    await ws1Load

    expect(useTaskTemplateStore.getState().templates).toEqual(ws2Templates)
    expect(useTaskTemplateStore.getState().loadedWorkspaceId).toBe('ws-2')
  })
})
