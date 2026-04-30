import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { TaskTemplate } from '@/types'
import * as ipc from '@/lib/ipc'
import { useTaskStore } from '@/stores/task-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

type TaskTemplateState = {
  templates: TaskTemplate[]
  loadedWorkspaceId: string | null
  loadingWorkspaceId: string | null
  load: (workspaceId: string) => Promise<void>
  saveFromTask: (taskId: string) => Promise<TaskTemplate>
  update: (id: string, updates: { title: string; description?: string | null; labels: string; model?: string | null }) => Promise<TaskTemplate>
  remove: (id: string) => Promise<void>
  createTask: (templateId: string, columnId: string) => Promise<void>
}

export const useTaskTemplateStore = create<TaskTemplateState>()(
  devtools(
    (set, get) => ({
      templates: [],
      loadedWorkspaceId: null,
      loadingWorkspaceId: null,

      load: async (workspaceId) => {
        set((state) => (
          state.loadedWorkspaceId === workspaceId
            ? state
            : { templates: [], loadedWorkspaceId: null, loadingWorkspaceId: workspaceId }
        ))
        try {
          const templates = await ipc.listTaskTemplates(workspaceId)
          if (get().loadingWorkspaceId === workspaceId || get().loadedWorkspaceId === workspaceId) {
            set({ templates, loadedWorkspaceId: workspaceId, loadingWorkspaceId: null })
          }
        } catch (err) {
          if (get().loadingWorkspaceId === workspaceId) {
            set({ loadingWorkspaceId: null })
          }
          throw err
        }
      },

      saveFromTask: async (taskId) => {
        const template = await ipc.createTaskTemplateFromTask(taskId)
        set((state) => (
          state.loadedWorkspaceId === template.workspaceId
            ? { templates: [template, ...state.templates] }
            : state
        ))
        return template
      },

      update: async (id, updates) => {
        const template = await ipc.updateTaskTemplate(id, updates)
        set((state) => ({
          templates: state.templates.map((item) => item.id === id ? template : item),
        }))
        return template
      },

      remove: async (id) => {
        await ipc.deleteTaskTemplate(id)
        set((state) => ({
          templates: state.templates.filter((item) => item.id !== id),
        }))
      },

      createTask: async (templateId, columnId) => {
        const task = await ipc.createTaskFromTemplate(templateId, columnId)
        useTaskStore.setState((state) => ({ tasks: [...state.tasks, task] }))
        await useWorkspaceStore.getState().refreshWorkspace(task.workspaceId)
        const workspaceId = get().loadedWorkspaceId
        if (workspaceId) {
          await get().load(workspaceId)
        }
      },
    }),
    { name: 'task-template-store' },
  ),
)
