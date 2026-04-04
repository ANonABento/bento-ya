import { invoke } from './invoke'
import type { Task } from '@/types'
import type { CreatePrResult } from '@/types/task'

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

export async function createPr(
  taskId: string,
  repoPath: string,
  baseBranch?: string,
): Promise<CreatePrResult> {
  return invoke<CreatePrResult>('create_pr', { taskId, repoPath, baseBranch })
}
