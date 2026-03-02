import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

type ViewMode = 'board' | 'split'

type ModalState = {
  type: string
  props?: Record<string, unknown>
} | null

// Panel constants
const DEFAULT_PANEL_HEIGHT = 300
const MIN_PANEL_HEIGHT = 150
const MAX_PANEL_HEIGHT = 600

type UIState = {
  viewMode: ViewMode
  activeTaskId: string | null
  modal: ModalState

  // Orchestrator panel state
  panelHeight: number
  isPanelCollapsed: boolean

  setViewMode: (mode: ViewMode) => void
  openTask: (taskId: string) => void
  closeTask: () => void
  openModal: (type: string, props?: Record<string, unknown>) => void
  closeModal: () => void

  // Panel actions
  setPanelHeight: (height: number) => void
  togglePanel: () => void
  collapsePanel: () => void
  expandPanel: () => void
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        viewMode: 'board',
        activeTaskId: null,
        modal: null,
        panelHeight: DEFAULT_PANEL_HEIGHT,
        isPanelCollapsed: false,

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

        setPanelHeight: (height) => {
          const clamped = Math.min(Math.max(height, MIN_PANEL_HEIGHT), MAX_PANEL_HEIGHT)
          set({ panelHeight: clamped })
        },

        togglePanel: () => {
          set((state) => ({ isPanelCollapsed: !state.isPanelCollapsed }))
        },

        collapsePanel: () => {
          set({ isPanelCollapsed: true })
        },

        expandPanel: () => {
          set({ isPanelCollapsed: false })
        },
      }),
      {
        name: 'bento-ya-ui',
        partialize: (state) => ({
          panelHeight: state.panelHeight,
          isPanelCollapsed: state.isPanelCollapsed,
        }),
      },
    ),
    { name: 'ui-store' },
  ),
)

export { MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT, DEFAULT_PANEL_HEIGHT }
