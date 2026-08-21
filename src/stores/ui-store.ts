import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

type ViewMode = 'board' | 'chat'

/**
 * Top-level app section selected in the left nav rail.
 *
 * Deliberately separate from `ViewMode`, which despite its name means "is the
 * per-task chat panel open" and is load-bearing via
 * `isChatOpen = viewMode === 'chat'` (use-chat-panel.ts). Widening ViewMode
 * would entangle "which section" with "is the chat open".
 *
 * `orchestrator` is intentionally absent: it is still a dock panel inside the
 * board with its own geometry, not a section. See KAITEN_AGENTS.md.
 */
export type AppSection = 'board' | 'roster' 
type PanelDock = 'bottom' | 'right'
type AgentPanelDock = 'right' | 'left'

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

// Agent panel constants
const DEFAULT_AGENT_PANEL_WIDTH = 500
const MIN_AGENT_PANEL_WIDTH = 300
const MAX_AGENT_PANEL_WIDTH = 2400
const MIN_BOARD_WIDTH_WITH_AGENT_PANEL = 300
const UI_STORAGE_KEY = 'kaitencode-ui'
const LEGACY_UI_STORAGE_KEY = 'bento-ya-ui'

if (typeof window !== 'undefined') {
  const legacyValue = window.localStorage.getItem(LEGACY_UI_STORAGE_KEY)
  if (legacyValue && !window.localStorage.getItem(UI_STORAGE_KEY)) {
    window.localStorage.setItem(UI_STORAGE_KEY, legacyValue)
    window.localStorage.removeItem(LEGACY_UI_STORAGE_KEY)
  }
}

function getMaxAgentPanelWidth(): number {
  if (typeof window === 'undefined') return MAX_AGENT_PANEL_WIDTH
  const viewportMax = Math.floor(window.innerWidth - MIN_BOARD_WIDTH_WITH_AGENT_PANEL)
  return Math.min(MAX_AGENT_PANEL_WIDTH, viewportMax)
}

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
  /** Which top-level section the nav rail has selected. */
  activeSection: AppSection
  activeTaskId: string | null // task whose chat panel is open
  expandedTaskId: string | null // task card expanded inline
  modal: ModalState

  // Orchestrator panel state
  panelHeight: number
  panelWidth: number
  panelDock: PanelDock
  isPanelCollapsed: boolean

  // Agent chat panel state
  agentPanelWidth: number
  agentPanelDock: AgentPanelDock
  setViewMode: (mode: ViewMode) => void
  setActiveSection: (section: AppSection) => void
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

  // Orchestrator panel actions
  setPanelHeight: (height: number) => void
  setPanelWidth: (width: number) => void
  setPanelDock: (dock: PanelDock) => void
  togglePanel: () => void
  collapsePanel: () => void
  expandPanel: () => void

  // Agent panel actions
  setAgentPanelWidth: (width: number) => void
  setAgentPanelDock: (dock: AgentPanelDock) => void
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        viewMode: 'board',
        activeSection: 'board' as AppSection,
        activeTaskId: null,
        expandedTaskId: null,
        modal: null,
        panelHeight: DEFAULT_PANEL_HEIGHT,
        panelWidth: DEFAULT_PANEL_WIDTH,
        panelDock: 'bottom' as PanelDock,
        isPanelCollapsed: false,
        agentPanelWidth: DEFAULT_AGENT_PANEL_WIDTH,
        agentPanelDock: 'right' as AgentPanelDock,

        setViewMode: (mode) => {
          set({ viewMode: mode })
        },

        setActiveSection: (section) => {
          set({ activeSection: section })
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
          set((state) => ({
            viewMode: 'chat',
            activeTaskId: taskId,
            agentPanelWidth: Math.min(state.agentPanelWidth, getMaxAgentPanelWidth()),
          }))
        },

        closeChat: () => {
          set({ viewMode: 'board', activeTaskId: null })
        },

        // Deprecated aliases
        openTask: (taskId) => {
          set((state) => ({
            viewMode: 'chat',
            activeTaskId: taskId,
            agentPanelWidth: Math.min(state.agentPanelWidth, getMaxAgentPanelWidth()),
          }))
        },
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

        setAgentPanelWidth: (width) => {
          const max = getMaxAgentPanelWidth()
          const clamped = Math.min(Math.max(width, MIN_AGENT_PANEL_WIDTH), max)
          set({ agentPanelWidth: clamped })
        },

        setAgentPanelDock: (dock) => {
          set({ agentPanelDock: dock })
        },
      }),
      {
        name: UI_STORAGE_KEY,
        partialize: (state) => ({
          activeSection: state.activeSection,
          panelHeight: state.panelHeight,
          panelWidth: state.panelWidth,
          panelDock: state.panelDock,
          isPanelCollapsed: state.isPanelCollapsed,
          agentPanelWidth: state.agentPanelWidth,
          agentPanelDock: state.agentPanelDock,
        }),
      },
    ),
    { name: 'ui-store' },
  ),
)

export { MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT, DEFAULT_PANEL_HEIGHT, MIN_BOARD_HEIGHT }
export { MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, DEFAULT_PANEL_WIDTH, MIN_BOARD_WIDTH }
export { MIN_AGENT_PANEL_WIDTH, MAX_AGENT_PANEL_WIDTH, DEFAULT_AGENT_PANEL_WIDTH }
export type { PanelDock, AgentPanelDock }
