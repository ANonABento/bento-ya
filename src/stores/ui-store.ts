import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

type ViewMode = 'board' | 'chat'
type PanelDock = 'bottom' | 'right'

type ModalState = {
  type: string
  props?: Record<string, unknown>
} | null

// Panel constants
const DEFAULT_PANEL_HEIGHT = 300
const MIN_PANEL_HEIGHT = 150
const MAX_PANEL_HEIGHT = 600 // absolute max, also clamped to leave MIN_BOARD_HEIGHT
const MIN_BOARD_HEIGHT = 200 // board always gets at least this much space

// Right-dock panel constants
const DEFAULT_PANEL_WIDTH = 400
const MIN_PANEL_WIDTH = 300
const MAX_PANEL_WIDTH = 800
const MIN_BOARD_WIDTH = 400

/** Get the effective max panel height based on current viewport */
function getMaxPanelHeight(): number {
  if (typeof window === 'undefined') return MAX_PANEL_HEIGHT
  const viewportMax = Math.floor(window.innerHeight - MIN_BOARD_HEIGHT)
  return Math.min(MAX_PANEL_HEIGHT, viewportMax)
}

/** Get the effective max panel width based on current viewport */
function getMaxPanelWidth(): number {
  if (typeof window === 'undefined') return MAX_PANEL_WIDTH
  const viewportMax = Math.floor(window.innerWidth - MIN_BOARD_WIDTH)
  return Math.min(MAX_PANEL_WIDTH, viewportMax)
}

type UIState = {
  viewMode: ViewMode
  activeTaskId: string | null // task whose chat panel is open
  expandedTaskId: string | null // task card expanded inline
  modal: ModalState

  // Orchestrator panel state
  panelHeight: number
  panelWidth: number
  panelDock: PanelDock
  isPanelCollapsed: boolean

  setViewMode: (mode: ViewMode) => void
  expandTask: (taskId: string) => void
  focusTask: (taskId: string) => void
  collapseTask: () => void
  openChat: (taskId: string) => void
  closeChat: () => void
  /** @deprecated Use openChat — kept for backward compat */
  openTask: (taskId: string) => void
  /** @deprecated Use closeChat — kept for backward compat */
  closeTask: () => void
  openModal: (type: string, props?: Record<string, unknown>) => void
  closeModal: () => void

  // Panel actions
  setPanelHeight: (height: number) => void
  setPanelWidth: (width: number) => void
  setPanelDock: (dock: PanelDock) => void
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
        expandedTaskId: null,
        modal: null,
        panelHeight: DEFAULT_PANEL_HEIGHT,
        panelWidth: DEFAULT_PANEL_WIDTH,
        panelDock: 'bottom' as PanelDock,
        isPanelCollapsed: false,

        setViewMode: (mode) => {
          set({ viewMode: mode })
        },

        // Card expansion (inline detail)
        expandTask: (taskId) => {
          set((state) => ({
            expandedTaskId: state.expandedTaskId === taskId ? null : taskId,
          }))
        },

        focusTask: (taskId) => {
          set({ expandedTaskId: taskId })
        },

        collapseTask: () => {
          set({ expandedTaskId: null })
        },

        // Chat panel (right slide-in)
        openChat: (taskId) => {
          set({ viewMode: 'chat', activeTaskId: taskId })
        },

        closeChat: () => {
          set({ viewMode: 'board', activeTaskId: null })
        },

        // Deprecated aliases
        openTask: (taskId) => { set({ viewMode: 'chat', activeTaskId: taskId }) },
        closeTask: () => { set({ viewMode: 'board', activeTaskId: null }) },

        openModal: (type, props) => {
          set({ modal: { type, props } })
        },

        closeModal: () => {
          set({ modal: null })
        },

        setPanelHeight: (height) => {
          const max = getMaxPanelHeight()
          const clamped = Math.min(Math.max(height, MIN_PANEL_HEIGHT), max)
          set({ panelHeight: clamped })
        },

        setPanelWidth: (width) => {
          const max = getMaxPanelWidth()
          const clamped = Math.min(Math.max(width, MIN_PANEL_WIDTH), max)
          set({ panelWidth: clamped })
        },

        setPanelDock: (dock) => {
          set({ panelDock: dock })
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
          panelWidth: state.panelWidth,
          panelDock: state.panelDock,
          isPanelCollapsed: state.isPanelCollapsed,
        }),
      },
    ),
    { name: 'ui-store' },
  ),
)

export { MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT, DEFAULT_PANEL_HEIGHT, MIN_BOARD_HEIGHT }
export { MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, DEFAULT_PANEL_WIDTH, MIN_BOARD_WIDTH }
export type { PanelDock }
