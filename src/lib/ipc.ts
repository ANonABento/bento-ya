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

function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (isTauri()) {
    return tauriListen<T>(event, (e) => handler(e.payload))
  }
  // Browser mode - events not supported
  return mockListen<T>(event, handler)
}

// ─── Workspace commands ────────────────────────────────────────────────────

export const getWorkspaces = () => invoke<Workspace[]>('list_workspaces')
export const listWorkspaces = getWorkspaces

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
  return invoke<void>('delete_workspace', { id })
}

export async function cloneWorkspace(sourceId: string, newName: string): Promise<Workspace> {
  return invoke<Workspace>('clone_workspace', { sourceId, newName })
}

export const reorderWorkspaces = (ids: string[]) =>
  invoke<void>('reorder_workspaces', { ids })

export const seedDemoData = (repoPath: string) =>
  invoke<Workspace>('seed_demo_data', { repoPath })

// ─── Column commands ───────────────────────────────────────────────────────

export const getColumns = (workspaceId: string) =>
  invoke<Column[]>('list_columns', { workspaceId })
export const listColumns = getColumns

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
  return invoke<void>('delete_column', { id })
}

// ─── Task commands ─────────────────────────────────────────────────────────

export const getTasks = (workspaceId: string) =>
  invoke<Task[]>('list_tasks', { workspaceId })
export const listTasks = getTasks

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
  return invoke<void>('delete_task', { id })
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
  return invoke<void>('switch_branch', { repoPath, branch })
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
  return invoke<void>('stop_agent', { taskId })
}

export async function getAgentStatus(taskId: string): Promise<AgentInfo> {
  return invoke<AgentInfo>('get_agent_status', { taskId })
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

// ─── Orchestrator commands ──────────────────────────────────────────────────

export type ChatMessage = {
  id: string
  workspaceId: string
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

export async function getChatHistory(
  workspaceId: string,
  limit?: number,
): Promise<ChatMessage[]> {
  return invoke<ChatMessage[]>('get_chat_history', { workspaceId, limit })
}

export async function clearChatHistory(workspaceId: string): Promise<void> {
  return invoke<void>('clear_chat_history', { workspaceId })
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

// ─── Voice commands ─────────────────────────────────────────────────────────

export type TranscriptionResult = {
  text: string
  durationMs: number
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
  return invoke<void>('clear_workspace_usage', { workspaceId })
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
  return invoke<void>('clear_session_history', { sessionId })
}

export { listen, type UnlistenFn }
export type { AppError }
