/**
 * Browser mock data for E2E testing and development without Tauri.
 * This module provides mock implementations of Tauri IPC commands.
 */

/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Mock data uses ?? for defensive safety with unknown runtime args */

import type { Workspace, Column, Task, Label, AgentMode, AgentStatus, PipelineState, Script } from '@/types'
import type { AgentTranscriptEvent, AgentTranscriptEventType } from '@/types/events'
import type { ModelsCache } from '@/lib/ipc/models'
import { DEFAULT_TRIGGERS } from '@/types/column'

// Check if we're running in Tauri or in a test environment
export const isTauri = (): boolean => {
  // In Vitest, we want to use the mocked @tauri-apps/api, not our browser mocks
  // Check for import.meta.env which Vite uses
  if (
    typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test'
  ) {
    return true // Let Vitest mocks handle it
  }
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// ─── Mock Data Store ────────────────────────────────────────────────────────

let mockWorkspaces: Workspace[] = [
  {
    id: 'ws-demo',
    name: 'Demo Workspace',
    repoPath: '/tmp/demo-repo',
    tabOrder: 0,
    isActive: true,
    activeTaskCount: 0,
    config: '{}',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

let mockColumns: Column[] = [
  {
    id: 'col-1',
    workspaceId: 'ws-demo',
    name: 'Backlog',
    icon: 'inbox',
    position: 0,
    color: '',
    visible: true,
    triggers: DEFAULT_TRIGGERS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'col-2',
    workspaceId: 'ws-demo',
    name: 'Working',
    icon: 'code',
    position: 1,
    color: '',
    visible: true,
    triggers: DEFAULT_TRIGGERS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'col-3',
    workspaceId: 'ws-demo',
    name: 'Review',
    icon: 'eye',
    position: 2,
    color: '',
    visible: true,
    triggers: DEFAULT_TRIGGERS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'col-4',
    workspaceId: 'ws-demo',
    name: 'Done',
    icon: 'check',
    position: 3,
    color: '#4ADE80',
    visible: true,
    triggers: DEFAULT_TRIGGERS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

let mockTasks: Task[] = [
  {
    id: 'task-1',
    workspaceId: 'ws-demo',
    columnId: 'col-2',
    title: 'Revamp agent panel UX',
    description: 'Demo task seeded for inspecting Transcript, Terminal, and Changes in the agent side panel.',
    branch: 'feat/agent-panel-refresh',
    agentType: 'codex',
    agentMode: 'managed',
    agentStatus: 'running',
    pipelineState: 'running',
    pipelineTriggeredAt: null,
    pipelineError: null,
    retryCount: 0,
    model: 'sonnet',
    lastScriptExitCode: null,
    reviewStatus: null,
    prNumber: 128,
    prUrl: 'https://github.com/example/bento-ya/pull/128',
    siegeIteration: 0,
    siegeActive: false,
    siegeMaxIterations: 5,
    siegeLastChecked: null,
    prMergeable: 'mergeable',
    prCiStatus: 'success',
    prReviewDecision: 'approved',
    prCommentCount: 4,
    prIsDraft: false,
    prLabels: '["ux", "agent-panel"]',
    labels: [],
    prLastFetched: new Date().toISOString(),
    prHeadSha: 'abc1234',
    checklist: null,
    estimatedHours: 3,
    actualHours: 2.25,
    notifyStakeholders: null,
    notificationSentAt: null,
    triggerOverrides: null,
    triggerPrompt: null,
    lastOutput: 'Demo agent is applying the panel refresh and collecting branch changes.',
    dependencies: null,
    blocked: false,
    worktreePath: null,
    archivedAt: null,
    lastUserInputAt: null,
    heldByUser: false,
    runtimeModeOverride: null,
    agentPausedAt: null,
    createdByTaskId: null,
    createdByAgentSessionId: null,
    recursionDepth: 0,
    queuedAt: null,
    position: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]

const sampleChangeSummary = {
  files: [
    { path: 'src/components/panel/agent-panel.tsx', status: 'modified', additions: 52, deletions: 12 },
    { path: 'src/components/review/diff-viewer.tsx', status: 'modified', additions: 118, deletions: 24 },
    { path: 'src/components/task-detail/diff-section.tsx', status: 'modified', additions: 26, deletions: 4 },
  ],
  totalAdditions: 196,
  totalDeletions: 40,
  totalFiles: 3,
}

const sampleDiffByPath: Record<string, string> = {
  'src/components/panel/agent-panel.tsx': [
    'diff --git a/src/components/panel/agent-panel.tsx b/src/components/panel/agent-panel.tsx',
    '@@ -18,7 +18,7 @@ type AgentPanelProps = {',
    "-type PanelView = 'transcript' | 'terminal'",
    "+type PanelView = 'transcript' | 'terminal' | 'changes'",
    '',
    '@@ -196,6 +196,13 @@ function HeadlessPanel({ task, onClose }: AgentPanelProps) {',
    '             >',
    '               Terminal',
    '             </ViewButton>',
    '+            <ViewButton',
    "+              active={activeView === 'changes'}",
    "+              onClick={() => { setActiveView('changes') }}",
    '+              testId="agent-panel-tab-changes"',
    '+            >',
    '+              Changes',
    '+            </ViewButton>',
  ].join('\n'),
  'src/components/review/diff-viewer.tsx': [
    'diff --git a/src/components/review/diff-viewer.tsx b/src/components/review/diff-viewer.tsx',
    '@@ -23,6 +23,14 @@ interface DiffFile {',
    '   hunks: DiffHunk[]',
    ' }',
    '',
    '+type LineSelection = {',
    '+  fileIndex: number',
    '+  hunkIndex: number',
    '+  lineIndex: number',
    '+}',
    '+',
    ' export interface DiffViewerProps {',
    '   diff: string',
    '+  selectable?: boolean',
    '+  onSendToAgent?: (content: string) => void',
  ].join('\n'),
  'src/components/task-detail/diff-section.tsx': [
    'diff --git a/src/components/task-detail/diff-section.tsx b/src/components/task-detail/diff-section.tsx',
    '@@ -10,6 +10,9 @@ type DiffSectionProps = {',
    '   diffByFile: Record<string, string>',
    '   loadDiff: (filePath: string | null) => Promise<string>',
    '+  compact?: boolean',
    '+  maxDiffHeight?: number | string',
    '+  onSendToAgent?: (content: string) => void',
    ' }',
  ].join('\n'),
}

const sampleCombinedDiff = Object.values(sampleDiffByPath).join('\n')

let mockLabels: Label[] = []
let mockScripts: Script[] = [
  {
    id: 'code-check',
    name: 'Code Check',
    description: 'Run type-check and linter',
    steps: '[{"type":"bash","name":"Type check","command":"npm run type-check"},{"type":"bash","name":"Lint","command":"npm run lint"}]',
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'run-tests',
    name: 'Run Tests',
    description: 'Run the test suite',
    steps: '[{"type":"bash","name":"Run tests","command":"npm test"}]',
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'ai-code-review',
    name: 'AI Code Review',
    description: 'Agent reviews the diff and suggests improvements',
    steps: '[{"type":"agent","name":"Review code","prompt":"Review the changes on this branch. Check for bugs, security issues, and code quality.","model":"sonnet"}]',
    isBuiltIn: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
]
const mockModelsCache: ModelsCache = {
  lastFetched: '',
  source: 'built-in',
  models: [
    {
      id: 'claude-opus-4-6-20260217',
      displayName: 'Claude Opus 4.6',
      provider: 'anthropic',
      alias: 'opus',
      tier: 'flagship',
      contextWindow: 200000,
      supportsExtendedContext: true,
      maxOutputTokens: 32000,
      inputCostPerM: 15,
      outputCostPerM: 75,
      capabilities: ['text', 'tools'],
      isNew: false,
      createdAt: null,
    },
    {
      id: 'claude-sonnet-4-6-20260217',
      displayName: 'Claude Sonnet 4.6',
      provider: 'anthropic',
      alias: 'sonnet',
      tier: 'standard',
      contextWindow: 200000,
      supportsExtendedContext: true,
      maxOutputTokens: 64000,
      inputCostPerM: 3,
      outputCostPerM: 15,
      capabilities: ['text', 'tools'],
      isNew: false,
      createdAt: null,
    },
    {
      id: 'claude-haiku-4-5-20251001',
      displayName: 'Claude Haiku 4.5',
      provider: 'anthropic',
      alias: 'haiku',
      tier: 'fast',
      contextWindow: 200000,
      supportsExtendedContext: false,
      maxOutputTokens: 8192,
      inputCostPerM: 1,
      outputCostPerM: 5,
      capabilities: ['text', 'tools'],
      isNew: false,
      createdAt: null,
    },
    {
      id: 'codex-5.3',
      displayName: 'Codex 5.3',
      provider: 'openai',
      alias: null,
      tier: 'flagship',
      contextWindow: 400000,
      supportsExtendedContext: true,
      maxOutputTokens: 128000,
      inputCostPerM: null,
      outputCostPerM: null,
      capabilities: ['text', 'code', 'tools'],
      isNew: false,
      createdAt: null,
    },
  ],
}
let mockTranscriptEvents: AgentTranscriptEvent[] = sampleTranscriptEvents('task-1')
const mockEventListeners = new Map<string, Set<(payload: unknown) => void>>()

let idCounter = 100

const generateId = (prefix: string) => `${prefix}-${String(++idCounter)}`

const sortMockLabels = (a: Label, b: Label) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

function transcriptEvent(
  taskId: string,
  eventType: AgentTranscriptEventType,
  sequence: number,
  overrides: Partial<AgentTranscriptEvent> = {},
): AgentTranscriptEvent {
  return {
    id: `${taskId}-${String(sequence)}-${eventType}`,
    taskId,
    sessionId: `${taskId}-session`,
    eventType,
    content: null,
    metadataJson: null,
    sequence,
    createdAt: new Date(Date.now() + sequence * 1000).toISOString(),
    ...overrides,
  }
}

function emitMockEvent(event: string, payload: unknown) {
  const listeners = mockEventListeners.get(event)
  if (!listeners) return
  for (const listener of [...listeners]) {
    queueMicrotask(() => { listener(payload) })
  }
}

function appendMockTranscriptEvent(event: AgentTranscriptEvent) {
  mockTranscriptEvents.push(event)
  emitMockEvent(`agent:${event.taskId}:transcript_event`, event)
}

function sampleTranscriptEvents(taskId: string): AgentTranscriptEvent[] {
  return [
    transcriptEvent(taskId, 'session_started', 1, {
      metadataJson: JSON.stringify({ cli: 'claude', workdir: '/tmp/demo-repo', columnName: 'Working' }),
    }),
    transcriptEvent(taskId, 'agent_thinking_delta', 2, { content: 'Checking the task context.' }),
    transcriptEvent(taskId, 'tool_started', 3, {
      metadataJson: JSON.stringify({ toolId: 'read-1', toolName: 'Read' }),
    }),
    transcriptEvent(taskId, 'tool_output', 4, {
      content: '# Sample Task\n\nThis is a demo task for testing.',
      metadataJson: JSON.stringify({ toolId: 'read-1', toolName: 'Read' }),
    }),
    transcriptEvent(taskId, 'tool_completed', 5, {
      metadataJson: JSON.stringify({ toolId: 'read-1', toolName: 'Read' }),
    }),
    transcriptEvent(taskId, 'agent_text_delta', 6, {
      content: 'I found the sample task and would start by confirming the expected output before editing.',
    }),
    transcriptEvent(taskId, 'command_started', 7, {
      metadataJson: JSON.stringify({ commandId: 'bash-1', command: 'bash' }),
    }),
    transcriptEvent(taskId, 'command_output', 8, {
      content: 'git status --short\n# clean',
      metadataJson: JSON.stringify({ commandId: 'bash-1', command: 'bash' }),
    }),
    transcriptEvent(taskId, 'command_completed', 9, {
      metadataJson: JSON.stringify({ commandId: 'bash-1', command: 'bash', exitCode: 0 }),
    }),
    transcriptEvent(taskId, 'agent_completed', 10, {
      metadataJson: JSON.stringify({ exitCode: 0 }),
    }),
  ]
}

const getLastColumnId = (workspaceId: string) => {
  const columns = mockColumns
    .filter((column) => column.workspaceId === workspaceId)
    .sort((a, b) => a.position - b.position)

  return columns.length > 0 ? (columns[columns.length - 1]?.id ?? null) : null
}

const getActiveTaskCount = (workspaceId: string) => {
  const lastColumnId = getLastColumnId(workspaceId)
  if (!lastColumnId) return 0

  return mockTasks.filter(
    (task) => task.workspaceId === workspaceId && task.columnId !== lastColumnId,
  ).length
}

const withActiveTaskCount = (workspace: Workspace): Workspace => ({
  ...workspace,
  activeTaskCount: getActiveTaskCount(workspace.id),
})

// ─── Mock Command Handlers ──────────────────────────────────────────────────

type CommandHandler = (args?: Record<string, unknown>) => unknown

const mockCommands: Record<string, CommandHandler> = {
  // Workspace commands
  list_workspaces: () => mockWorkspaces.map(withActiveTaskCount),
  get_workspace: (args) => {
    const workspace = mockWorkspaces.find((w) => w.id === args?.id)
    return workspace ? withActiveTaskCount(workspace) : undefined
  },
  create_workspace: (args) => {
    const ws: Workspace = {
      id: generateId('ws'),
      name: (args?.name as string) || 'New Workspace',
      repoPath: (args?.repoPath as string) || '/tmp/repo',
      tabOrder: mockWorkspaces.length,
      isActive: false,
      activeTaskCount: 0,
      config: args?.defaultAgentCli
        ? JSON.stringify({ defaultAgentCli: args.defaultAgentCli })
        : '{}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockWorkspaces.push(ws)
    return withActiveTaskCount(ws)
  },
  update_workspace: (args) => {
    const existing = mockWorkspaces.find((w) => w.id === args?.id)
    if (existing) {
      existing.name = (args?.name as string) ?? existing.name
      existing.repoPath = (args?.repoPath as string) ?? existing.repoPath
      existing.tabOrder = (args?.tabOrder as number) ?? existing.tabOrder
      existing.isActive = (args?.isActive as boolean) ?? existing.isActive
      existing.config = (args?.config as string) ?? existing.config
      existing.updatedAt = new Date().toISOString()
      return withActiveTaskCount(existing)
    }
    throw new Error('Workspace not found')
  },
  delete_workspace: (args) => {
    mockWorkspaces = mockWorkspaces.filter((w) => w.id !== args?.id)
    mockColumns = mockColumns.filter((c) => c.workspaceId !== args?.id)
    mockTasks = mockTasks.filter((t) => t.workspaceId !== args?.id)
    mockLabels = mockLabels.filter((label) => label.workspaceId !== args?.id)
  },
  reorder_workspaces: (args) => {
    const ids = args?.ids as string[]
    ids.forEach((id, idx) => {
      const ws = mockWorkspaces.find((w) => w.id === id)
      if (ws) ws.tabOrder = idx
    })
  },
  scan_workspace_files: () => [],
  read_file_content: () => '# Mock file\n\nBrowser mock mode does not read local files.',
  create_note_file: (args) => {
    const name = typeof args?.filename === 'string' ? args.filename : 'note.md'
    return {
      path: `/tmp/demo-repo/${name}`,
      name,
      category: 'notes',
      modifiedAt: Date.now(),
    }
  },
  pick_attachment_files: () => [],

  // Column commands
  list_columns: (args) => mockColumns.filter((c) => c.workspaceId === args?.workspaceId),
  create_column: (args) => {
    const col: Column = {
      id: generateId('col'),
      workspaceId: args?.workspaceId as string,
      name: (args?.name as string) || 'New Column',
      icon: 'list',
      position: (args?.position as number) || mockColumns.length,
      color: '',
      visible: true,
      triggers: DEFAULT_TRIGGERS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockColumns.push(col)
    return col
  },
  update_column: (args) => {
    const existing = mockColumns.find((c) => c.id === args?.id)
    if (existing) {
      existing.name = (args?.name as string) ?? existing.name
      existing.icon = (args?.icon as string) ?? existing.icon
      existing.position = (args?.position as number) ?? existing.position
      existing.color = (args?.color as string) ?? existing.color
      existing.visible = (args?.visible as boolean) ?? existing.visible
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      if (args?.triggers) existing.triggers = JSON.parse(args.triggers as string)
      existing.updatedAt = new Date().toISOString()
      return existing
    }
    throw new Error('Column not found')
  },
  delete_column: (args) => {
    mockColumns = mockColumns.filter((c) => c.id !== args?.id)
    mockTasks = mockTasks.filter((t) => t.columnId !== args?.id)
  },
  reorder_columns: (args) => {
    const columnIds = args?.columnIds as string[]
    columnIds.forEach((id, idx) => {
      const col = mockColumns.find((c) => c.id === id)
      if (col) col.position = idx
    })
    return mockColumns.filter((c) => c.workspaceId === args?.workspaceId)
  },

  // Task commands
  list_tasks: (args) => mockTasks.filter((t) => t.workspaceId === args?.workspaceId),
  get_task: (args) => mockTasks.find((t) => t.id === args?.id),
  create_task: (args) => {
    const task: Task = {
      id: generateId('task'),
      workspaceId: args?.workspaceId as string,
      columnId: args?.columnId as string,
      title: (args?.title as string) || 'New Task',
      description: (args?.description as string) || '',
      branch: null,
      agentType: null,
      agentMode: null,
      agentStatus: null,
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
      lastUserInputAt: null,
      heldByUser: false,
      runtimeModeOverride: null,
      agentPausedAt: null,
      createdByTaskId: null,
      createdByAgentSessionId: null,
      recursionDepth: 0,
      queuedAt: null,
      position: mockTasks.filter((t) => t.columnId === args?.columnId).length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockTasks.push(task)
    return task
  },
  update_task: (args) => {
    const existing = mockTasks.find((t) => t.id === args?.id)
    if (existing) {
      existing.title = (args?.title as string) ?? existing.title
      existing.description = (args?.description as string) ?? existing.description
      existing.columnId = (args?.columnId as string) ?? existing.columnId
      existing.branch = (args?.branch as string | null) ?? existing.branch
      existing.agentType = (args?.agentType as string | null) ?? existing.agentType
      existing.agentMode = (args?.agentMode as AgentMode | null) ?? existing.agentMode
      existing.agentStatus = (args?.agentStatus as AgentStatus | null) ?? existing.agentStatus
      existing.pipelineState = (args?.pipelineState as PipelineState) ?? existing.pipelineState
      existing.pipelineTriggeredAt =
        (args?.pipelineTriggeredAt as string | null) ?? existing.pipelineTriggeredAt
      existing.pipelineError = (args?.pipelineError as string | null) ?? existing.pipelineError
      if (Object.prototype.hasOwnProperty.call(args ?? {}, 'estimatedHours')) {
        existing.estimatedHours = args?.estimatedHours as number | null
      }
      existing.actualHours = (args?.actualHours as number) ?? existing.actualHours
      existing.position = (args?.position as number) ?? existing.position
      existing.updatedAt = new Date().toISOString()
      return existing
    }
    throw new Error('Task not found')
  },
  move_task: (args) => {
    const task = mockTasks.find((t) => t.id === args?.id)
    if (task) {
      task.columnId = args?.targetColumnId as string
      task.position = args?.position as number
      task.updatedAt = new Date().toISOString()
      return task
    }
    throw new Error('Task not found')
  },
  delete_task: (args) => {
    mockTasks = mockTasks.filter((t) => t.id !== args?.id)
  },
  archive_task: (args) => {
    const task = mockTasks.find((t) => t.id === args?.id)
    if (task) {
      task.archivedAt = new Date().toISOString()
      task.updatedAt = new Date().toISOString()
      return task
    }
    throw new Error('Task not found')
  },
  unarchive_task: (args) => {
    const task = mockTasks.find((t) => t.id === args?.id)
    if (task) {
      task.archivedAt = null
      task.updatedAt = new Date().toISOString()
      return task
    }
    throw new Error('Task not found')
  },
  reorder_tasks: (args) => {
    const taskIds = args?.taskIds as string[]
    taskIds.forEach((id, idx) => {
      const task = mockTasks.find((t) => t.id === id)
      if (task) task.position = idx
    })
    return mockTasks.filter((t) => t.columnId === args?.columnId)
  },

  // Label commands
  list_labels: (args) => {
    return mockLabels
      .filter((label) => label.workspaceId === args?.workspaceId)
      .sort(sortMockLabels)
  },
  create_label: (args) => {
    const label: Label = {
      id: generateId('label'),
      workspaceId: args?.workspaceId as string,
      name: ((args?.name as string) || 'New label').trim(),
      color: ((args?.color as string | undefined) || '#64748b').toLowerCase(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockLabels.push(label)
    mockLabels.sort(sortMockLabels)
    return label
  },
  update_label: (args) => {
    const label = mockLabels.find((current) => current.id === args?.id)
    if (!label) throw new Error('Label not found')
    label.name = ((args?.name as string | undefined) ?? label.name).trim()
    label.color = ((args?.color as string | undefined) ?? label.color).toLowerCase()
    label.updatedAt = new Date().toISOString()
    mockLabels.sort(sortMockLabels)
    return label
  },
  delete_label: (args) => {
    const id = args?.id as string
    mockLabels = mockLabels.filter((label) => label.id !== id)
    mockTasks = mockTasks.map((task) => ({
      ...task,
      labels: (task.labels ?? []).filter((label) => label.id !== id),
    }))
  },
  set_task_labels: (args) => {
    const task = mockTasks.find((current) => current.id === args?.taskId)
    if (!task) throw new Error('Task not found')
    const labelIds = new Set(args?.labelIds as string[])
    task.labels = mockLabels.filter(
      (label) => label.workspaceId === task.workspaceId && labelIds.has(label.id),
    )
    task.updatedAt = new Date().toISOString()
    return task
  },

  // Settings
  get_settings: () => ({ theme: 'dark', defaultTemplate: 'standard' }),
  update_settings: () => undefined,
  get_available_models: (args) => {
    const provider = typeof args?.provider === 'string' ? args.provider : null
    return {
      ...mockModelsCache,
      models: provider
        ? mockModelsCache.models.filter((model) => model.provider === provider)
        : mockModelsCache.models,
    }
  },
  refresh_models: () => {
    const refreshed = {
      ...mockModelsCache,
      lastFetched: new Date().toISOString(),
      source: 'built-in',
    } satisfies ModelsCache
    emitMockEvent('models:updated', refreshed)
    return refreshed
  },
  get_update_status: () => ({
    configured: false,
    reason: 'Application updates are not configured in browser mock mode.',
    endpointCount: 0,
    artifactsEnabled: false,
  }),
  check_for_update: () => null,
  install_update: () => {
    throw new Error('Application updates are not available in browser mock mode.')
  },

  // PR creation (stub)
  create_pr: (args) => {
    const task = mockTasks.find((t) => t.id === args?.taskId)
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
    const task = mockTasks.find((t) => t.id === args?.id)
    if (task) {
      task.notifyStakeholders = (args?.stakeholders as string | null) ?? null
      task.updatedAt = new Date().toISOString()
      return task
    }
    throw new Error('Task not found')
  },
  mark_task_notification_sent: (args) => {
    const task = mockTasks.find((t) => t.id === args?.id)
    if (task) {
      task.notificationSentAt = new Date().toISOString()
      task.updatedAt = new Date().toISOString()
      return task
    }
    throw new Error('Task not found')
  },
  clear_task_notification_sent: (args) => {
    const task = mockTasks.find((t) => t.id === args?.id)
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
  get_changes: () => sampleChangeSummary,
  get_diff: (args) => {
    const filePath = args?.filePath as string | undefined
    return filePath ? (sampleDiffByPath[filePath] ?? '') : sampleCombinedDiff
  },
  get_commits: () => [
    {
      hash: 'abc1234def5678',
      shortHash: 'abc1234',
      message: 'Add panel-friendly changes view',
      author: 'Demo Agent',
      timestamp: Math.floor((Date.now() - 60 * 60 * 1000) / 1000),
    },
  ],
  get_conflict_matrix: () => ({ conflicts: [], hasConflicts: false }),

  // Agent commands (stubs)
  start_agent: () => ({ taskId: '', agentType: '', status: 'idle', pid: null, workingDir: '' }),
  stop_agent: () => undefined,
  get_agent_status: () => ({
    taskId: '',
    agentType: '',
    status: 'idle',
    pid: null,
    workingDir: '',
  }),

  // Agent message commands
  save_agent_message: (args) => ({
    id: `msg-${String(Date.now())}`,
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
  get_agent_transcript_events: (args) =>
    mockTranscriptEvents.filter((event) => event.taskId === args?.taskId),
  send_task_input: (args) => {
    const taskId = args?.taskId as string
    const nextSequence = mockTranscriptEvents.filter((event) => event.taskId === taskId).length + 1
    appendMockTranscriptEvent(
      transcriptEvent(taskId, 'user_input', nextSequence, {
        content: (args?.text as string) ?? '',
        metadataJson: JSON.stringify({ source: args?.source ?? 'chat', delivery: 'new_turn' }),
      }),
    )
    const task = mockTasks.find((item) => item.id === taskId)
    if (task) {
      task.agentStatus = 'running'
      task.updatedAt = new Date().toISOString()
    }

    const runSequence = nextSequence + 1
    globalThis.setTimeout(() => {
      appendMockTranscriptEvent(
        transcriptEvent(taskId, 'session_started', runSequence, {
          metadataJson: JSON.stringify({
            cli: args?.cliPath ?? 'claude',
            model: args?.model ?? 'sonnet',
            workdir: args?.workingDir ?? '/tmp/demo-repo',
            resumeAvailable: true,
            runtimeMode: 'managed',
          }),
        }),
      )
      appendMockTranscriptEvent(
        transcriptEvent(taskId, 'agent_text_delta', runSequence + 1, {
          content: `Received: ${(args?.text as string) ?? ''}`,
        }),
      )
      appendMockTranscriptEvent(
        transcriptEvent(taskId, 'agent_completed', runSequence + 2, {
          metadataJson: JSON.stringify({ exitCode: 0 }),
        }),
      )
      if (task) {
        task.agentStatus = 'completed'
        task.updatedAt = new Date().toISOString()
      }
      emitMockEvent('agent:complete', { taskId, success: true })
    }, 150)
  },
  cancel_agent_chat: () => undefined,
  clear_agent_messages: () => undefined,
  hold_task: (args) => {
    const task = mockTasks.find((t) => t.id === args?.taskId)
    if (!task) throw new Error('Task not found')
    task.heldByUser = Boolean(args?.held)
    task.updatedAt = new Date().toISOString()
    return task
  },
  kill_task_session: () => undefined,

  // Terminal PTY commands (stubs)
  ensure_pty_session: (args) => ({
    taskId: args?.taskId,
    pid: 123,
    status: 'idle',
    scrollback: btoa('mock-terminal$ echo ready\r\nready\r\nmock-terminal$ '),
  }),
  write_to_pty: () => undefined,
  resize_pty: () => undefined,
  get_pty_scrollback: () => '',
  signal_pty_interrupt: () => undefined,

  // Pipeline commands (stubs)
  mark_pipeline_complete: (args) => mockTasks.find((t) => t.id === args?.taskId),
  get_pipeline_state: () => 'idle',
  try_advance_task: () => null,
  set_pipeline_error: (args) => mockTasks.find((t) => t.id === args?.taskId),

  // Orchestrator commands (stubs)
  get_orchestrator_context: () => ({
    workspaceId: '',
    workspaceName: '',
    columns: [],
    tasks: [],
    recentMessages: [],
  }),
  get_orchestrator_session: () => ({
    id: '',
    workspaceId: '',
    status: 'idle',
    lastError: null,
    createdAt: '',
    updatedAt: '',
  }),
  send_orchestrator_message: () => ({
    id: '',
    workspaceId: '',
    sessionId: null,
    role: 'user',
    content: '',
    createdAt: '',
  }),
  list_chat_sessions: () => [],
  get_active_chat_session: () => ({
    id: 'mock-session',
    workspaceId: '',
    title: 'New Chat',
    createdAt: '',
    updatedAt: '',
  }),
  create_chat_session: () => ({
    id: 'mock-session',
    workspaceId: '',
    title: 'New Chat',
    createdAt: '',
    updatedAt: '',
  }),
  delete_chat_session: () => undefined,
  get_chat_history: () => [],
  clear_chat_history: () => undefined,
  process_orchestrator_response: () => ({ message: '', actions: [], tasksCreated: [] }),
  set_orchestrator_error: () => ({
    id: '',
    workspaceId: '',
    status: 'error',
    lastError: '',
    createdAt: '',
    updatedAt: '',
  }),
  stream_orchestrator_chat: () => {
    console.warn('[Browser Mock] stream_orchestrator_chat not available in browser mode')
    return undefined
  },

  // Voice commands (stubs)
  is_voice_available: () => false,
  save_audio_temp: () => '/tmp/audio.wav',
  transcribe_audio: () => ({ text: '', durationMs: 0 }),

  // Usage tracking (stubs)
  record_usage: () => ({
    id: '',
    workspaceId: '',
    taskId: null,
    sessionId: null,
    provider: '',
    model: '',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    createdAt: '',
  }),
  get_workspace_usage: () => [],
  get_task_usage: () => [],
  get_workspace_usage_summary: () => ({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    recordCount: 0,
  }),
  get_workspace_model_usage_between: () => [],
  get_workspace_daily_costs: () => [],
  get_workspace_column_costs: () => [],
  get_workspace_task_costs: () => [],
  get_task_usage_summary: () => ({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    recordCount: 0,
  }),
  clear_workspace_usage: () => undefined,

  // Script commands
  list_scripts: () => [...mockScripts].sort((a, b) => Number(b.isBuiltIn) - Number(a.isBuiltIn) || a.name.localeCompare(b.name)),
  get_script: (args) => {
    const script = mockScripts.find((s) => s.id === args?.id)
    if (!script) throw new Error('Script not found')
    return script
  },
  create_script: (args) => {
    const now = new Date().toISOString()
    const script: Script = {
      id: generateId('script'),
      name: (args?.name as string) || 'New Script',
      description: (args?.description as string) || '',
      steps: (args?.steps as string) || '[]',
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    }
    mockScripts.push(script)
    return script
  },
  update_script: (args) => {
    const script = mockScripts.find((s) => s.id === args?.id)
    if (!script) throw new Error('Script not found')
    if (script.isBuiltIn) throw new Error('Cannot modify built-in scripts')
    script.name = (args?.name as string) ?? script.name
    script.description = (args?.description as string) ?? script.description
    script.steps = (args?.steps as string) ?? script.steps
    script.updatedAt = new Date().toISOString()
    return script
  },
  delete_script: (args) => {
    const script = mockScripts.find((s) => s.id === args?.id)
    if (script?.isBuiltIn) throw new Error('Cannot delete built-in scripts')
    mockScripts = mockScripts.filter((s) => s.id !== args?.id)
  },

  // Session history (stubs)
  create_snapshot: () => ({
    id: '',
    sessionId: '',
    workspaceId: '',
    taskId: null,
    snapshotType: 'checkpoint',
    scrollbackSnapshot: null,
    commandHistory: '',
    filesModified: '',
    durationMs: 0,
    createdAt: '',
  }),
  get_snapshot: () => ({
    id: '',
    sessionId: '',
    workspaceId: '',
    taskId: null,
    snapshotType: 'checkpoint',
    scrollbackSnapshot: null,
    commandHistory: '',
    filesModified: '',
    durationMs: 0,
    createdAt: '',
  }),
  get_session_history: () => [],
  get_workspace_history: () => [],
  get_task_history: () => [],
  clear_session_history: () => undefined,

  // Checklist commands (stubs)
  create_checklist: () => ({
    id: 'mock-checklist',
    workspaceId: '',
    name: 'Mock Checklist',
    description: null,
    progress: 0,
    totalItems: 0,
    createdAt: '',
    updatedAt: '',
  }),
  update_checklist: () => ({
    id: 'mock-checklist',
    workspaceId: '',
    name: 'Mock Checklist',
    description: null,
    progress: 0,
    totalItems: 0,
    createdAt: '',
    updatedAt: '',
  }),
  delete_checklist: () => undefined,
  get_workspace_checklist: () => ({ checklist: null, categories: [], items: {} }),
  create_checklist_category: () => ({
    id: 'mock-category',
    checklistId: 'mock-checklist',
    name: 'Mock Category',
    icon: '📋',
    position: 0,
    progress: 0,
    totalItems: 0,
    collapsed: false,
  }),
  update_checklist_item: () => ({
    id: 'mock-item',
    categoryId: 'mock-category',
    text: 'Mock item',
    checked: false,
    notes: null,
    position: 0,
    detectType: null,
    detectConfig: null,
    autoDetected: false,
    linkedTaskId: null,
    createdAt: '',
    updatedAt: '',
  }),
  update_checklist_category: () => ({
    id: 'mock-category',
    checklistId: 'mock-checklist',
    name: 'Mock Category',
    icon: '📋',
    position: 0,
    progress: 0,
    totalItems: 0,
    collapsed: false,
  }),
  delete_checklist_category: () => undefined,
  create_checklist_item: () => ({
    id: 'mock-item',
    categoryId: 'mock-category',
    text: 'Mock item',
    checked: false,
    notes: null,
    position: 0,
    detectType: null,
    detectConfig: null,
    autoDetected: false,
    linkedTaskId: null,
    createdAt: '',
    updatedAt: '',
  }),
  delete_checklist_item: () => undefined,
  create_workspace_checklist: () => ({
    checklist: null,
    categories: [],
    items: {},
  }),
  delete_workspace_checklist: () => undefined,
  update_checklist_item_auto_detect: () => undefined,
  link_checklist_item_to_task: () => undefined,

  // CLI detection / capabilities (stubs)
  detect_clis: () => [{
    id: 'claude',
    name: 'Claude Code',
    path: '/usr/local/bin/claude',
    version: 'mock',
    isAvailable: true,
  }],
  detect_single_cli: () => ({
    id: 'claude',
    name: 'Claude Code',
    path: '/usr/local/bin/claude',
    version: 'mock',
    isAvailable: true,
  }),
  verify_cli_path: () => ({
    id: 'custom',
    name: 'Custom CLI',
    path: '',
    version: null,
    isAvailable: false,
  }),
  check_runtime_prerequisites: () => [
    {
      id: 'git',
      name: 'Git',
      required: true,
      available: true,
      version: 'git version mock',
      installHint: 'Install Git from https://git-scm.com/downloads or your OS package manager.',
    },
    {
      id: 'tmux',
      name: 'tmux',
      required: true,
      available: true,
      version: 'tmux mock',
      installHint: 'Install tmux with Homebrew on macOS or your Linux package manager.',
    },
    {
      id: 'gh',
      name: 'GitHub CLI',
      required: false,
      available: false,
      version: null,
      installHint: 'Install GitHub CLI from https://cli.github.com/ for PR automation.',
    },
  ],
  get_cli_capabilities: () => ({
    cliId: 'claude',
    cliVersion: 'mock',
    detected: true,
    models: [
      {
        id: 'opus',
        name: 'Opus',
        description: 'Most powerful',
        supportsExtendedContext: true,
        contextWindow: '200k',
        maxEffort: 'high',
        available: true,
      },
      {
        id: 'sonnet',
        name: 'Sonnet',
        description: 'Fast & capable',
        supportsExtendedContext: false,
        contextWindow: '200k',
        maxEffort: 'high',
        available: true,
      },
      {
        id: 'haiku',
        name: 'Haiku',
        description: 'Quick & light',
        supportsExtendedContext: false,
        contextWindow: '200k',
        maxEffort: 'low',
        available: true,
      },
    ],
  }),
}

// ─── Mock invoke function ───────────────────────────────────────────────────

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 10))

  const handler = mockCommands[cmd]
  if (handler) {
    return handler(args) as T
  }

  console.warn(`[Browser Mock] Unhandled command: ${cmd}`, args)
  throw new Error(`Unhandled mock command: ${cmd}`)
}

// ─── Mock listen function ───────────────────────────────────────────────────

type UnlistenFn = () => void

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Mock signature mirrors typed Tauri listen.
export function mockListen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  const listeners = mockEventListeners.get(event) ?? new Set<(payload: unknown) => void>()
  const wrapped = (payload: unknown) => { handler(payload as T) }
  listeners.add(wrapped)
  mockEventListeners.set(event, listeners)
  return Promise.resolve(() => {
    listeners.delete(wrapped)
    if (listeners.size === 0) mockEventListeners.delete(event)
  })
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
      activeTaskCount: 0,
      config: '{}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]

  mockColumns = [
    {
      id: 'col-1',
      workspaceId: 'ws-demo',
      name: 'Backlog',
      icon: 'inbox',
      position: 0,
      color: '',
      visible: true,
      triggers: DEFAULT_TRIGGERS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'col-2',
      workspaceId: 'ws-demo',
      name: 'Working',
      icon: 'code',
      position: 1,
      color: '',
      visible: true,
      triggers: DEFAULT_TRIGGERS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'col-3',
      workspaceId: 'ws-demo',
      name: 'Review',
      icon: 'eye',
      position: 2,
      color: '',
      visible: true,
      triggers: DEFAULT_TRIGGERS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'col-4',
      workspaceId: 'ws-demo',
      name: 'Done',
      icon: 'check',
      position: 3,
      color: '#4ADE80',
      visible: true,
      triggers: DEFAULT_TRIGGERS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
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
      retryCount: 0,
      model: null,
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
      labels: [],
      prLastFetched: new Date().toISOString(),
      prHeadSha: 'abc123',
      checklist: null,
      estimatedHours: 2,
      actualHours: 1.25,
      notifyStakeholders: null,
      notificationSentAt: null,
      triggerOverrides: null,
      triggerPrompt: null,
      lastOutput: null,
      dependencies: null,
      blocked: false,
      worktreePath: null,
      archivedAt: null,
      lastUserInputAt: null,
      heldByUser: false,
      runtimeModeOverride: null,
      agentPausedAt: null,
      createdByTaskId: null,
      createdByAgentSessionId: null,
      recursionDepth: 0,
      queuedAt: null,
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
      retryCount: 0,
      model: null,
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
      labels: [],
      prLastFetched: new Date().toISOString(),
      prHeadSha: 'def456',
      checklist: null,
      estimatedHours: 1,
      actualHours: 2.5,
      notifyStakeholders: null,
      notificationSentAt: null,
      triggerOverrides: null,
      triggerPrompt: null,
      lastOutput: null,
      dependencies: null,
      blocked: false,
      worktreePath: null,
      archivedAt: null,
      lastUserInputAt: null,
      heldByUser: false,
      runtimeModeOverride: null,
      agentPausedAt: null,
      createdByTaskId: null,
      createdByAgentSessionId: null,
      recursionDepth: 0,
      queuedAt: null,
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
      retryCount: 0,
      model: null,
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
      labels: [],
      prLastFetched: new Date().toISOString(),
      prHeadSha: 'ghi789',
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
      lastUserInputAt: null,
      heldByUser: false,
      runtimeModeOverride: null,
      agentPausedAt: null,
      createdByTaskId: null,
      createdByAgentSessionId: null,
      recursionDepth: 0,
      queuedAt: null,
      position: 1,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 7200000).toISOString(),
    },
  ]

  mockLabels = []
  mockTranscriptEvents = sampleTranscriptEvents('task-1')
  idCounter = 100
}
