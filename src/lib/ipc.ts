// Typed invoke() and listen() wrappers for Tauri IPC.
// Provides type-safe communication between React frontend and Rust backend.

import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AppError,
  Column,
  Task,
  Workspace,
} from '../types/events'

// ─── Typed invoke wrapper ──────────────────────────────────────────────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args)
}

// ─── Typed listen wrapper ──────────────────────────────────────────────────

function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return tauriListen<T>(event, (e) => handler(e.payload))
}

// ─── Workspace commands ────────────────────────────────────────────────────

export async function createWorkspace(name: string, repoPath: string): Promise<Workspace> {
  return invoke<Workspace>('create_workspace', { name, repoPath })
}

export async function getWorkspace(id: string): Promise<Workspace> {
  return invoke<Workspace>('get_workspace', { id })
}

export async function listWorkspaces(): Promise<Workspace[]> {
  return invoke<Workspace[]>('list_workspaces')
}

export async function updateWorkspace(
  id: string,
  updates: {
    name?: string
    repoPath?: string
    tabOrder?: number
    isActive?: boolean
  },
): Promise<Workspace> {
  return invoke<Workspace>('update_workspace', { id, ...updates })
}

export async function deleteWorkspace(id: string): Promise<void> {
  return invoke<void>('delete_workspace', { id })
}

// ─── Column commands ───────────────────────────────────────────────────────

export async function createColumn(
  workspaceId: string,
  name: string,
  position: number,
): Promise<Column> {
  return invoke<Column>('create_column', { workspaceId, name, position })
}

export async function listColumns(workspaceId: string): Promise<Column[]> {
  return invoke<Column[]>('list_columns', { workspaceId })
}

export async function updateColumn(
  id: string,
  updates: {
    name?: string
    position?: number
    color?: string | null
    visible?: boolean
  },
): Promise<Column> {
  return invoke<Column>('update_column', { id, ...updates })
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

export async function listTasks(workspaceId: string): Promise<Task[]> {
  return invoke<Task[]>('list_tasks', { workspaceId })
}

export async function updateTask(
  id: string,
  updates: {
    title?: string
    description?: string | null
    columnId?: string
    position?: number
    agentMode?: string | null
    priority?: string
  },
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

// ─── Event listeners ───────────────────────────────────────────────────────

export { listen, type UnlistenFn }
export type { AppError }
