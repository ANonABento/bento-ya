// Typed invoke() and listen() wrappers for Tauri IPC.
// Provides type-safe communication between React frontend and Rust backend.
// Falls back to browser mocks when Tauri is not available (E2E testing).

import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri, mockInvoke, mockListen } from './browser-mock'
import type { Workspace, Column, Task } from '@/types'
import type { AppError } from '../types/events'

// ─── Typed invoke wrapper ──────────────────────────────────────────────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    return tauriInvoke<T>(cmd, args)
  }
  // Browser mode - use mocks
  return mockInvoke<T>(cmd, args)
}

// ─── Typed listen wrapper ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T propagates to tauriListen
function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (isTauri()) {
    return tauriListen<T>(event, (e) => { handler(e.payload); })
  }
  // Browser mode - events not supported
  return mockListen<T>(event, handler)
}

// ─── Workspace commands ────────────────────────────────────────────────────

export const getWorkspaces = () => invoke<Workspace[]>('list_workspaces')

export async function createWorkspace(name: string, repoPath: string): Promise<Workspace> {
  return invoke<Workspace>('create_workspace', { name, repoPath })
}

export async function getWorkspace(id: string): Promise<Workspace> {
  return invoke<Workspace>('get_workspace', { id })
}

export async function updateWorkspace(
  id: string,
  updates: Partial<Workspace>,
): Promise<Workspace> {
  return invoke<Workspace>('update_workspace', { id, ...updates })
}

export async function deleteWorkspace(id: string): Promise<void> {
  return invoke('delete_workspace', { id })
}

export async function cloneWorkspace(sourceId: string, newName: string): Promise<Workspace> {
  return invoke<Workspace>('clone_workspace', { sourceId, newName })
}

export const reorderWorkspaces = (ids: string[]) =>
  invoke('reorder_workspaces', { ids })

export async function updateWorkspaceConfig(
  id: string,
  config: string,
): Promise<Workspace> {
  return invoke<Workspace>('update_workspace', { id, config })
}

export const seedDemoData = (repoPath: string) =>
  invoke<Workspace>('seed_demo_data', { repoPath })

// ─── Column commands ───────────────────────────────────────────────────────

export const getColumns = (workspaceId: string) =>
  invoke<Column[]>('list_columns', { workspaceId })

export async function createColumn(
  workspaceId: string,
  name: string,
  position: number,
): Promise<Column> {
  return invoke<Column>('create_column', { workspaceId, name, position })
}

export async function updateColumn(
  id: string,
  updates: {
    name?: string
    icon?: string
    position?: number
    color?: string | null
    visible?: boolean
    // New unified triggers format
    triggers?: string
    // Legacy (for backward compatibility)
    triggerConfig?: string
    exitConfig?: string
    autoAdvance?: boolean
  },
): Promise<Column> {
  // Map frontend field names to Rust snake_case
  return invoke<Column>('update_column', {
    id,
    name: updates.name,
    icon: updates.icon,
    position: updates.position,
    color: updates.color,
    visible: updates.visible,
    triggers: updates.triggers,
    trigger_config: updates.triggerConfig,
    exit_config: updates.exitConfig,
    auto_advance: updates.autoAdvance,
  })
}

export async function reorderColumns(
  workspaceId: string,
  columnIds: string[],
): Promise<Column[]> {
  return invoke<Column[]>('reorder_columns', { workspaceId, columnIds })
}

export async function deleteColumn(id: string): Promise<void> {
  return invoke('delete_column', { id })
}

// ─── Task commands ─────────────────────────────────────────────────────────

export const getTasks = (workspaceId: string) =>
  invoke<Task[]>('list_tasks', { workspaceId })

export async function createTask(
  workspaceId: string,
  columnId: string,
  title: string,
  description?: string,
): Promise<Task> {
  return invoke<Task>('create_task', { workspaceId, columnId, title, description })
}

export async function getTask(id: string): Promise<Task> {
  return invoke<Task>('get_task', { id })
}

export async function updateTask(
  id: string,
  updates: Partial<Task>,
): Promise<Task> {
  return invoke<Task>('update_task', { id, ...updates })
}

export async function updateTaskTriggers(
  id: string,
  updates: {
    triggerOverrides?: string
    triggerPrompt?: string | null
    dependencies?: string
    blocked?: boolean
  },
): Promise<Task> {
  return invoke<Task>('update_task_triggers', { id, ...updates })
}

export async function moveTask(
  id: string,
  targetColumnId: string,
  position: number,
): Promise<Task> {
  return invoke<Task>('move_task', { id, targetColumnId, position })
}

export async function reorderTasks(columnId: string, taskIds: string[]): Promise<Task[]> {
  return invoke<Task[]>('reorder_tasks', { columnId, taskIds })
}

export async function deleteTask(id: string): Promise<void> {
  return invoke('delete_task', { id })
}

// ─── Review actions ─────────────────────────────────────────────────────────

export async function approveTask(id: string): Promise<Task> {
  return invoke<Task>('approve_task', { id })
}

export async function rejectTask(id: string, reason?: string): Promise<Task> {
  return invoke<Task>('reject_task', { id, reason })
}

// ─── Notification ────────────────────────────────────────────────────────────

export async function updateTaskStakeholders(
  id: string,
  stakeholders: string | null,
): Promise<Task> {
  return invoke<Task>('update_task_stakeholders', { id, stakeholders })
}

export async function markTaskNotificationSent(id: string): Promise<Task> {
  return invoke<Task>('mark_task_notification_sent', { id })
}

