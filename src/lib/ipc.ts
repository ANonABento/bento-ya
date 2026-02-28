// Typed invoke() and listen() wrappers for Tauri IPC.
// Provides type-safe communication between React frontend and Rust backend.

import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Workspace, Column, Task } from '@/types'
import type { AppError } from '../types/events'

// ─── Typed invoke wrapper ──────────────────────────────────────────────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args)
}

// ─── Typed listen wrapper ──────────────────────────────────────────────────

function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return tauriListen<T>(event, (e) => handler(e.payload))
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

export const reorderWorkspaces = (ids: string[]) =>
  invoke<void>('reorder_workspaces', { ids })

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

export async function getCurrentBranch(repoPath: string): Promise<string> {
  return invoke<string>('get_current_branch', { repoPath })
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
): Promise<AgentInfo> {
  return invoke<AgentInfo>('start_agent', { taskId, agentType, workingDir })
}

export async function stopAgent(taskId: string): Promise<void> {
  return invoke<void>('stop_agent', { taskId })
}

export async function getAgentStatus(taskId: string): Promise<AgentInfo> {
  return invoke<AgentInfo>('get_agent_status', { taskId })
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

export { listen, type UnlistenFn }
export type { AppError }
