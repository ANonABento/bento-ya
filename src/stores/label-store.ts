import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Label } from '@/types'
import * as ipc from '@/lib/ipc'

type LabelState = {
  labels: Label[]
  taskLabels: Record<string, string[]>
  selectedLabelId: string | null
  loaded: boolean
  load: (workspaceId: string) => Promise<void>
  create: (workspaceId: string, name: string, color: string) => Promise<Label>
  update: (id: string, updates: { name?: string; color?: string }) => Promise<Label>
  remove: (id: string) => Promise<void>
  setTaskLabels: (taskId: string, labelIds: string[]) => Promise<void>
  setSelectedLabelId: (id: string | null) => void
  getTaskLabels: (taskId: string) => Label[]
}

function groupAssignments(assignments: { taskId: string; labelId: string }[]) {
  return assignments.reduce<Record<string, string[]>>((acc, assignment) => {
    acc[assignment.taskId] = [...(acc[assignment.taskId] ?? []), assignment.labelId]
    return acc
  }, {})
}

export const useLabelStore = create<LabelState>()(
  devtools(
    (set, get) => ({
      labels: [],
      taskLabels: {},
      selectedLabelId: null,
      loaded: false,

      load: async (workspaceId) => {
        const [labels, assignments] = await Promise.all([
          ipc.getLabels(workspaceId),
          ipc.getTaskLabelAssignments(workspaceId),
        ])
        set((s) => ({
          labels,
          taskLabels: groupAssignments(assignments),
          selectedLabelId: labels.some((label) => label.id === s.selectedLabelId)
            ? s.selectedLabelId
            : null,
          loaded: true,
        }))
      },

      create: async (workspaceId, name, color) => {
        const label = await ipc.createLabel(workspaceId, name, color)
        set((s) => ({ labels: [...s.labels, label].sort((a, b) => a.name.localeCompare(b.name)) }))
        return label
      },

      update: async (id, updates) => {
        const label = await ipc.updateLabel(id, updates)
        set((s) => ({
          labels: s.labels
            .map((item) => (item.id === id ? label : item))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }))
        return label
      },

      remove: async (id) => {
        await ipc.deleteLabel(id)
        set((s) => {
          const taskLabels = Object.fromEntries(
            Object.entries(s.taskLabels).map(([taskId, labelIds]) => [
              taskId,
              labelIds.filter((labelId) => labelId !== id),
            ]),
          )
          return {
            labels: s.labels.filter((label) => label.id !== id),
            taskLabels,
            selectedLabelId: s.selectedLabelId === id ? null : s.selectedLabelId,
          }
        })
      },

      setTaskLabels: async (taskId, labelIds) => {
        const previousIds = get().taskLabels[taskId] ?? []
        const optimisticIds = [...new Set(labelIds)]
        set((s) => ({ taskLabels: { ...s.taskLabels, [taskId]: optimisticIds } }))
        try {
          const nextIds = await ipc.setTaskLabels(taskId, optimisticIds)
          set((s) => ({ taskLabels: { ...s.taskLabels, [taskId]: nextIds } }))
        } catch (error) {
          set((s) => ({ taskLabels: { ...s.taskLabels, [taskId]: previousIds } }))
          throw error
        }
      },

      setSelectedLabelId: (id) => {
        set({ selectedLabelId: id })
      },

      getTaskLabels: (taskId) => {
        const ids = new Set(get().taskLabels[taskId] ?? [])
        return get().labels.filter((label) => ids.has(label.id))
      },
    }),
    { name: 'label-store' },
  ),
)
