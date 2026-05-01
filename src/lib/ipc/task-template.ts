import { invoke } from './invoke'
import type { Task, TaskTemplate } from '@/types'

export type TaskTemplateUpdate = {
  title: string
  description?: string | null
  labels: string
  model?: string | null
}

export const listTaskTemplates = (workspaceId: string) =>
  invoke<TaskTemplate[]>('list_task_templates', { workspaceId })

export const createTaskTemplateFromTask = (taskId: string) =>
  invoke<TaskTemplate>('create_task_template_from_task', { taskId })

export const updateTaskTemplate = (
  id: string,
  updates: TaskTemplateUpdate,
) => invoke<TaskTemplate>('update_task_template', { id, ...updates })

export const deleteTaskTemplate = (id: string): Promise<void> =>
  invoke('delete_task_template', { id })

export const createTaskFromTemplate = (templateId: string, columnId: string) =>
  invoke<Task>('create_task_from_template', { templateId, columnId })
