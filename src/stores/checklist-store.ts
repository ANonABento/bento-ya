import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type {
  Checklist,
  ChecklistCategory,
  ChecklistItem,
  ChecklistTemplate,
} from '@/types/checklist'
import { BUILT_IN_CHECKLIST_TEMPLATES } from '@/types/checklist'
import * as ipc from '@/lib/ipc'

// Debounce timers for notes updates
const notesDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const NOTES_DEBOUNCE_MS = 500

type ChecklistState = {
  checklist: Checklist | null
  categories: ChecklistCategory[]
  items: Record<string, ChecklistItem[]> // categoryId -> items
  isOpen: boolean
  isLoading: boolean
  currentWorkspaceId: string | null

  // Actions
  openChecklist: () => void
  closeChecklist: () => void
  setChecklist: (checklist: Checklist | null) => void
  setCategories: (categories: ChecklistCategory[]) => void
  setItems: (categoryId: string, items: ChecklistItem[]) => void
  loadChecklist: (workspaceId: string) => Promise<void>
  toggleItem: (itemId: string, categoryId: string) => void
  toggleCategory: (categoryId: string) => void
  updateItemNotes: (itemId: string, categoryId: string, notes: string | null) => void
  createChecklist: (
    workspaceId: string,
    template: ChecklistTemplate,
  ) => Promise<void>
  deleteChecklist: (workspaceId: string) => Promise<void>
  getProgress: () => { progress: number; total: number; percentage: number }
  getTemplates: () => ChecklistTemplate[]
}

