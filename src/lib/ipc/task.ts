// Task IPC commands

import { invoke, listen, type EventCallback, type UnlistenFn } from './core'
import type { Task } from '@/types'
import type { CreatePrResult } from '@/types/task'

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

// ─── Review actions ─────────────────────────────────────────────────────────

export async function approveTask(id: string): Promise<Task> {
  return invoke<Task>('approve_task', { id })
}

export async function rejectTask(id: string, reason?: string): Promise<Task> {
  return invoke<Task>('reject_task', { id, reason })
}

// ─── PR creation ─────────────────────────────────────────────────────────────

export async function createPr(
  taskId: string,
  repoPath: string,
  baseBranch?: string,
): Promise<CreatePrResult> {
  return invoke<CreatePrResult>('create_pr', { taskId, repoPath, baseBranch })
}

// ─── Event listeners ───────────────────────────────────────────────────────

export const onTaskUpdated = (cb: EventCallback<Task>): Promise<UnlistenFn> =>
  listen<Task>('task_updated', cb)
