import { invoke } from './invoke'
import type { Label, TaskLabelAssignment } from '@/types'

export const getLabels = (workspaceId: string) => invoke<Label[]>('list_labels', { workspaceId })

export const createLabel = (workspaceId: string, name: string, color: string) =>
  invoke<Label>('create_label', { workspaceId, name, color })

export const updateLabel = (id: string, updates: { name?: string; color?: string }) =>
  invoke<Label>('update_label', { id, ...updates })

export const deleteLabel = (id: string) => invoke<undefined>('delete_label', { id })

export const getTaskLabelAssignments = (workspaceId: string) =>
  invoke<TaskLabelAssignment[]>('list_task_label_assignments', { workspaceId })

export const setTaskLabels = (taskId: string, labelIds: string[]) =>
  invoke<string[]>('set_task_labels', { taskId, labelIds })