export async function clearTaskNotificationSent(id: string): Promise<Task> {
  return invoke<Task>('clear_task_notification_sent', { id })
}

// ─── Test Checklist Generation ───────────────────────────────────────────────

export type GeneratedTestItem = {
  text: string
}

export type GenerateTestChecklistResult = {
  items: GeneratedTestItem[]
  diffSummary: string
}

export async function generateTestChecklist(
  taskId: string,
  repoPath: string,
  cliPath?: string,
): Promise<GenerateTestChecklistResult> {
  return invoke<GenerateTestChecklistResult>('generate_test_checklist', {
    taskId,
    repoPath,
    cliPath,
  })
}

// ─── PR creation ─────────────────────────────────────────────────────────────

import type { CreatePrResult } from '@/types/task'

export async function createPr(
  taskId: string,
  repoPath: string,
  baseBranch?: string,
): Promise<CreatePrResult> {
  return invoke<CreatePrResult>('create_pr', { taskId, repoPath, baseBranch })
}

// ─── Git commands ─────────────────────────────────────────────────────────

export async function createTaskBranch(
  repoPath: string,
  taskSlug: string,
  baseBranch?: string,
): Promise<string> {
  return invoke<string>('create_task_branch', { repoPath, taskSlug, baseBranch })
}

export async function switchBranch(repoPath: string, branch: string): Promise<void> {
  return invoke('switch_branch', { repoPath, branch })
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  return invoke<string>('get_current_branch', { repoPath })
}

export type BranchInfo = {
  name: string
  isHead: boolean
  upstream: string | null
}

export async function listTaskBranches(repoPath: string): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>('list_task_branches', { repoPath })
}

export async function deleteTaskBranch(repoPath: string, branch: string): Promise<boolean> {
  return invoke<boolean>('delete_task_branch', { repoPath, branch })
}

export type FileChange = {
  path: string
  status: string
  additions: number
  deletions: number
}

export type ChangeSummary = {
  files: FileChange[]
  totalAdditions: number
  totalDeletions: number
  totalFiles: number
}

export async function getChanges(repoPath: string, branch: string): Promise<ChangeSummary> {
  return invoke<ChangeSummary>('get_changes', { repoPath, branch })
}

export async function getDiff(
  repoPath: string,
  branch: string,
  filePath?: string,
): Promise<string> {
  return invoke<string>('get_diff', { repoPath, branch, filePath })
}

export type CommitInfo = {
  hash: string
  shortHash: string
  message: string
  author: string
  timestamp: number
}

export async function getCommits(repoPath: string, branch: string): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>('get_commits', { repoPath, branch })
}

export type ConflictEntry = {
  file: string
  branches: string[]
}

export type ConflictMatrix = {
  conflicts: ConflictEntry[]
  hasConflicts: boolean
}

export async function getConflictMatrix(repoPath: string): Promise<ConflictMatrix> {
  return invoke<ConflictMatrix>('get_conflict_matrix', { repoPath })
}

// ─── Agent commands ───────────────────────────────────────────────────────

export type AgentInfo = {
  taskId: string
  agentType: string
  status: string
  pid: number | null
  workingDir: string
}

export async function startAgent(
  taskId: string,
  agentType: string,
  workingDir: string,
  cliPath?: string,
): Promise<AgentInfo> {
  return invoke<AgentInfo>('start_agent', { taskId, agentType, workingDir, cliPath })
}

export async function stopAgent(taskId: string): Promise<void> {
  return invoke('stop_agent', { taskId })
}

export async function getAgentStatus(taskId: string): Promise<AgentInfo> {
  return invoke<AgentInfo>('get_agent_status', { taskId })
}

// ─── Agent Messages ────────────────────────────────────────────────────────

import type { AgentMessage } from '@/types'

export async function saveAgentMessage(
  taskId: string,
  role: string,
  content: string,
  model?: string,
  effortLevel?: string,
  toolCalls?: string,
  thinkingContent?: string,
): Promise<AgentMessage> {
  return invoke<AgentMessage>('save_agent_message', {
    taskId,
    role,
    content,
    model,
    effortLevel,
    toolCalls,
    thinkingContent,
  })
}

export async function getAgentMessages(taskId: string): Promise<AgentMessage[]> {
  return invoke<AgentMessage[]>('get_agent_messages', { taskId })
}

export async function clearAgentMessages(taskId: string): Promise<void> {
  return invoke('clear_agent_messages', { taskId })
}

export async function streamAgentChat(
  taskId: string,
  message: string,
  workingDir: string,
  cliPath: string,
  model?: string,
  effortLevel?: string,
): Promise<void> {
  return invoke('stream_agent_chat', {
    taskId,
    message,
    workingDir,
    cliPath,
    model,
    effortLevel,
  })
}

export async function cancelAgentChat(taskId: string): Promise<void> {
  return invoke('cancel_agent_chat', { taskId })
}

// ─── Queue Management ──────────────────────────────────────────────────────

export type QueueStatus = {
  queuedCount: number
  runningCount: number
  maxConcurrent: number
  queuedTasks: Task[]
}

export async function queueAgentTasks(taskIds: string[]): Promise<Task[]> {
  return invoke<Task[]>('queue_agent_tasks', { taskIds })
}

export async function updateTaskAgentStatus(
  taskId: string,
  agentStatus: string | null,
  queuedAt?: string | null
): Promise<Task> {
  return invoke<Task>('update_task_agent_status', { taskId, agentStatus, queuedAt })
}

export async function getQueueStatus(workspaceId: string): Promise<QueueStatus> {
  return invoke<QueueStatus>('get_queue_status', { workspaceId })
}

