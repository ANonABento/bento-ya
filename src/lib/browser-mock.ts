/**
 * Browser mock data for E2E testing and development without Tauri.
 * This module provides mock implementations of Tauri IPC commands.
 */

import type { Workspace, Column, Task, TriggerConfig, ExitConfig, AgentMode, AgentStatus, PipelineState } from '@/types'

// Check if we're running in Tauri or in a test environment
export const isTauri = (): boolean => {
  // In Vitest, we want to use the mocked @tauri-apps/api, not our browser mocks
  // Check for import.meta.env which Vite uses
  if (typeof import.meta !== 'undefined' && (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test') {
    return true // Let Vitest mocks handle it
  }
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// ─── Mock Data Store ────────────────────────────────────────────────────────

const defaultTrigger: TriggerConfig = { type: 'none', config: {} }
const defaultExit: ExitConfig = { type: 'manual', config: {} }

let mockWorkspaces: Workspace[] = [
  {
    id: 'ws-demo',
    name: 'Demo Workspace',
    repoPath: '/tmp/demo-repo',
    tabOrder: 0,
    isActive: true,
    config: '{}',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

let mockColumns: Column[] = [
  { id: 'col-1', workspaceId: 'ws-demo', name: 'Backlog', icon: 'inbox', position: 0, color: '', visible: true, trigger: defaultTrigger, exitCriteria: defaultExit, autoAdvance: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'col-2', workspaceId: 'ws-demo', name: 'Working', icon: 'code', position: 1, color: '', visible: true, trigger: defaultTrigger, exitCriteria: defaultExit, autoAdvance: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'col-3', workspaceId: 'ws-demo', name: 'Review', icon: 'eye', position: 2, color: '', visible: true, trigger: defaultTrigger, exitCriteria: defaultExit, autoAdvance: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'col-4', workspaceId: 'ws-demo', name: 'Done', icon: 'check', position: 3, color: '#4ADE80', visible: true, trigger: defaultTrigger, exitCriteria: defaultExit, autoAdvance: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

let mockTasks: Task[] = [
  {
    id: 'task-1',
    workspaceId: 'ws-demo',
    columnId: 'col-1',
    title: 'Sample Task',
    description: 'This is a demo task for testing',
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
    position: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

let idCounter = 100

const generateId = (prefix: string) => `${prefix}-${++idCounter}`

// ─── Mock Command Handlers ──────────────────────────────────────────────────

type CommandHandler = (args?: Record<string, unknown>) => unknown

const mockCommands: Record<string, CommandHandler> = {
  // Workspace commands
  list_workspaces: () => mockWorkspaces,
  get_workspace: (args) => mockWorkspaces.find(w => w.id === args?.id),
  create_workspace: (args) => {
    const ws: Workspace = {
      id: generateId('ws'),
      name: args?.name as string || 'New Workspace',
      repoPath: args?.repoPath as string || '/tmp/repo',
      tabOrder: mockWorkspaces.length,
      isActive: false,
      config: '{}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockWorkspaces.push(ws)
    return ws
  },
  update_workspace: (args) => {
    const existing = mockWorkspaces.find(w => w.id === args?.id)
    if (existing) {
      existing.name = (args?.name as string) ?? existing.name
      existing.repoPath = (args?.repoPath as string) ?? existing.repoPath
      existing.tabOrder = (args?.tabOrder as number) ?? existing.tabOrder
      existing.isActive = (args?.isActive as boolean) ?? existing.isActive
      existing.config = (args?.config as string) ?? existing.config
      existing.updatedAt = new Date().toISOString()
      return existing
    }
    throw new Error('Workspace not found')
  },
  delete_workspace: (args) => {
    mockWorkspaces = mockWorkspaces.filter(w => w.id !== args?.id)
    mockColumns = mockColumns.filter(c => c.workspaceId !== args?.id)
    mockTasks = mockTasks.filter(t => t.workspaceId !== args?.id)
  },
  reorder_workspaces: (args) => {
    const ids = args?.ids as string[]
    ids.forEach((id, idx) => {
      const ws = mockWorkspaces.find(w => w.id === id)
      if (ws) ws.tabOrder = idx
    })
  },

  // Column commands
  list_columns: (args) => mockColumns.filter(c => c.workspaceId === args?.workspaceId),
  create_column: (args) => {
    const col: Column = {
      id: generateId('col'),
      workspaceId: args?.workspaceId as string,
      name: args?.name as string || 'New Column',
      icon: 'list',
      position: args?.position as number || mockColumns.length,
      color: '',
      visible: true,
      trigger: defaultTrigger,
      exitCriteria: defaultExit,
      autoAdvance: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockColumns.push(col)
    return col
  },
  update_column: (args) => {
    const existing = mockColumns.find(c => c.id === args?.id)
    if (existing) {
      existing.name = (args?.name as string) ?? existing.name
      existing.icon = (args?.icon as string) ?? existing.icon
      existing.position = (args?.position as number) ?? existing.position
      existing.color = (args?.color as string) ?? existing.color
      existing.visible = (args?.visible as boolean) ?? existing.visible
      existing.trigger = (args?.trigger as TriggerConfig) ?? existing.trigger
      existing.exitCriteria = (args?.exitCriteria as ExitConfig) ?? existing.exitCriteria
      existing.autoAdvance = (args?.autoAdvance as boolean) ?? existing.autoAdvance
      existing.updatedAt = new Date().toISOString()
      return existing
    }
    throw new Error('Column not found')
  },
  delete_column: (args) => {
    mockColumns = mockColumns.filter(c => c.id !== args?.id)
    mockTasks = mockTasks.filter(t => t.columnId !== args?.id)
  },
  reorder_columns: (args) => {
    const columnIds = args?.columnIds as string[]
    columnIds.forEach((id, idx) => {
      const col = mockColumns.find(c => c.id === id)
      if (col) col.position = idx
    })
    return mockColumns.filter(c => c.workspaceId === args?.workspaceId)
  },

  // Task commands
  list_tasks: (args) => mockTasks.filter(t => t.workspaceId === args?.workspaceId),
  get_task: (args) => mockTasks.find(t => t.id === args?.id),
  create_task: (args) => {
    const task: Task = {
      id: generateId('task'),
      workspaceId: args?.workspaceId as string,
      columnId: args?.columnId as string,
      title: args?.title as string || 'New Task',
      description: args?.description as string || '',
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
      position: mockTasks.filter(t => t.columnId === args?.columnId).length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockTasks.push(task)
    return task
  },
  update_task: (args) => {
    const existing = mockTasks.find(t => t.id === args?.id)
    if (existing) {
      existing.title = (args?.title as string) ?? existing.title
      existing.description = (args?.description as string) ?? existing.description
      existing.columnId = (args?.columnId as string) ?? existing.columnId
      existing.branch = (args?.branch as string | null) ?? existing.branch
      existing.agentType = (args?.agentType as string | null) ?? existing.agentType
      existing.agentMode = (args?.agentMode as AgentMode | null) ?? existing.agentMode
      existing.agentStatus = (args?.agentStatus as AgentStatus | null) ?? existing.agentStatus
      existing.pipelineState = (args?.pipelineState as PipelineState) ?? existing.pipelineState
      existing.pipelineTriggeredAt = (args?.pipelineTriggeredAt as string | null) ?? existing.pipelineTriggeredAt
      existing.pipelineError = (args?.pipelineError as string | null) ?? existing.pipelineError
      existing.position = (args?.position as number) ?? existing.position
      existing.updatedAt = new Date().toISOString()
      return existing
    }
    throw new Error('Task not found')
  },
  move_task: (args) => {
    const task = mockTasks.find(t => t.id === args?.id)
    if (task) {
      task.columnId = args?.targetColumnId as string
      task.position = args?.position as number
      task.updatedAt = new Date().toISOString()
      return task
    }
    throw new Error('Task not found')
  },
  delete_task: (args) => {
    mockTasks = mockTasks.filter(t => t.id !== args?.id)
  },
  reorder_tasks: (args) => {
    const taskIds = args?.taskIds as string[]
    taskIds.forEach((id, idx) => {
      const task = mockTasks.find(t => t.id === id)
      if (task) task.position = idx
    })
    return mockTasks.filter(t => t.columnId === args?.columnId)
  },

  // Settings
  get_settings: () => ({ theme: 'dark', defaultTemplate: 'standard' }),
  update_settings: () => undefined,

  // PR creation (stub)
  create_pr: (args) => {
    const task = mockTasks.find(t => t.id === args?.taskId)
    if (task) {
      task.prNumber = 123
      task.prUrl = 'https://github.com/owner/repo/pull/123'
      task.updatedAt = new Date().toISOString()
      return { prNumber: 123, prUrl: 'https://github.com/owner/repo/pull/123', task }
    }
    throw new Error('Task not found')
  },

  // Notification commands
  update_task_stakeholders: (args) => {
    const task = mockTasks.find(t => t.id === args?.id)
    if (task) {
      task.notifyStakeholders = (args?.stakeholders as string | null) ?? null
      task.updatedAt = new Date().toISOString()
      return task
    }
    throw new Error('Task not found')
  },
  mark_task_notification_sent: (args) => {
    const task = mockTasks.find(t => t.id === args?.id)
    if (task) {
      task.notificationSentAt = new Date().toISOString()
      task.updatedAt = new Date().toISOString()
      return task
    }
    throw new Error('Task not found')
  },
  clear_task_notification_sent: (args) => {
    const task = mockTasks.find(t => t.id === args?.id)
    if (task) {
      task.notificationSentAt = null
      task.updatedAt = new Date().toISOString()
      return task
    }
    throw new Error('Task not found')
  },

  // Git commands (stubs)
  get_current_branch: () => 'main',
  list_task_branches: () => [],
  create_task_branch: () => 'task/new-branch',
  switch_branch: () => undefined,
  delete_task_branch: () => true,
  get_changes: () => ({ files: [], totalAdditions: 0, totalDeletions: 0, totalFiles: 0 }),
  get_diff: () => '',
  get_commits: () => [],
  get_conflict_matrix: () => ({ conflicts: [], hasConflicts: false }),

  // Agent commands (stubs)
  start_agent: () => ({ taskId: '', agentType: '', status: 'idle', pid: null, workingDir: '' }),
  stop_agent: () => undefined,
  get_agent_status: () => ({ taskId: '', agentType: '', status: 'idle', pid: null, workingDir: '' }),

  // Agent message commands
  save_agent_message: (args) => ({
    id: `msg-${Date.now()}`,
    taskId: args?.taskId ?? '',
    role: args?.role ?? 'user',
    content: args?.content ?? '',
    model: args?.model ?? null,
    effortLevel: args?.effortLevel ?? null,
    toolCalls: args?.toolCalls ?? null,
    thinkingContent: args?.thinkingContent ?? null,
    createdAt: new Date().toISOString(),
  }),
  get_agent_messages: () => [],
  clear_agent_messages: () => undefined,

  // Pipeline commands (stubs)
  mark_pipeline_complete: (args) => mockTasks.find(t => t.id === args?.taskId),
  get_pipeline_state: () => 'idle',
  try_advance_task: () => null,
  set_pipeline_error: (args) => mockTasks.find(t => t.id === args?.taskId),

  // Orchestrator commands (stubs)
  get_orchestrator_context: () => ({ workspaceId: '', workspaceName: '', columns: [], tasks: [], recentMessages: [] }),
  get_orchestrator_session: () => ({ id: '', workspaceId: '', status: 'idle', lastError: null, createdAt: '', updatedAt: '' }),
  send_orchestrator_message: () => ({ id: '', workspaceId: '', sessionId: null, role: 'user', content: '', createdAt: '' }),
  list_chat_sessions: () => [],
  get_active_chat_session: () => ({ id: 'mock-session', workspaceId: '', title: 'New Chat', createdAt: '', updatedAt: '' }),
  create_chat_session: () => ({ id: 'mock-session', workspaceId: '', title: 'New Chat', createdAt: '', updatedAt: '' }),
  delete_chat_session: () => undefined,
  get_chat_history: () => [],
  clear_chat_history: () => undefined,
  process_orchestrator_response: () => ({ message: '', actions: [], tasksCreated: [] }),
  set_orchestrator_error: () => ({ id: '', workspaceId: '', status: 'error', lastError: '', createdAt: '', updatedAt: '' }),
  stream_orchestrator_chat: () => { console.warn('[Browser Mock] stream_orchestrator_chat not available in browser mode'); return undefined },

  // Voice commands (stubs)
  is_voice_available: () => false,
  save_audio_temp: () => '/tmp/audio.wav',
  transcribe_audio: () => ({ text: '', durationMs: 0 }),

  // Usage tracking (stubs)
  record_usage: () => ({ id: '', workspaceId: '', taskId: null, sessionId: null, provider: '', model: '', inputTokens: 0, outputTokens: 0, costUsd: 0, createdAt: '' }),
  get_workspace_usage: () => [],
  get_task_usage: () => [],
  get_workspace_usage_summary: () => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, recordCount: 0 }),
  get_task_usage_summary: () => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, recordCount: 0 }),
  clear_workspace_usage: () => undefined,

  // Session history (stubs)
  create_snapshot: () => ({ id: '', sessionId: '', workspaceId: '', taskId: null, snapshotType: 'checkpoint', scrollbackSnapshot: null, commandHistory: '', filesModified: '', durationMs: 0, createdAt: '' }),
  get_snapshot: () => ({ id: '', sessionId: '', workspaceId: '', taskId: null, snapshotType: 'checkpoint', scrollbackSnapshot: null, commandHistory: '', filesModified: '', durationMs: 0, createdAt: '' }),
  get_session_history: () => [],
  get_workspace_history: () => [],
  get_task_history: () => [],
  clear_session_history: () => undefined,

  // Checklist commands (stubs)
  get_workspace_checklist: () => ({ checklist: null, categories: [], items: [] }),
  update_checklist_item: () => undefined,
  update_checklist_category: () => undefined,
  create_workspace_checklist: () => ({ id: 'mock-checklist', workspaceId: '', name: 'Mock Checklist', description: '', createdAt: '', updatedAt: '' }),
  delete_workspace_checklist: () => undefined,
  update_checklist_item_auto_detect: () => undefined,
  link_checklist_item_to_task: () => undefined,
}

// ─── Mock invoke function ───────────────────────────────────────────────────

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 10))

  const handler = mockCommands[cmd]
  if (handler) {
    return handler(args) as T
  }

  console.warn(`[Browser Mock] Unhandled command: ${cmd}`, args)
  throw new Error(`Unhandled mock command: ${cmd}`)
}

// ─── Mock listen function ───────────────────────────────────────────────────

type UnlistenFn = () => void

export function mockListen<T>(
  _event: string,
  _handler: (payload: T) => void
): Promise<UnlistenFn> {
  // In browser mode, events are not supported
  return Promise.resolve(() => {})
}

// ─── Reset mock data (for testing) ──────────────────────────────────────────

export function resetMockData() {
  mockWorkspaces = [
    {
      id: 'ws-demo',
      name: 'Demo Workspace',
      repoPath: '/tmp/demo-repo',
      tabOrder: 0,
      isActive: true,
      config: '{}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]

  mockColumns = [
    { id: 'col-1', workspaceId: 'ws-demo', name: 'Backlog', icon: 'inbox', position: 0, color: '', visible: true, trigger: defaultTrigger, exitCriteria: defaultExit, autoAdvance: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'col-2', workspaceId: 'ws-demo', name: 'Working', icon: 'code', position: 1, color: '', visible: true, trigger: defaultTrigger, exitCriteria: defaultExit, autoAdvance: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'col-3', workspaceId: 'ws-demo', name: 'Review', icon: 'eye', position: 2, color: '', visible: true, trigger: defaultTrigger, exitCriteria: defaultExit, autoAdvance: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'col-4', workspaceId: 'ws-demo', name: 'Done', icon: 'check', position: 3, color: '#4ADE80', visible: true, trigger: defaultTrigger, exitCriteria: defaultExit, autoAdvance: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ]

  mockTasks = [
    {
      id: 'task-1',
      workspaceId: 'ws-demo',
      columnId: 'col-1',
      title: 'Sample Task',
      description: 'This is a demo task for testing the new card UI with description preview',
      branch: 'feat/sample-task',
      agentType: 'claude',
      agentMode: null,
      agentStatus: null,
      pipelineState: 'idle',
      pipelineTriggeredAt: null,
      pipelineError: null,
      lastScriptExitCode: null,
      reviewStatus: null,
      prNumber: 42,
      prUrl: 'https://github.com/example/repo/pull/42',
      siegeIteration: 0,
      siegeActive: false,
      siegeMaxIterations: 5,
      siegeLastChecked: null,
      prMergeable: 'mergeable',
      prCiStatus: 'success',
      prReviewDecision: 'approved',
      prCommentCount: 3,
      prIsDraft: false,
      prLabels: '["enhancement", "ready-for-review"]',
      prLastFetched: new Date().toISOString(),
      prHeadSha: 'abc123',
      checklist: null,
      notifyStakeholders: null,
      notificationSentAt: null,
      position: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'task-2',
      workspaceId: 'ws-demo',
      columnId: 'col-2',
      title: 'Task with CI failure',
      description: 'This task has failing CI checks that need attention',
      branch: 'fix/ci-issues',
      agentType: 'codex',
      agentMode: null,
      agentStatus: 'running',
      pipelineState: 'running',
      pipelineTriggeredAt: new Date().toISOString(),
      pipelineError: null,
      lastScriptExitCode: null,
      reviewStatus: null,
      prNumber: 43,
      prUrl: 'https://github.com/example/repo/pull/43',
      siegeIteration: 0,
      siegeActive: false,
      siegeMaxIterations: 5,
      siegeLastChecked: null,
      prMergeable: 'conflicted',
      prCiStatus: 'failure',
      prReviewDecision: 'changes_requested',
      prCommentCount: 7,
      prIsDraft: false,
      prLabels: '["bug", "needs-work", "urgent"]',
      prLastFetched: new Date().toISOString(),
      prHeadSha: 'def456',
      checklist: null,
      notifyStakeholders: null,
      notificationSentAt: null,
      position: 0,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 1800000).toISOString(),
    },
    {
      id: 'task-3',
      workspaceId: 'ws-demo',
      columnId: 'col-1',
      title: 'Draft PR task',
      description: 'Work in progress - not ready for review yet',
      branch: 'wip/new-feature',
      agentType: null,
      agentMode: null,
      agentStatus: null,
      pipelineState: 'idle',
      pipelineTriggeredAt: null,
      pipelineError: null,
      lastScriptExitCode: null,
      reviewStatus: null,
      prNumber: 44,
      prUrl: 'https://github.com/example/repo/pull/44',
      siegeIteration: 0,
      siegeActive: false,
      siegeMaxIterations: 5,
      siegeLastChecked: null,
      prMergeable: 'unknown',
      prCiStatus: 'pending',
      prReviewDecision: null,
      prCommentCount: 0,
      prIsDraft: true,
      prLabels: '[]',
      prLastFetched: new Date().toISOString(),
      prHeadSha: 'ghi789',
      checklist: null,
      notifyStakeholders: null,
      notificationSentAt: null,
      position: 1,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 7200000).toISOString(),
    },
  ]

  idCounter = 100
}
