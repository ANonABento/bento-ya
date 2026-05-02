import { invoke } from './invoke'
import type { Label, Task } from '@/types'

export async function getLabels(workspaceId: string): Promise<Label[]> {
  return invoke<Label[]>('list_labels', { workspaceId })
}

export async function createLabel(
  workspaceId: string,
  name: string,
  color?: string,
): Promise<Label> {
  return invoke<Label>('create_label', { workspaceId, name, color })
}

export async function updateLabel(
  id: string,
  updates: { name?: string; color?: string },
): Promise<Label> {
  return invoke<Label>('update_label', { id, ...updates })
}

export async function deleteLabel(id: string): Promise<void> {
  return invoke('delete_label', { id })
}

export async function setTaskLabels(taskId: string, labelIds: string[]): Promise<Task> {
  return invoke<Task>('set_task_labels', { taskId, labelIds })
}
