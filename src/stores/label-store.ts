import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Label } from '@/types'
import * as ipc from '@/lib/ipc'

type LabelState = {
  labels: Label[]
  loaded: boolean
  load: (workspaceId: string) => Promise<void>
  add: (workspaceId: string, name: string, color: string) => Promise<Label>
  update: (id: string, updates: { name?: string; color?: string }) => Promise<Label>
  remove: (id: string) => Promise<void>
}

export const useLabelStore = create<LabelState>()(
  devtools(
    (set, get) => ({
      labels: [],
      loaded: false,

      load: async (workspaceId) => {
        const labels = await ipc.getLabels(workspaceId)
        set({ labels, loaded: true })
      },

      add: async (workspaceId, name, color) => {
        const label = await ipc.createLabel(workspaceId, name, color)
        set((s) => ({ labels: [...s.labels, label].sort(sortLabels) }))
        return label
      },

      update: async (id, updates) => {
        const label = await ipc.updateLabel(id, updates)
        set((s) => ({
          labels: s.labels.map((current) => current.id === id ? label : current).sort(sortLabels),
        }))
        return label
      },

      remove: async (id) => {
        const previous = get().labels
        set((s) => ({ labels: s.labels.filter((label) => label.id !== id) }))
        try {
          await ipc.deleteLabel(id)
        } catch {
          set({ labels: previous })
        }
      },
    }),
    { name: 'label-store' },
  ),
)

function sortLabels(a: Label, b: Label) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}
