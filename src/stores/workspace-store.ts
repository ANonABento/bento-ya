import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Workspace } from '@/types'
import * as ipc from '@/lib/ipc'

type WorkspaceState = {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  loaded: boolean

  load: () => Promise<void>
  refreshWorkspace: (id: string) => Promise<void>
  setActive: (id: string) => void
  add: (name: string, repoPath: string) => Promise<void>
  clone: (sourceId: string, newName: string) => Promise<void>
  remove: (id: string) => Promise<void>
  update: (id: string, updates: Partial<Workspace>) => Promise<void>
  reorder: (ids: string[]) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>()(
  devtools(
    (set, get) => ({
      workspaces: [],
      activeWorkspaceId: null,
      loaded: false,

      load: async () => {
        const workspaces = await ipc.getWorkspaces()
        const active = workspaces.find((w) => w.isActive) ?? workspaces[0]
        set({ workspaces, activeWorkspaceId: active?.id ?? null, loaded: true })
      },

      refreshWorkspace: async (id) => {
        const workspace = await ipc.getWorkspace(id)
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === id ? workspace : w)),
        }))
      },

      setActive: (id) => {
        set({ activeWorkspaceId: id })
      },

      add: async (name, repoPath) => {
        const workspace = await ipc.createWorkspace(name, repoPath)
        set((s) => ({ workspaces: [...s.workspaces, workspace] }))
      },

      clone: async (sourceId, newName) => {
        const workspace = await ipc.cloneWorkspace(sourceId, newName)
        set((s) => ({
          workspaces: [...s.workspaces, workspace],
          activeWorkspaceId: workspace.id,
        }))
      },

      remove: async (id) => {
        const prev = get().workspaces
        set((s) => ({
          workspaces: s.workspaces.filter((w) => w.id !== id),
          activeWorkspaceId:
            s.activeWorkspaceId === id
              ? (s.workspaces.find((w) => w.id !== id)?.id ?? null)
              : s.activeWorkspaceId,
        }))
        try {
          await ipc.deleteWorkspace(id)
        } catch {
          set({ workspaces: prev })
        }
      },

      update: async (id, updates) => {
        const prev = get().workspaces
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === id ? { ...w, ...updates, updatedAt: new Date().toISOString() } : w,
          ),
        }))
        try {
          await ipc.updateWorkspace(id, updates)
        } catch {
          set({ workspaces: prev })
        }
      },

      reorder: async (ids) => {
        const prev = get().workspaces
        set((s) => ({
          workspaces: ids
            .map((id, i) => {
              const w = s.workspaces.find((ws) => ws.id === id)
              return w ? { ...w, tabOrder: i } : undefined
            })
            .filter((w): w is Workspace => w !== undefined),
        }))
        try {
          await ipc.reorderWorkspaces(ids)
        } catch {
          set({ workspaces: prev })
        }
      },
    }),
    { name: 'workspace-store' },
  ),
)
