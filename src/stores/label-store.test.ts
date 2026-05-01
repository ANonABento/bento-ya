import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLabelStore } from './label-store'
import type { Label, TaskLabelAssignment } from '@/types'

vi.mock('@/lib/ipc', () => ({
  getLabels: vi.fn(),
  getTaskLabelAssignments: vi.fn(),
  createLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
  setTaskLabels: vi.fn(),
}))

import * as ipc from '@/lib/ipc'

const mockIpc = vi.mocked(ipc)

const createMockLabel = (overrides: Partial<Label> = {}): Label => ({
  id: 'label-1',
  workspaceId: 'ws-1',
  name: 'Bug',
  color: '#ef4444',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('label-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLabelStore.setState({
      labels: [],
      taskLabels: {},
      selectedLabelId: null,
      loaded: false,
    })
  })

  it('loads labels and groups task assignments by task id', async () => {
    const labels = [
      createMockLabel({ id: 'label-1', name: 'Bug' }),
      createMockLabel({ id: 'label-2', name: 'Docs', color: '#3b82f6' }),
    ]
    const assignments: TaskLabelAssignment[] = [
      { taskId: 'task-1', labelId: 'label-1' },
      { taskId: 'task-1', labelId: 'label-2' },
      { taskId: 'task-2', labelId: 'label-2' },
    ]
    mockIpc.getLabels.mockResolvedValueOnce(labels)
    mockIpc.getTaskLabelAssignments.mockResolvedValueOnce(assignments)

    await useLabelStore.getState().load('ws-1')

    expect(mockIpc.getLabels).toHaveBeenCalledWith('ws-1')
    expect(mockIpc.getTaskLabelAssignments).toHaveBeenCalledWith('ws-1')
    expect(useLabelStore.getState().labels).toEqual(labels)
    expect(useLabelStore.getState().taskLabels).toEqual({
      'task-1': ['label-1', 'label-2'],
      'task-2': ['label-2'],
    })
    expect(useLabelStore.getState().loaded).toBe(true)
  })

  it('clears the selected filter when the selected label is no longer loaded', async () => {
    useLabelStore.setState({ selectedLabelId: 'missing-label' })
    mockIpc.getLabels.mockResolvedValueOnce([createMockLabel({ id: 'label-1' })])
    mockIpc.getTaskLabelAssignments.mockResolvedValueOnce([])

    await useLabelStore.getState().load('ws-1')

    expect(useLabelStore.getState().selectedLabelId).toBeNull()
  })

  it('creates labels and keeps them sorted by name', async () => {
    const bug = createMockLabel({ id: 'label-1', name: 'Bug' })
    const docs = createMockLabel({ id: 'label-2', name: 'Docs', color: '#3b82f6' })
    useLabelStore.setState({ labels: [docs] })
    mockIpc.createLabel.mockResolvedValueOnce(bug)

    const created = await useLabelStore.getState().create('ws-1', 'Bug', '#ef4444')

    expect(created).toEqual(bug)
    expect(mockIpc.createLabel).toHaveBeenCalledWith('ws-1', 'Bug', '#ef4444')
    expect(useLabelStore.getState().labels.map((label) => label.name)).toEqual(['Bug', 'Docs'])
  })

  it('updates labels and preserves sorted order', async () => {
    useLabelStore.setState({
      labels: [
        createMockLabel({ id: 'label-1', name: 'Bug' }),
        createMockLabel({ id: 'label-2', name: 'Docs', color: '#3b82f6' }),
      ],
    })
    const updated = createMockLabel({ id: 'label-2', name: 'API', color: '#10b981' })
    mockIpc.updateLabel.mockResolvedValueOnce(updated)

    await useLabelStore.getState().update('label-2', { name: 'API', color: '#10b981' })

    expect(mockIpc.updateLabel).toHaveBeenCalledWith('label-2', { name: 'API', color: '#10b981' })
    expect(useLabelStore.getState().labels.map((label) => label.name)).toEqual(['API', 'Bug'])
  })

  it('deletes labels, removes assignments, and clears active filter', async () => {
    useLabelStore.setState({
      labels: [
        createMockLabel({ id: 'label-1', name: 'Bug' }),
        createMockLabel({ id: 'label-2', name: 'Docs', color: '#3b82f6' }),
      ],
      taskLabels: {
        'task-1': ['label-1', 'label-2'],
        'task-2': ['label-1'],
      },
      selectedLabelId: 'label-1',
    })
    mockIpc.deleteLabel.mockResolvedValueOnce(undefined)

    await useLabelStore.getState().remove('label-1')

    expect(mockIpc.deleteLabel).toHaveBeenCalledWith('label-1')
    expect(useLabelStore.getState().labels.map((label) => label.id)).toEqual(['label-2'])
    expect(useLabelStore.getState().taskLabels).toEqual({
      'task-1': ['label-2'],
      'task-2': [],
    })
    expect(useLabelStore.getState().selectedLabelId).toBeNull()
  })

  it('persists task label assignments using ids returned by IPC', async () => {
    mockIpc.setTaskLabels.mockResolvedValueOnce(['label-2', 'label-1'])

    await useLabelStore.getState().setTaskLabels('task-1', ['label-1', 'label-2'])

    expect(mockIpc.setTaskLabels).toHaveBeenCalledWith('task-1', ['label-1', 'label-2'])
    expect(useLabelStore.getState().taskLabels['task-1']).toEqual(['label-2', 'label-1'])
  })

  it('returns assigned label objects for a task', () => {
    useLabelStore.setState({
      labels: [
        createMockLabel({ id: 'label-1', name: 'Bug' }),
        createMockLabel({ id: 'label-2', name: 'Docs', color: '#3b82f6' }),
      ],
      taskLabels: {
        'task-1': ['label-2'],
      },
    })

    expect(useLabelStore.getState().getTaskLabels('task-1')).toEqual([
      createMockLabel({ id: 'label-2', name: 'Docs', color: '#3b82f6' }),
    ])
  })
})