export const useChecklistStore = create<ChecklistState>()(
  devtools(
    (set, get) => ({
      checklist: null,
      categories: [],
      items: {},
      isOpen: false,
      isLoading: false,
      currentWorkspaceId: null,

      openChecklist: () => { set({ isOpen: true }); },
      closeChecklist: () => { set({ isOpen: false }); },

      setChecklist: (checklist) => { set({ checklist }); },
      setCategories: (categories) => { set({ categories }); },

      setItems: (categoryId, items) => {
        set((state) => ({
          items: { ...state.items, [categoryId]: items },
        }))
      },

      loadChecklist: async (workspaceId: string) => {
        set({ isLoading: true, currentWorkspaceId: workspaceId })
        try {
          const data = await ipc.getWorkspaceChecklist(workspaceId)

          // Map IPC types to store types
          const checklist: Checklist | null = data.checklist
            ? {
                id: data.checklist.id,
                workspaceId: data.checklist.workspaceId,
                name: data.checklist.name,
                description: data.checklist.description,
                progress: data.checklist.progress,
                totalItems: data.checklist.totalItems,
                createdAt: data.checklist.createdAt,
                updatedAt: data.checklist.updatedAt,
              }
            : null

          const categories: ChecklistCategory[] = data.categories.map((cat) => ({
            id: cat.id,
            checklistId: cat.checklistId,
            name: cat.name,
            icon: cat.icon,
            position: cat.position,
            progress: cat.progress,
            totalItems: cat.totalItems,
            collapsed: cat.collapsed,
          }))

          const items: Record<string, ChecklistItem[]> = {}
          for (const [catId, catItems] of Object.entries(data.items)) {
            items[catId] = catItems.map((item) => ({
              id: item.id,
              categoryId: item.categoryId,
              text: item.text,
              checked: item.checked,
              notes: item.notes,
              position: item.position,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            }))
          }

          set({
            checklist,
            categories,
            items,
            isLoading: false,
          })
        } catch (error) {
          console.error('Failed to load checklist:', error)
          set({ isLoading: false })
        }
      },

      toggleItem: (itemId, categoryId) => {
        const state = get()
        const categoryItems = state.items[categoryId] ?? []
        const item = categoryItems.find((i) => i.id === itemId)
        if (!item) return

        const newChecked = !item.checked

        // Optimistic update
        set((s) => {
          const updatedItems = (s.items[categoryId] ?? []).map((i) =>
            i.id === itemId ? { ...i, checked: newChecked } : i
          )
          return {
            items: { ...s.items, [categoryId]: updatedItems },
          }
        })

        // Persist to backend
        ipc.updateChecklistItem(itemId, newChecked, undefined).catch((error) => {
          console.error('Failed to persist item toggle:', error)
          // Revert on error
          set((s) => {
            const revertedItems = (s.items[categoryId] ?? []).map((i) =>
              i.id === itemId ? { ...i, checked: !newChecked } : i
            )
            return {
              items: { ...s.items, [categoryId]: revertedItems },
            }
          })
        })
      },

      toggleCategory: (categoryId) => {
        const state = get()
        const category = state.categories.find((c) => c.id === categoryId)
        if (!category) return

        const newCollapsed = !category.collapsed

        // Optimistic update
        set((s) => ({
          categories: s.categories.map((cat) =>
            cat.id === categoryId ? { ...cat, collapsed: newCollapsed } : cat
          ),
        }))

        // Persist to backend
        ipc.updateChecklistCategory(categoryId, newCollapsed).catch((error) => {
          console.error('Failed to persist category toggle:', error)
          // Revert on error
          set((s) => ({
            categories: s.categories.map((cat) =>
              cat.id === categoryId ? { ...cat, collapsed: !newCollapsed } : cat
            ),
          }))
        })
      },

      updateItemNotes: (itemId, categoryId, notes) => {
        // Optimistic update
        set((state) => {
          const categoryItems = state.items[categoryId] ?? []
          const updatedItems = categoryItems.map((item) =>
            item.id === itemId ? { ...item, notes } : item
          )
          return {
            items: { ...state.items, [categoryId]: updatedItems },
          }
        })

        // Debounced persist to backend
        const timerKey = `${categoryId}:${itemId}`
        if (notesDebounceTimers[timerKey]) {
          clearTimeout(notesDebounceTimers[timerKey])
        }

        notesDebounceTimers[timerKey] = setTimeout(() => {
          delete notesDebounceTimers[timerKey]
          ipc.updateChecklistItem(itemId, undefined, notes).catch((error) => {
            console.error('Failed to persist item notes:', error)
          })
        }, NOTES_DEBOUNCE_MS)
      },

      createChecklist: async (workspaceId: string, template: ChecklistTemplate) => {
        set({ isLoading: true })
        try {
          // Convert template to IPC format
          const categories: ipc.TemplateCategory[] = template.categories.map((cat) => ({
            name: cat.name,
            icon: cat.icon,
            items: cat.items.map((item) => ({ text: item.text })),
          }))

          await ipc.createWorkspaceChecklist(
            workspaceId,
            template.name,
            template.description,
            categories,
          )

          // Reload to get the created checklist
          await get().loadChecklist(workspaceId)
        } catch (error) {
          console.error('Failed to create checklist:', error)
          set({ isLoading: false })
          throw error
        }
      },

      deleteChecklist: async (workspaceId: string) => {
        set({ isLoading: true })
        try {
          await ipc.deleteWorkspaceChecklist(workspaceId)
          set({
            checklist: null,
            categories: [],
            items: {},
            isLoading: false,
          })
        } catch (error) {
          console.error('Failed to delete checklist:', error)
          set({ isLoading: false })
          throw error
        }
      },

      getProgress: () => {
        const { items } = get()
        let progress = 0
        let total = 0

        for (const categoryItems of Object.values(items)) {
          for (const item of categoryItems) {
            total++
            if (item.checked) progress++
          }
        }

        return {
          progress,
          total,
          percentage: total > 0 ? Math.round((progress / total) * 100) : 0,
        }
      },

      getTemplates: () => BUILT_IN_CHECKLIST_TEMPLATES,
    }),
    { name: 'checklist-store' },
  ),
)
