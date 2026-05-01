import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Task } from '@/types'
import * as ipc from '@/lib/ipc'
import { useUIStore } from '@/stores/ui-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

type TaskState = {
  tasks: Task[]
  loaded: boolean

  load: (workspaceId: string) => Promise<void>
  add: (workspaceId: string, columnId: string, title: string, description: string) => Promise<Task>
  remove: (id: string) => Promise<void>
  bulkRemove: (ids: string[]) => Promise<boolean>
  bulkMove: (ids: string[], targetColumnId: string) => Promise<boolean>
  move: (id: string, targetColumnId: string, position: number) => Promise<void>
  reorder: (columnId: string, ids: string[]) => Promise<void>
  updateTask: (id: string, updates: Partial<Task>) => void
  getByColumn: (columnId: string) => Task[]
  duplicate: (id: string) => Promise<Task | null>
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
        await useWorkspaceStore.getState().refreshWorkspace(workspaceId)
        return task
      },

      remove: async (id) => {
        const prev = get().tasks
        const workspaceId = prev.find((t) => t.id === id)?.workspaceId
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
        // Clear stale UI references to deleted task
        const ui = useUIStore.getState()
        if (ui.expandedTaskId === id) ui.collapseTask()
        if (ui.activeTaskId === id) ui.closeChat()
        try {
          await ipc.deleteTask(id)
          if (workspaceId) {
            await useWorkspaceStore.getState().refreshWorkspace(workspaceId)
          }
        } catch {
          set({ tasks: prev })
        }
      },

      bulkRemove: async (ids) => {
        const idSet = new Set(ids)
        if (idSet.size === 0) return false
        const prev = get().tasks
        const workspaceId = prev.find((t) => idSet.has(t.id))?.workspaceId
        set((s) => ({ tasks: s.tasks.filter((t) => !idSet.has(t.id)) }))

        const ui = useUIStore.getState()
        if (ui.expandedTaskId && idSet.has(ui.expandedTaskId)) ui.collapseTask()
        if (ui.activeTaskId && idSet.has(ui.activeTaskId)) ui.closeChat()

        try {
          await ipc.bulkUpdateTasks([...idSet], { delete: true })
          if (workspaceId) {
            await useWorkspaceStore.getState().refreshWorkspace(workspaceId)
          }
          return true
        } catch {
          set({ tasks: prev })
          return false
        }
      },

      bulkMove: async (ids, targetColumnId) => {
        const idSet = new Set(ids)
        if (idSet.size === 0) return false
        const prev = get().tasks
        const workspaceId = prev.find((t) => idSet.has(t.id))?.workspaceId
        const targetPositions = prev
          .filter((t) => t.columnId === targetColumnId && !idSet.has(t.id))
          .map((t) => t.position)
        const basePosition = targetPositions.length > 0 ? Math.max(...targetPositions) + 1 : 0
        const selectedOrder = [...idSet]
        const selectedPositionById = new Map(
          selectedOrder.map((id, index) => [id, basePosition + index]),
        )

        set((s) => ({
          tasks: s.tasks.map((t) => {
            const nextPosition = selectedPositionById.get(t.id)
            return nextPosition !== undefined
              ? { ...t, columnId: targetColumnId, position: nextPosition }
              : t
          }),
        }))

        try {
          const updatedTasks = await ipc.bulkUpdateTasks([...idSet], { targetColumnId })
          const updatedTaskById = new Map(updatedTasks.map((task) => [task.id, task]))
          set((s) => ({
            tasks: s.tasks.map((task) => updatedTaskById.get(task.id) ?? task),
          }))
          if (workspaceId) {
            await useWorkspaceStore.getState().refreshWorkspace(workspaceId)
          }
          return true
        } catch {
          set({ tasks: prev })
          return false
        }
      },

      move: async (id, targetColumnId, position) => {
        const prev = get().tasks
        const workspaceId = prev.find((t) => t.id === id)?.workspaceId
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, columnId: targetColumnId, position } : t,
          ),
        }))
        try {
          await ipc.moveTask(id, targetColumnId, position)
          if (workspaceId) {
            await useWorkspaceStore.getState().refreshWorkspace(workspaceId)
          }
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

      duplicate: async (id) => {
        const original = get().tasks.find((t) => t.id === id)
        if (!original) return null
        const task = await ipc.duplicateTask(original.id)
        set((s) => ({
          tasks: [
            ...s.tasks.map((existing) =>
              existing.columnId === task.columnId && existing.position >= task.position
                ? { ...existing, position: existing.position + 1 }
                : existing,
            ),
            task,
          ],
        }))
        await useWorkspaceStore.getState().refreshWorkspace(original.workspaceId)
        return task
      },
    }),
    { name: 'task-store' },
  ),
)
