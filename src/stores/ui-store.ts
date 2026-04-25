import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

type ViewMode = 'board' | 'chat'
type PanelDock = 'bottom' | 'right'
type AgentPanelDock = 'right' | 'left'
type PanelView = 'chat' | 'detail'

type ModalState = {
  type: string
  props?: Record<string, unknown>
} | null

type ChatPanelState = Pick<UIState, 'activeTaskId' | 'viewMode'>

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
const MAX_AGENT_PANEL_WIDTH = 900

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function openChatState(taskId: string): ChatPanelState {
  return { viewMode: 'chat', activeTaskId: taskId }
}

function closeChatState(): ChatPanelState {
  return { viewMode: 'board', activeTaskId: null }
}

function getMaxAgentPanelWidth(): number {
  if (typeof window === 'undefined') return MAX_AGENT_PANEL_WIDTH
  const viewportMax = Math.floor(window.innerWidth - MIN_BOARD_WIDTH)
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

  // Panel view (terminal vs detail) — routed inside the agent side panel
  panelView: PanelView
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

  // Panel view actions
  setPanelView: (view: PanelView) => void
  togglePanelView: () => void
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
        panelDock: 'bottom',
        isPanelCollapsed: false,
        agentPanelWidth: DEFAULT_AGENT_PANEL_WIDTH,
        agentPanelDock: 'right' as AgentPanelDock,
        panelView: 'chat' as PanelView,

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
          set(openChatState(taskId))
        },

        closeChat: () => {
          set(closeChatState())
        },

        // Deprecated aliases
        openTask: (taskId) => { set(openChatState(taskId)) },
        closeTask: () => { set(closeChatState()) },

        openModal: (type, props) => {
          set({ modal: { type, props } })
        },

        closeModal: () => {
          set({ modal: null })
        },

        setPanelHeight: (height) => {
          const max = getMaxPanelHeight()
          set({ panelHeight: clamp(height, MIN_PANEL_HEIGHT, max) })
        },

        setPanelWidth: (width) => {
          const max = getMaxPanelWidth()
          set({ panelWidth: clamp(width, MIN_PANEL_WIDTH, max) })
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
          set({ agentPanelWidth: clamp(width, MIN_AGENT_PANEL_WIDTH, max) })
        },

        setAgentPanelDock: (dock) => {
          set({ agentPanelDock: dock })
        },

        setPanelView: (view) => {
          set({ panelView: view })
        },

        togglePanelView: () => {
          set((state) => ({ panelView: state.panelView === 'chat' ? 'detail' : 'chat' }))
        },
      }),
      {
        name: 'bento-ya-ui',
        partialize: (state) => ({
          panelHeight: state.panelHeight,
          panelWidth: state.panelWidth,
          panelDock: state.panelDock,
          isPanelCollapsed: state.isPanelCollapsed,
          agentPanelWidth: state.agentPanelWidth,
          agentPanelDock: state.agentPanelDock,
          panelView: state.panelView,
        }),
      },
    ),
    { name: 'ui-store' },
  ),
)

export { MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT, DEFAULT_PANEL_HEIGHT, MIN_BOARD_HEIGHT }
export { MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, DEFAULT_PANEL_WIDTH, MIN_BOARD_WIDTH }
export { MIN_AGENT_PANEL_WIDTH, MAX_AGENT_PANEL_WIDTH, DEFAULT_AGENT_PANEL_WIDTH }
export type { PanelDock, AgentPanelDock, PanelView }
