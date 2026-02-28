import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

type ViewMode = 'board' | 'split'

type ModalState = {
  type: string
  props?: Record<string, unknown>
} | null

type UIState = {
  viewMode: ViewMode
  activeTaskId: string | null
  modal: ModalState

  setViewMode: (mode: ViewMode) => void
  openTask: (taskId: string) => void
  closeTask: () => void
  openModal: (type: string, props?: Record<string, unknown>) => void
  closeModal: () => void
}

export const useUIStore = create<UIState>()(
  devtools(
    (set) => ({
      viewMode: 'board',
      activeTaskId: null,
      modal: null,

      setViewMode: (mode) => {
        set({ viewMode: mode })
      },

      openTask: (taskId) => {
        set({ viewMode: 'split', activeTaskId: taskId })
      },

      closeTask: () => {
        set({ viewMode: 'board', activeTaskId: null })
      },

      openModal: (type, props) => {
        set({ modal: { type, props } })
      },

      closeModal: () => {
        set({ modal: null })
      },
    }),
    { name: 'ui-store' },
  ),
)
