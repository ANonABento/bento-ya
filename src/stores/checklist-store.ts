import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type {
  Checklist,
  ChecklistCategory,
  ChecklistItem,
  ChecklistTemplate,
} from '@/types/checklist'
import { BUILT_IN_CHECKLIST_TEMPLATES } from '@/types/checklist'

type ChecklistState = {
  checklist: Checklist | null
  categories: ChecklistCategory[]
  items: Record<string, ChecklistItem[]> // categoryId -> items
  isOpen: boolean
  isLoading: boolean

  // Actions
  openChecklist: () => void
  closeChecklist: () => void
  setChecklist: (checklist: Checklist | null) => void
  setCategories: (categories: ChecklistCategory[]) => void
  setItems: (categoryId: string, items: ChecklistItem[]) => void
  toggleItem: (itemId: string, categoryId: string) => void
  toggleCategory: (categoryId: string) => void
  updateItemNotes: (itemId: string, categoryId: string, notes: string | null) => void
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

      openChecklist: () => set({ isOpen: true }),
      closeChecklist: () => set({ isOpen: false }),

      setChecklist: (checklist) => set({ checklist }),
      setCategories: (categories) => set({ categories }),

      setItems: (categoryId, items) => {
        set((state) => ({
          items: { ...state.items, [categoryId]: items },
        }))
      },

      toggleItem: (itemId, categoryId) => {
        set((state) => {
          const categoryItems = state.items[categoryId] ?? []
          const updatedItems = categoryItems.map((item) =>
            item.id === itemId ? { ...item, checked: !item.checked } : item
          )
          return {
            items: { ...state.items, [categoryId]: updatedItems },
          }
        })
      },

      toggleCategory: (categoryId) => {
        set((state) => ({
          categories: state.categories.map((cat) =>
            cat.id === categoryId ? { ...cat, collapsed: !cat.collapsed } : cat
          ),
        }))
      },

      updateItemNotes: (itemId, categoryId, notes) => {
        set((state) => {
          const categoryItems = state.items[categoryId] ?? []
          const updatedItems = categoryItems.map((item) =>
            item.id === itemId ? { ...item, notes } : item
          )
          return {
            items: { ...state.items, [categoryId]: updatedItems },
          }
        })
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
