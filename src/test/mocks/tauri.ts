import { vi } from 'vitest'
import type { Workspace, Column, Task } from '@/types'
import { DEFAULT_TRIGGERS } from '@/types/column'

// Mock data factories
export const mockWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: `ws-${Math.random().toString(36).slice(2, 9)}`,
  name: 'Test Workspace',
  repoPath: '/path/to/repo',
  tabOrder: 0,
  isActive: true,
  activeTaskCount: 0,
  config: '{}',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

export const mockColumn = (overrides: Partial<Column> = {}): Column => ({
  id: `col-${Math.random().toString(36).slice(2, 9)}`,
  workspaceId: 'ws-1',
  name: 'Test Column',
  icon: '📋',
  position: 0,
  color: '',
  visible: true,
  triggers: DEFAULT_TRIGGERS,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

export const mockKanbanColumn = (overrides: Partial<Column> = {}): Column =>
  mockColumn({
    id: 'c1',
    name: 'Todo',
    icon: '',
    triggers: {
      on_entry: { type: 'spawn_cli' },
      on_exit: { type: 'none' },
      exit_criteria: { type: 'manual', auto_advance: false },
    },
    ...overrides,
  })

export const mockTask = (overrides: Partial<Task> = {}): Task => ({
  id: `task-${Math.random().toString(36).slice(2, 9)}`,
  workspaceId: 'ws-1',
  columnId: 'col-1',
  title: 'Test Task',
  description: '',
  branch: null,
  agentType: null,
  agentMode: null,
  agentStatus: null,
  position: 0,
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
  labels: [],
  prLastFetched: null,
  prHeadSha: null,
  checklist: null,
  estimatedHours: null,
  actualHours: 0,
  notifyStakeholders: null,
  notificationSentAt: null,
  triggerOverrides: null,
  triggerPrompt: null,
  lastOutput: null,
  dependencies: null,
  blocked: false,
  worktreePath: null,
  archivedAt: null,
  queuedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

export const mockKanbanTask = (overrides: Partial<Task> = {}): Task =>
  mockTask({
    id: 't1',
    columnId: 'c1',
    title: 'Test task',
    agentStatus: 'idle',
    siegeMaxIterations: 3,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  })

// Helper to setup invoke mock with responses
export async function setupInvokeMock(responses: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core')
  const mockedInvoke = vi.mocked(invoke)

  mockedInvoke.mockImplementation((cmd: string) => {
    if (cmd in responses) {
      return Promise.resolve(responses[cmd])
    }
    return Promise.reject(new Error(`Unmocked command: ${cmd}`))
  })

  return mockedInvoke
}
