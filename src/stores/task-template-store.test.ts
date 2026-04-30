import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TaskTemplate } from '@/types'

vi.mock('@/lib/ipc', () => ({
  listTaskTemplates: vi.fn(),
  createTaskTemplateFromTask: vi.fn(),
  updateTaskTemplate: vi.fn(),
  deleteTaskTemplate: vi.fn(),
  createTaskFromTemplate: vi.fn(),
}))

import * as ipc from '@/lib/ipc'
import { useTaskTemplateStore } from './task-template-store'

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

describe('task-template-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTaskTemplateStore.setState({
      templates: [],
      loadedWorkspaceId: null,
      loadingWorkspaceId: null,
    })
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