export async function getNextQueuedTask(workspaceId: string): Promise<Task | null> {
  return invoke<Task | null>('get_next_queued_task', { workspaceId })
}

// ─── Agent Events ──────────────────────────────────────────────────────────

export type AgentStreamEvent = {
  taskId: string
  content: string
}

export type AgentThinkingEvent = {
  taskId: string
  content: string
  isComplete: boolean
}

export type AgentToolCallEvent = {
  taskId: string
  toolId: string
  toolName: string
  toolInput: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

export type AgentCompleteEvent = {
  taskId: string
  success: boolean
  message?: string
}

export const onAgentStream = (
  cb: EventCallback<AgentStreamEvent>
): Promise<UnlistenFn> => listen<AgentStreamEvent>('agent:stream', cb)

export const onAgentThinking = (
  cb: EventCallback<AgentThinkingEvent>
): Promise<UnlistenFn> => listen<AgentThinkingEvent>('agent:thinking', cb)

export const onAgentToolCall = (
  cb: EventCallback<AgentToolCallEvent>
): Promise<UnlistenFn> => listen<AgentToolCallEvent>('agent:tool_call', cb)

export const onAgentComplete = (
  cb: EventCallback<AgentCompleteEvent>
): Promise<UnlistenFn> => listen<AgentCompleteEvent>('agent:complete', cb)

// ─── Queue Events ──────────────────────────────────────────────────────────

export type QueueBatchRequestedEvent = {
  workspaceId: string
  taskIds: string[]
  agentType: string
}

export const onQueueBatchRequested = (
  cb: EventCallback<QueueBatchRequestedEvent>
): Promise<UnlistenFn> => listen<QueueBatchRequestedEvent>('queue:batch_requested', cb)

// Maximum concurrent agents for batch processing
const MAX_CONCURRENT_AGENTS = 5

// Active agent tracking for batch queue
const activeAgentSlots = new Set<string>()

/**
 * Queue multiple tasks for batch agent processing.
 * Respects MAX_CONCURRENT_AGENTS limit and processes in parallel.
 */
export async function queueAgentBatch(
  taskIds: string[],
  agentType: string,
  workingDir: string,
  cliPath?: string
): Promise<{ queued: string[]; skipped: string[] }> {
  const queued: string[] = []
  const skipped: string[] = []

  for (const taskId of taskIds) {
    // Check if we have available slots
    if (activeAgentSlots.size >= MAX_CONCURRENT_AGENTS) {
      skipped.push(taskId)
      continue
    }

    // Check if this task already has an active agent
    if (activeAgentSlots.has(taskId)) {
      skipped.push(taskId)
      continue
    }

    try {
      activeAgentSlots.add(taskId)
      await startAgent(taskId, agentType, workingDir, cliPath)
      queued.push(taskId)
    } catch (err) {
      activeAgentSlots.delete(taskId)
      console.error(`[queueAgentBatch] Failed to start agent for ${taskId}:`, err)
      skipped.push(taskId)
    }
  }

  return { queued, skipped }
}

/**
 * Release an agent slot when processing completes.
 * Should be called when an agent finishes (success or failure).
 */
export function releaseAgentSlot(taskId: string): void {
  activeAgentSlots.delete(taskId)
}

/**
 * Get current number of active agent slots.
 */
export function getActiveAgentCount(): number {
  return activeAgentSlots.size
}

// ─── CLI detection ──────────────────────────────────────────────────────────

export type DetectedCli = {
  id: string
  name: string
  path: string
  version: string | null
  isAvailable: boolean
}

export async function detectClis(): Promise<DetectedCli[]> {
  return invoke<DetectedCli[]>('detect_clis')
}

export async function detectSingleCli(cliId: string): Promise<DetectedCli> {
  return invoke<DetectedCli>('detect_single_cli', { cliId })
}

export async function verifyCliPath(path: string): Promise<DetectedCli> {
  return invoke<DetectedCli>('verify_cli_path', { path })
}

// ─── CLI Capabilities ──────────────────────────────────────────────────────

export type ModelCapability = {
  id: string
  name: string
  description: string
  supportsExtendedContext: boolean
  contextWindow: string
  maxEffort: string
  available: boolean
}

export type CliCapabilities = {
  cliId: string
  cliVersion: string | null
  models: ModelCapability[]
  detected: boolean
}

export async function getCliCapabilities(cliId: string): Promise<CliCapabilities> {
  return invoke<CliCapabilities>('get_cli_capabilities', { cliId })
}

// ─── Event listeners ───────────────────────────────────────────────────────

export type EventCallback<T> = (payload: T) => void

export const onTaskUpdated = (cb: EventCallback<Task>): Promise<UnlistenFn> =>
  listen<Task>('task_updated', cb)
export const onColumnUpdated = (cb: EventCallback<Column>): Promise<UnlistenFn> =>
  listen<Column>('column_updated', cb)
export const onWorkspaceUpdated = (cb: EventCallback<Workspace>): Promise<UnlistenFn> =>
  listen<Workspace>('workspace_updated', cb)

// ─── Pipeline commands ─────────────────────────────────────────────────────

export type PipelineEvent = {
  taskId: string
  columnId: string
  eventType: string
  state: string
  message: string | null
}

export async function markPipelineComplete(
  taskId: string,
  success: boolean,
): Promise<Task> {
  return invoke<Task>('mark_pipeline_complete', { taskId, success })
}

export async function getPipelineState(taskId: string): Promise<string> {
  return invoke<string>('get_pipeline_state', { taskId })
}

export async function tryAdvanceTask(taskId: string): Promise<Task | null> {
  return invoke<Task | null>('try_advance_task', { taskId })
}

export async function setPipelineError(
  taskId: string,
  errorMessage: string,
): Promise<Task> {
  return invoke<Task>('set_pipeline_error', { taskId, errorMessage })
}

export async function retryPipeline(taskId: string): Promise<Task> {
  return invoke<Task>('retry_pipeline', { taskId })
}

export async function fireAgentTrigger(
  taskId: string,
  agentType: string,
  envVars?: Record<string, string>,
  cliPath?: string,
): Promise<Task> {
  return invoke<Task>('fire_agent_trigger', { taskId, agentType, envVars, cliPath })
}

export async function fireCliTrigger(
  taskId: string,
  cliType: string,
  command?: string,
  prompt?: string,
  flags?: string[],
  useQueue?: boolean,
  cliPath?: string,
): Promise<Task> {
  return invoke<Task>('fire_cli_trigger', {
    taskId,
    cliType,
    command,
    prompt: prompt ?? '',
    flags,
    useQueue: useQueue ?? true,
    cliPath,
  })
}

export async function fireScriptTrigger(
  taskId: string,
  scriptPath: string,
): Promise<Task> {
  return invoke<Task>('fire_script_trigger', { taskId, scriptPath })
}

export async function fireSkillTrigger(
  taskId: string,
  skillName: string,
  envVars?: Record<string, string>,
  cliPath?: string,
): Promise<Task> {
  return invoke<Task>('fire_skill_trigger', { taskId, skillName, envVars, cliPath })
}

// ─── Pipeline event listeners ───────────────────────────────────────────────

export const onPipelineTriggered = (cb: EventCallback<PipelineEvent>): Promise<UnlistenFn> =>
  listen<PipelineEvent>('pipeline:triggered', cb)
export const onPipelineRunning = (cb: EventCallback<PipelineEvent>): Promise<UnlistenFn> =>
  listen<PipelineEvent>('pipeline:running', cb)
export const onPipelineAdvanced = (cb: EventCallback<PipelineEvent>): Promise<UnlistenFn> =>
  listen<PipelineEvent>('pipeline:advanced', cb)
export const onPipelineComplete = (cb: EventCallback<PipelineEvent>): Promise<UnlistenFn> =>
  listen<PipelineEvent>('pipeline:complete', cb)
export const onPipelineError = (cb: EventCallback<PipelineEvent>): Promise<UnlistenFn> =>
  listen<PipelineEvent>('pipeline:error', cb)

// ─── Pipeline spawn event types ─────────────────────────────────────────────

export type SpawnAgentEvent = {
  taskId: string
  columnId: string
  workspaceId: string
  agentType: string
  flags?: string[]
}

export type SpawnScriptEvent = {
  taskId: string
  columnId: string
  workspaceId: string
  scriptPath: string
  taskTitle: string
}

export type SpawnSkillEvent = {
  taskId: string
  columnId: string
  workspaceId: string
  skillName: string
  flags?: string[]
}

export const onPipelineSpawnAgent = (
  cb: EventCallback<SpawnAgentEvent>,
): Promise<UnlistenFn> => listen<SpawnAgentEvent>('pipeline:spawn_agent', cb)

export const onPipelineSpawnScript = (
  cb: EventCallback<SpawnScriptEvent>,
): Promise<UnlistenFn> => listen<SpawnScriptEvent>('pipeline:spawn_script', cb)

export const onPipelineSpawnSkill = (
  cb: EventCallback<SpawnSkillEvent>,
): Promise<UnlistenFn> => listen<SpawnSkillEvent>('pipeline:spawn_skill', cb)

// ─── V2 Trigger Events ──────────────────────────────────────────────────────

export type SpawnCliEvent = {
  taskId: string
  columnId: string
  workspaceId: string
  cliType: string
  command?: string
  prompt: string
  flags?: string[]
  useQueue: boolean
}

export const onPipelineSpawnCli = (
  cb: EventCallback<SpawnCliEvent>,
): Promise<UnlistenFn> => listen<SpawnCliEvent>('pipeline:spawn_cli', cb)

// ─── Orchestrator commands ──────────────────────────────────────────────────

export type ChatSession = {
  id: string
  workspaceId: string
  title: string
  createdAt: string
  updatedAt: string
}

export type ChatMessage = {
  id: string
  workspaceId: string
  sessionId: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export type OrchestratorSession = {
  id: string
  workspaceId: string
  status: 'idle' | 'processing' | 'error'
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type OrchestratorContext = {
  workspaceId: string
  workspaceName: string
  columns: Column[]
  tasks: Task[]
  recentMessages: ChatMessage[]
}

export type OrchestratorAction = {
  actionType: string
  title?: string
  description?: string
  columnId?: string
  taskId?: string
}

export type OrchestratorResponse = {
  message: string
  actions: OrchestratorAction[]
  tasksCreated: Task[]
}

export type OrchestratorEvent = {
  workspaceId: string
  eventType: string
  message: string | null
}

export async function getOrchestratorContext(workspaceId: string): Promise<OrchestratorContext> {
  return invoke<OrchestratorContext>('get_orchestrator_context', { workspaceId })
}

export async function getOrchestratorSession(workspaceId: string): Promise<OrchestratorSession> {
  return invoke<OrchestratorSession>('get_orchestrator_session', { workspaceId })
}

export async function sendOrchestratorMessage(
  workspaceId: string,
  message: string,
): Promise<ChatMessage> {
  return invoke<ChatMessage>('send_orchestrator_message', { workspaceId, message })
}

// Chat session management
export async function listChatSessions(workspaceId: string): Promise<ChatSession[]> {
  return invoke<ChatSession[]>('list_chat_sessions', { workspaceId })
}

export async function getActiveChatSession(workspaceId: string): Promise<ChatSession> {
  return invoke<ChatSession>('get_active_chat_session', { workspaceId })
}

export async function createChatSession(workspaceId: string, title?: string): Promise<ChatSession> {
  return invoke<ChatSession>('create_chat_session', { workspaceId, title })
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  return invoke('delete_chat_session', { sessionId })
}

export async function getChatHistory(
  sessionId: string,
  limit?: number,
): Promise<ChatMessage[]> {
  return invoke<ChatMessage[]>('get_chat_history', { sessionId, limit })
}

export async function clearChatHistory(sessionId: string): Promise<void> {
  return invoke('clear_chat_history', { sessionId })
}

export async function processOrchestratorResponse(
  workspaceId: string,
  responseText: string,
  actions: OrchestratorAction[],
): Promise<OrchestratorResponse> {
  return invoke<OrchestratorResponse>('process_orchestrator_response', {
    workspaceId,
    responseText,
    actions,
  })
}

export async function setOrchestratorError(
  workspaceId: string,
  errorMessage: string,
): Promise<OrchestratorSession> {
  return invoke<OrchestratorSession>('set_orchestrator_error', { workspaceId, errorMessage })
}

// ─── Orchestrator event listeners ───────────────────────────────────────────

export const onOrchestratorProcessing = (cb: EventCallback<OrchestratorEvent>): Promise<UnlistenFn> =>
  listen<OrchestratorEvent>('orchestrator:processing', cb)
export const onOrchestratorComplete = (cb: EventCallback<OrchestratorEvent>): Promise<UnlistenFn> =>
  listen<OrchestratorEvent>('orchestrator:complete', cb)
export const onOrchestratorError = (cb: EventCallback<OrchestratorEvent>): Promise<UnlistenFn> =>
  listen<OrchestratorEvent>('orchestrator:error', cb)

// ─── Orchestrator streaming ─────────────────────────────────────────────────

export type ToolUsePayload = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type StreamChunkEvent = {
  workspaceId: string
  delta: string
  finishReason: string | null
  toolUse?: ToolUsePayload
}

export type ToolResultEvent = {
  workspaceId: string
  toolUseId: string
  result: string
  isError: boolean
}

export type ThinkingEvent = {
  workspaceId: string
  content: string
  isComplete: boolean
}

export type ToolCallEvent = {
  workspaceId: string
  toolId: string
  toolName: string
  status: 'running' | 'complete' | 'error'
  input?: Record<string, unknown>
  result?: string
}

export const onOrchestratorStream = (cb: EventCallback<StreamChunkEvent>): Promise<UnlistenFn> =>
  listen<StreamChunkEvent>('orchestrator:stream', cb)

export const onOrchestratorToolResult = (cb: EventCallback<ToolResultEvent>): Promise<UnlistenFn> =>
  listen<ToolResultEvent>('orchestrator:tool_result', cb)

export const onOrchestratorThinking = (cb: EventCallback<ThinkingEvent>): Promise<UnlistenFn> =>
  listen<ThinkingEvent>('orchestrator:thinking', cb)

export const onOrchestratorToolCall = (cb: EventCallback<ToolCallEvent>): Promise<UnlistenFn> =>
  listen<ToolCallEvent>('orchestrator:tool_call', cb)

export async function streamOrchestratorChat(
  workspaceId: string,
  sessionId: string,
  message: string,
  connectionMode: 'cli' | 'api',
  apiKey?: string,
  model?: string,
  cliPath?: string,
): Promise<void> {
  return invoke('stream_orchestrator_chat', {
    workspaceId,
    sessionId,
    message,
    connectionMode,
    apiKey,
    model,
    cliPath,
  })
}

export async function cancelOrchestratorChat(
  sessionId: string,
  workspaceId: string
): Promise<void> {
  return invoke('cancel_orchestrator_chat', { sessionId, workspaceId })
}

export async function resetCliSession(sessionId: string): Promise<void> {
  return invoke('reset_cli_session', { sessionId })
}

// ─── Voice commands ─────────────────────────────────────────────────────────

export type TranscriptionResult = {
  text: string
  durationMs: number
  modelUsed?: string
}

export type WhisperModelStatus = 'available' | 'downloading' | 'downloaded' | 'error'

export type WhisperModelInfo = {
  model: string
  status: WhisperModelStatus
  sizeDisplay: string
  sizeBytes: number
  description: string
  path: string | null
}

export type WhisperDownloadProgress = {
  model: string
  downloadedBytes: number
  totalBytes: number
  percent: number
}

export async function isVoiceAvailable(): Promise<boolean> {
  return invoke<boolean>('is_voice_available')
}

export async function saveAudioTemp(audioData: number[]): Promise<string> {
  return invoke<string>('save_audio_temp', { audioData })
}

export async function transcribeAudio(
  audioPath: string,
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>('transcribe_audio', { audioPath, language, model })
}

export async function listWhisperModels(): Promise<WhisperModelInfo[]> {
  return invoke<WhisperModelInfo[]>('list_whisper_models')
}

export async function downloadWhisperModel(model: string): Promise<string> {
  return invoke<string>('download_whisper_model', { model })
}

export async function deleteWhisperModel(model: string): Promise<void> {
  return invoke('delete_whisper_model', { model })
}

export async function getWhisperModelInfo(model: string): Promise<WhisperModelInfo> {
  return invoke<WhisperModelInfo>('get_whisper_model_info', { model })
}

export function onWhisperDownloadProgress(
  cb: EventCallback<WhisperDownloadProgress>
): Promise<UnlistenFn> {
  return listen<WhisperDownloadProgress>('whisper:download-progress', cb)
}

export function onWhisperDownloadComplete(
  cb: EventCallback<{ model: string }>
): Promise<UnlistenFn> {
  return listen<{ model: string }>('whisper:download-complete', cb)
}

// ─── Native Audio Recording (bypasses webview limitations) ──────────────────

export async function startNativeRecording(): Promise<void> {
  return invoke('start_native_recording')
}

export async function stopNativeRecording(): Promise<void> {
  return invoke('stop_native_recording')
}

export async function cancelNativeRecording(): Promise<void> {
  return invoke('cancel_native_recording')
}

export async function isNativeRecording(): Promise<boolean> {
  return invoke<boolean>('is_native_recording')
}

// ─── Streaming Transcription ─────────────────────────────────────────────────

/** Transcribe new audio chunk while still recording (for live streaming) */
export async function transcribeRecordingChunk(
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>('transcribe_recording_chunk', { language, model })
}

/** Stop recording and transcribe ALL audio (final transcription) */
export async function transcribeAllRecording(
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>('transcribe_all_recording', { language, model })
}

// ─── Usage tracking commands ─────────────────────────────────────────────────

export type UsageRecord = {
  id: string
  workspaceId: string
  taskId: string | null
  sessionId: string | null
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  createdAt: string
}

export type UsageSummary = {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  recordCount: number
}

export async function recordUsage(
  workspaceId: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  taskId?: string,
  sessionId?: string,
): Promise<UsageRecord> {
  return invoke<UsageRecord>('record_usage', {
    workspaceId,
    taskId,
    sessionId,
    provider,
    model,
    inputTokens,
    outputTokens,
    costUsd,
  })
}

export async function getWorkspaceUsage(
  workspaceId: string,
  limit?: number,
): Promise<UsageRecord[]> {
  return invoke<UsageRecord[]>('get_workspace_usage', { workspaceId, limit })
}

export async function getTaskUsage(taskId: string): Promise<UsageRecord[]> {
  return invoke<UsageRecord[]>('get_task_usage', { taskId })
}

export async function getWorkspaceUsageSummary(
  workspaceId: string,
): Promise<UsageSummary> {
  return invoke<UsageSummary>('get_workspace_usage_summary', { workspaceId })
}

export async function getTaskUsageSummary(taskId: string): Promise<UsageSummary> {
  return invoke<UsageSummary>('get_task_usage_summary', { taskId })
}

export async function clearWorkspaceUsage(workspaceId: string): Promise<void> {
  return invoke('clear_workspace_usage', { workspaceId })
}

// ─── Session history commands ────────────────────────────────────────────────

export type SessionSnapshot = {
  id: string
  sessionId: string
  workspaceId: string
  taskId: string | null
  snapshotType: 'checkpoint' | 'complete' | 'error'
  scrollbackSnapshot: string | null
  commandHistory: string
  filesModified: string
  durationMs: number
  createdAt: string
}

export async function createSnapshot(
  sessionId: string,
  workspaceId: string,
  snapshotType: string,
  commandHistory: string,
  filesModified: string,
  durationMs: number,
  taskId?: string,
  scrollbackSnapshot?: string,
): Promise<SessionSnapshot> {
  return invoke<SessionSnapshot>('create_snapshot', {
    sessionId,
    workspaceId,
    taskId,
    snapshotType,
    scrollbackSnapshot,
    commandHistory,
    filesModified,
    durationMs,
  })
}

export async function getSnapshot(id: string): Promise<SessionSnapshot> {
  return invoke<SessionSnapshot>('get_snapshot', { id })
}

export async function getSessionHistory(sessionId: string): Promise<SessionSnapshot[]> {
  return invoke<SessionSnapshot[]>('get_session_history', { sessionId })
}

export async function getWorkspaceHistory(
  workspaceId: string,
  limit?: number,
): Promise<SessionSnapshot[]> {
  return invoke<SessionSnapshot[]>('get_workspace_history', { workspaceId, limit })
}

export async function getTaskHistory(taskId: string): Promise<SessionSnapshot[]> {
  return invoke<SessionSnapshot[]>('get_task_history', { taskId })
}

export async function clearSessionHistory(sessionId: string): Promise<void> {
  return invoke('clear_session_history', { sessionId })
}

export type RestoreSnapshotParams = {
  snapshotId: string
  currentSessionId: string
  currentWorkspaceId: string
  currentTaskId?: string
  currentScrollback?: string
  currentCommandHistory: string
  currentFilesModified: string
  currentDurationMs: number
}

export type RestoreResult = {
  snapshot: SessionSnapshot
  backupId: string
  sessionUpdated: boolean
}

export async function restoreSnapshot(params: RestoreSnapshotParams): Promise<RestoreResult> {
  return invoke<RestoreResult>('restore_snapshot', params)
}

// ─── Checklist commands ──────────────────────────────────────────────────────

export type ChecklistItem = {
  id: string
  categoryId: string
  text: string
  checked: boolean
  notes: string | null
  position: number
  // Auto-detect fields
  detectType: string | null
  detectConfig: string | null
  autoDetected: boolean
  linkedTaskId: string | null
  createdAt: string
  updatedAt: string
}

export type ChecklistCategory = {
  id: string
  checklistId: string
  name: string
  icon: string
  position: number
  progress: number
  totalItems: number
  collapsed: boolean
}

export type ChecklistData = {
  id: string
  workspaceId: string
  name: string
  description: string | null
  progress: number
  totalItems: number
  createdAt: string
  updatedAt: string
}

export type ChecklistWithData = {
  checklist: ChecklistData | null
  categories: ChecklistCategory[]
  items: Record<string, ChecklistItem[]>
}

export type TemplateItem = {
  text: string
  detectType?: string
  detectConfig?: string  // JSON-encoded detection config
}

export type TemplateCategory = {
  name: string
  icon: string
  items: TemplateItem[]
}

export async function getWorkspaceChecklist(workspaceId: string): Promise<ChecklistWithData> {
  return invoke<ChecklistWithData>('get_workspace_checklist', { workspaceId })
}

export async function updateChecklistItem(
  itemId: string,
  checked?: boolean,
  notes?: string | null,
): Promise<ChecklistItem> {
  return invoke<ChecklistItem>('update_checklist_item', { itemId, checked, notes })
}

export async function updateChecklistCategory(
  categoryId: string,
  collapsed: boolean,
): Promise<ChecklistCategory> {
  return invoke<ChecklistCategory>('update_checklist_category', { categoryId, collapsed })
}

export async function createWorkspaceChecklist(
  workspaceId: string,
  name: string,
  description: string | null,
  categories: TemplateCategory[],
): Promise<ChecklistWithData> {
  return invoke<ChecklistWithData>('create_workspace_checklist', {
    workspaceId,
    name,
    description,
    categories,
  })
}

export async function deleteWorkspaceChecklist(workspaceId: string): Promise<void> {
  return invoke('delete_workspace_checklist', { workspaceId })
}

export async function updateChecklistItemAutoDetect(
  itemId: string,
  autoDetected: boolean,
  checked: boolean,
): Promise<ChecklistItem> {
  return invoke<ChecklistItem>('update_checklist_item_auto_detect', { itemId, autoDetected, checked })
}

export async function linkChecklistItemToTask(
  itemId: string,
  taskId: string | null,
): Promise<ChecklistItem> {
  return invoke<ChecklistItem>('link_checklist_item_to_task', { itemId, taskId })
}

export type DetectionResult = {
  itemId: string
  detected: boolean
  message: string | null
}

export async function runChecklistDetection(
  workspaceId: string,
  repoPath: string,
): Promise<DetectionResult[]> {
  return invoke<DetectionResult[]>('run_checklist_detection', { workspaceId, repoPath })
}

// ─── Files commands ──────────────────────────────────────────────────────────

export type FileEntry = {
  path: string
  name: string
  category: 'context' | 'tickets' | 'notes'
  modifiedAt: number
}

export async function scanWorkspaceFiles(repoPath: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('scan_workspace_files', { repoPath })
}

export async function readFileContent(filePath: string): Promise<string> {
  return invoke<string>('read_file_content', { filePath })
}

export async function createNoteFile(
  repoPath: string,
  filename: string,
  content: string,
): Promise<FileEntry> {
  return invoke<FileEntry>('create_note_file', { repoPath, filename, content })
}

// ─── Siege loop commands ─────────────────────────────────────────────────────

import type {
  PrStatus,
  StartSiegeResult,
  CheckSiegeResult,
  SiegeEvent,
} from '@/types/task'

export async function startSiege(
  taskId: string,
  maxIterations?: number,
  envVars?: Record<string, string>,
  cliPath?: string,
): Promise<StartSiegeResult> {
  return invoke<StartSiegeResult>('start_siege', { taskId, maxIterations, envVars, cliPath })
}

export async function stopSiege(taskId: string): Promise<Task> {
  return invoke<Task>('stop_siege', { taskId })
}

export async function checkSiegeStatus(taskId: string): Promise<CheckSiegeResult> {
  return invoke<CheckSiegeResult>('check_siege_status', { taskId })
}

export async function continueSiege(
  taskId: string,
  envVars?: Record<string, string>,
  cliPath?: string,
): Promise<StartSiegeResult> {
  return invoke<StartSiegeResult>('continue_siege', { taskId, envVars, cliPath })
}

export async function getPrStatus(taskId: string): Promise<PrStatus> {
  return invoke<PrStatus>('get_pr_status', { taskId })
}

// ─── Siege event listeners ───────────────────────────────────────────────────

export const onSiegeStarted = (cb: EventCallback<SiegeEvent>): Promise<UnlistenFn> =>
  listen<SiegeEvent>('siege:started', cb)

export const onSiegeIteration = (cb: EventCallback<SiegeEvent>): Promise<UnlistenFn> =>
  listen<SiegeEvent>('siege:iteration', cb)

export const onSiegeStopped = (cb: EventCallback<SiegeEvent>): Promise<UnlistenFn> =>
  listen<SiegeEvent>('siege:stopped', cb)

export const onSiegeComplete = (cb: EventCallback<SiegeEvent>): Promise<UnlistenFn> =>
  listen<SiegeEvent>('siege:complete', cb)

// ─── GitHub PR status commands ────────────────────────────────────────────────

export type PrStatusResponse = {
  taskId: string
  prNumber: number
  mergeable: 'mergeable' | 'conflicted' | 'unknown'
  ciStatus: 'pending' | 'success' | 'failure' | 'error'
  reviewDecision: string | null
  commentCount: number
  isDraft: boolean
  labels: string[]
  headSha: string
  state: string
}

export async function fetchPrStatus(
  taskId: string,
  repoPath: string,
): Promise<PrStatusResponse> {
  return invoke<PrStatusResponse>('fetch_pr_status', { taskId, repoPath })
}

export async function fetchPrStatusBatch(
  taskIds: string[],
  repoPath: string,
): Promise<PrStatusResponse[]> {
  return invoke<PrStatusResponse[]>('fetch_pr_status_batch', { taskIds, repoPath })
}

export async function shouldRefreshPrStatus(
  taskId: string,
  maxAgeSeconds: number,
): Promise<boolean> {
  return invoke<boolean>('should_refresh_pr_status', { taskId, maxAgeSeconds })
}

// ─── Discord commands ─────────────────────────────────────────────────────────

export type DiscordStatus = {
  connected: boolean
  ready: boolean
  user?: {
    id: string
    tag: string
    username: string
  }
  guildId?: string
  guildName?: string
}

export type SetupWorkspaceResult = {
  categoryId: string
  channelMap: Record<string, string>
  chefChannelId: string
  notificationsChannelId: string
}

export type CreateThreadResult = {
  threadId: string
  messageId: string
}

export type DiscordTaskThread = {
  id: string
  taskId: string
  discordThreadId: string
  discordChannelId: string
  isArchived: boolean
  createdAt: string
}

export async function spawnDiscordSidecar(): Promise<void> {
  return invoke('spawn_discord_sidecar')
}

export async function killDiscordSidecar(): Promise<void> {
  return invoke('kill_discord_sidecar')
}

export async function connectDiscord(
  token: string,
  guildId?: string,
): Promise<DiscordStatus> {
  return invoke<DiscordStatus>('connect_discord', { token, guildId })
}

export async function disconnectDiscord(): Promise<void> {
  return invoke('disconnect_discord')
}

export async function getDiscordStatus(): Promise<DiscordStatus> {
  return invoke<DiscordStatus>('get_discord_status')
}

export async function testDiscordConnection(): Promise<unknown> {
  return invoke<unknown>('test_discord_connection')
}

export async function setupDiscordWorkspace(
  workspaceId: string,
  guildId: string,
): Promise<SetupWorkspaceResult> {
  return invoke<SetupWorkspaceResult>('setup_discord_workspace', { workspaceId, guildId })
}

export async function createDiscordThread(
  channelId: string,
  taskId: string,
  taskTitle: string,
): Promise<CreateThreadResult> {
  return invoke<CreateThreadResult>('create_discord_thread', { channelId, taskId, taskTitle })
}

export async function archiveDiscordThread(
  taskId: string,
  reason?: string,
): Promise<boolean> {
  return invoke<boolean>('archive_discord_thread', { taskId, reason })
}

export async function getDiscordThreadForTask(
  taskId: string,
): Promise<DiscordTaskThread | null> {
  return invoke<DiscordTaskThread | null>('get_discord_thread_for_task', { taskId })
}

export async function postDiscordMessage(
  channelId: string,
  threadId?: string,
  content?: string,
  embeds?: unknown[],
): Promise<string> {
  return invoke<string>('post_discord_message', { channelId, threadId, content, embeds })
}

// Discord task sync commands
export async function syncTaskCreated(
  taskId: string,
  workspaceId: string,
  columnId: string,
  title: string,
  description?: string,
): Promise<CreateThreadResult | null> {
  return invoke<CreateThreadResult | null>('sync_task_created', {
    taskId, workspaceId, columnId, title, description,
  })
}

export async function syncTaskMoved(
  taskId: string,
  workspaceId: string,
  oldColumnId: string,
  newColumnId: string,
  title: string,
): Promise<CreateThreadResult | null> {
  return invoke<CreateThreadResult | null>('sync_task_moved', {
    taskId, workspaceId, oldColumnId, newColumnId, title,
  })
}

export async function syncTaskUpdated(
  taskId: string,
  workspaceId: string,
  newTitle: string,
): Promise<boolean> {
  return invoke<boolean>('sync_task_updated', { taskId, workspaceId, newTitle })
}

export async function syncTaskDeleted(
  taskId: string,
  workspaceId: string,
  title: string,
): Promise<boolean> {
  return invoke<boolean>('sync_task_deleted', { taskId, workspaceId, title })
}

// Discord agent streaming commands
export async function registerDiscordThread(
  taskId: string,
  threadId: string,
): Promise<void> {
  return invoke('register_discord_thread', { taskId, threadId })
}

export async function streamAgentOutput(
  taskId: string,
  delta: string,
  outputType?: string,
): Promise<void> {
  return invoke('stream_agent_output', { taskId, delta, outputType })
}

export async function signalAgentComplete(
  taskId: string,
  success: boolean,
  summary: string,
  durationMs?: number,
  tokensUsed?: number,
): Promise<void> {
  return invoke('signal_agent_complete', { taskId, success, summary, durationMs, tokensUsed })
}

// Discord queue status
export type DiscordQueueStatus = {
  pendingCount: number
  limitedChannels: string[]
  lastError: string | null
}

export async function getDiscordQueueStatus(): Promise<DiscordQueueStatus> {
  return invoke<DiscordQueueStatus>('get_discord_queue_status')
}

// Discord event listeners
export type DiscordEvent = {
  event: string
  payload: unknown
}

export const onDiscordEvent = (cb: EventCallback<DiscordEvent>): Promise<UnlistenFn> =>
  listen<DiscordEvent>('discord:event', cb)

export { listen, type UnlistenFn }
export type { AppError }
