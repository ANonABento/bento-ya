import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Column } from '@/types'
import * as ipc from '@/lib/ipc'
import { useWorkspaceStore } from './workspace-store'

type ColumnUpdates = {
  name?: string
  icon?: string
  position?: number
  color?: string | null
  visible?: boolean
  // New unified triggers format
  triggers?: string
  // Legacy (for backward compatibility)
  triggerConfig?: string
  exitConfig?: string
  autoAdvance?: boolean
}

type ColumnState = {
  columns: Column[]
  loaded: boolean

  load: (workspaceId: string) => Promise<void>
  add: (workspaceId: string, name: string) => Promise<Column>
  remove: (id: string) => Promise<void>
  reorder: (workspaceId: string, ids: string[]) => Promise<void>
  updateColumn: (id: string, updates: Partial<Column>) => void
  updateColumnAsync: (id: string, updates: ColumnUpdates) => Promise<void>
}

export const useColumnStore = create<ColumnState>()(
  devtools(
    (set, get) => ({
      columns: [],
      loaded: false,

      load: async (workspaceId) => {
        const columns = await ipc.getColumns(workspaceId)
        set({ columns, loaded: true })
      },

      add: async (workspaceId, name) => {
        const position = get().columns.length
        const column = await ipc.createColumn(workspaceId, name, position)
        set((s) => ({ columns: [...s.columns, column] }))
        await useWorkspaceStore.getState().refreshWorkspace(workspaceId)
        return column
      },

      remove: async (id) => {
        const prev = get().columns
        const column = prev.find((c) => c.id === id)
        set((s) => ({ columns: s.columns.filter((c) => c.id !== id) }))
        try {
          await ipc.deleteColumn(id)
          if (column) {
            await useWorkspaceStore.getState().refreshWorkspace(column.workspaceId)
          }
        } catch {
          set({ columns: prev })
        }
      },

      reorder: async (workspaceId, ids) => {
        const prev = get().columns
        set((s) => ({
          columns: ids
            .map((id, i) => {
              const c = s.columns.find((col) => col.id === id)
              return c ? { ...c, position: i } : undefined
            })
            .filter((c): c is Column => c !== undefined),
        }))
        try {
          await ipc.reorderColumns(workspaceId, ids)
          await useWorkspaceStore.getState().refreshWorkspace(workspaceId)
        } catch {
          set({ columns: prev })
        }
      },

      updateColumn: (id, updates) => {
        set((s) => ({
          columns: s.columns.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        }))
      },

      updateColumnAsync: async (id, updates) => {
        const prev = get().columns
        // Optimistically update
        set((s) => ({
          columns: s.columns.map((c) =>
            c.id === id
              ? {
                  ...c,
                  ...(updates.name !== undefined && { name: updates.name }),
                  ...(updates.icon !== undefined && { icon: updates.icon }),
                  ...(updates.color !== undefined && { color: updates.color ?? '' }),
                  ...(updates.visible !== undefined && { visible: updates.visible }),
                }
              : c,
          ),
        }))
        try {
          const updated = await ipc.updateColumn(id, updates)
          set((s) => ({
            columns: s.columns.map((c) => (c.id === id ? updated : c)),
          }))
        } catch {
          set({ columns: prev })
        }
      },
    }),
    { name: 'column-store' },
  ),
)
