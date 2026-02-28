import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Task } from '@/types'
import * as ipc from '@/lib/ipc'

type TaskState = {
  tasks: Task[]
  loaded: boolean

  load: (workspaceId: string) => Promise<void>
  add: (workspaceId: string, columnId: string, title: string, description: string) => Promise<void>
  remove: (id: string) => Promise<void>
  move: (id: string, targetColumnId: string, position: number) => Promise<void>
  reorder: (columnId: string, ids: string[]) => Promise<void>
  updateTask: (id: string, updates: Partial<Task>) => void
  getByColumn: (columnId: string) => Task[]
}

export const useTaskStore = create<TaskState>()(
  devtools(
    (set, get) => ({
      tasks: [],
      loaded: false,

      load: async (workspaceId) => {
        const tasks = await ipc.getTasks(workspaceId)
        set({ tasks, loaded: true })
      },

      add: async (workspaceId, columnId, title, description) => {
        const task = await ipc.createTask(workspaceId, columnId, title, description)
        set((s) => ({ tasks: [...s.tasks, task] }))
      },

      remove: async (id) => {
        const prev = get().tasks
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
        try {
          await ipc.deleteTask(id)
        } catch {
          set({ tasks: prev })
        }
      },

      move: async (id, targetColumnId, position) => {
        const prev = get().tasks
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, columnId: targetColumnId, position } : t,
          ),
        }))
        try {
          await ipc.moveTask(id, targetColumnId, position)
        } catch {
          set({ tasks: prev })
        }
      },

      reorder: async (columnId, ids) => {
        const prev = get().tasks
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.columnId !== columnId) return t
            const idx = ids.indexOf(t.id)
            return idx >= 0 ? { ...t, position: idx } : t
          }),
        }))
        try {
          await ipc.reorderTasks(columnId, ids)
        } catch {
          set({ tasks: prev })
        }
      },

      updateTask: (id, updates) => {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        }))
      },

      getByColumn: (columnId) => {
        return get()
          .tasks.filter((t) => t.columnId === columnId)
          .sort((a, b) => a.position - b.position)
      },
    }),
    { name: 'task-store' },
  ),
)
