/**
 * Orchestrator Panel - Main chat interface for workspace-level orchestration.
 * Uses:
 * - useOrchestratorSessions for session management (create, switch, delete)
 * - useChatSession for chat logic (send, cancel, queue, streaming)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useUIStore } from '@/stores/ui-store'
import { useResizablePanel } from '@/hooks/use-resizable-panel'
import { ResizeHandle } from '@/components/shared/resize-handle'
import { useTaskStore } from '@/stores/task-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useOrchestratorSessions } from '@/hooks/use-orchestrator-sessions'
import { useChatSession } from '@/hooks/chat-session'
import { getChatHistory, listen, type ChatMessage } from '@/lib/ipc'
import { buildPromptWithAttachments } from '@/types'
import { useCliPath } from '@/hooks/use-cli-path'
import { ChatHistory } from './chat-history'
import { OrchestratorTerminalView } from './orchestrator-terminal-view'
import { killTaskSession } from '@/lib/ipc/agent'
import { chefSessionKey } from '@/lib/ipc/terminal'
import { WorkspaceFilesView } from './workspace-files-view'
import { PanelTabs, type PanelTab } from '@/components/shared/panel-tabs'
import { useElementWidth, panelDensity, PanelDensityContext } from '@/hooks/use-element-width'
import { ChatIcon, TerminalIcon, FilesIcon } from '@/components/shared/tab-icons'

type OrchestratorView = 'chat' | 'terminal' | 'files'
const ORCHESTRATOR_TABS: readonly PanelTab<OrchestratorView>[] = [
  { value: 'chat', label: 'Chat', icon: <ChatIcon />, testId: 'orchestrator-view-chat' },
  { value: 'terminal', label: 'Terminal', icon: <TerminalIcon />, testId: 'orchestrator-view-terminal' },
  { value: 'files', label: 'Files', icon: <FilesIcon />, testId: 'orchestrator-view-files' },
]
import { PanelSidebar } from './panel-sidebar'
import { PipelineDashboard } from './pipeline-dashboard'
import { PipelineV2Dashboard } from './pipeline-v2-dashboard'
import { ChatErrorBoundary } from './chat-error-boundary'
import { ErrorBanner, CliDetectingBanner, ChatInput, type ChatInputMessage, mapToolCalls } from './shared'

type OrchestratorPanelProps = {
  workspaceId: string
}

const COLLAPSED_HEIGHT = 40

export function OrchestratorPanel({ workspaceId }: OrchestratorPanelProps) {
  // UI stores
  const panelHeight = useUIStore((s) => s.panelHeight)
  const panelWidth = useUIStore((s) => s.panelWidth)
  const panelDock = useUIStore((s) => s.panelDock)
  const isPanelCollapsed = useUIStore((s) => s.isPanelCollapsed)
  const setPanelHeight = useUIStore((s) => s.setPanelHeight)
  const setPanelWidth = useUIStore((s) => s.setPanelWidth)
  const setPanelDock = useUIStore((s) => s.setPanelDock)
  const togglePanel = useUIStore((s) => s.togglePanel)
  const loadTasks = useTaskStore((s) => s.load)

  const isRightDock = panelDock === 'right'

  // Get settings for LLM connection
  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')
  const connectionMode = anthropicProvider?.connectionMode ?? 'cli'
  const { cliPath, isDetecting: cliDetecting, detectionError: cliDetectionError } = useCliPath()
  const apiKeyEnvVar = anthropicProvider?.apiKeyEnvVar || 'ANTHROPIC_API_KEY'
  const apiKey = settings.agent.envVars[apiKeyEnvVar] || undefined

  // Session management hook
  const {
    sessions,
    activeSession,
    isLoading: sessionsLoading,
    createSession,
    switchSession,
    deleteSession,
    refreshSessions,
    resetSession,
  } = useOrchestratorSessions(workspaceId)

  // Chat hook - uses activeSession?.id (may be undefined initially)
  const chat = useChatSession({
    mode: 'orchestrator',
    workspaceId,
    sessionId: activeSession?.id,
    connectionMode,
    cliPath,
    apiKey,
    apiKeyEnvVar,
    onError: (err) => {
      console.error('[OrchestratorPanel] Chat error:', err)
      setLocalError(err)
    },
    onToolResult: () => {
      void loadTasks(workspaceId)
    },
    onComplete: () => {
      void refreshSessions()
    },
  })

  // Shared resize hook
  const { handleMouseDown: handleResizeMouseDown, isDragging } = useResizablePanel({
    direction: isRightDock ? 'horizontal' : 'vertical',
    size: isRightDock ? panelWidth : panelHeight,
    onResize: isRightDock ? setPanelWidth : setPanelHeight,
    disabled: isPanelCollapsed,
  })

  // Measure the header so its tabs drop to icons and the Cmd+J hint hides at
  // narrow widths instead of overlapping the centered "Chef" title.
  const [headerRef, headerWidth] = useElementWidth()
  const headerDensity = panelDensity(headerWidth, { compactBelow: 480 })

  // Local UI state
  const [sidebarMode, setSidebarMode] = useState<'history' | 'dashboard' | 'v2-dashboard' | null>(null)
  const [viewMode, setViewMode] = useState<OrchestratorView>('chat')
  const [moreOpen, setMoreOpen] = useState(false)
  // Chef terminal shells (1-based). `+` adds one while the Terminal view is active.
  const [shells, setShells] = useState<number[]>([1])
  const [activeShell, setActiveShell] = useState(1)
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Single error surface: stream errors, send/spawn failures, and CLI-detection
  // all funnel into one banner (no separate retry/dismiss banner).
  const error = localError ?? chat.error ?? chat.failedMessage?.error ?? cliDetectionError
  useEffect(() => {
    if (chat.error) setLocalError(chat.error)
  }, [chat.error])

  const panelRef = useRef<HTMLDivElement>(null)

  // Load messages when active session changes
  useEffect(() => {
    if (!activeSession) {
      setLocalMessages([])
      return
    }
    setMessagesLoading(true)
    void getChatHistory(activeSession.id, 100)
      .then(setLocalMessages)
      .catch((err: unknown) => {
        console.error('[OrchestratorPanel] Failed to load messages:', err)
      })
      .finally(() => {
        setMessagesLoading(false)
      })
  }, [activeSession])

  // Sync chat hook messages with local messages
  useEffect(() => {
    if (chat.messages.length > 0) {
      setLocalMessages(chat.messages.map((m) => ({
        id: m.id,
        workspaceId,
        sessionId: activeSession?.id ?? null,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })))
    }
  }, [chat.messages, workspaceId, activeSession?.id])

  // Listen for task events to refresh board
  useEffect(() => {
    const unsubscribes: Array<() => void> = []

    const setupListeners = async () => {
      const unsubTaskCreated = await listen<{ workspace_id?: string }>('task:created', (payload) => {
        if (payload.workspace_id === workspaceId) {
          void loadTasks(workspaceId)
        }
      })
      unsubscribes.push(unsubTaskCreated)

      const unsubTaskUpdated = await listen<{ workspace_id?: string }>('task:updated', (payload) => {
        if (payload.workspace_id === workspaceId) {
          void loadTasks(workspaceId)
        }
      })
      unsubscribes.push(unsubTaskUpdated)

      const unsubTaskDeleted = await listen<{ workspace_id?: string }>('task:deleted', (payload) => {
        if (payload.workspace_id === workspaceId) {
          void loadTasks(workspaceId)
        }
      })
      unsubscribes.push(unsubTaskDeleted)
    }

    void setupListeners()

    return () => {
      unsubscribes.forEach((unsub) => { unsub() })
    }
  }, [workspaceId, loadTasks])

  // Keyboard shortcut: Cmd+J to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [togglePanel])

  // Header click handler (toggle panel)
  const handleHeaderClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    togglePanel()
  }, [togglePanel])

  // Re-clamp panel height on mount and window resize (prevent board from being squished)
  useEffect(() => {
    // Clamp on mount in case persisted value exceeds current viewport
    setPanelHeight(panelHeight)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- clamp once on mount

  useEffect(() => {
    const handleResize = () => {
      // Read latest values from store (avoids re-registering listener on every drag)
      const state = useUIStore.getState()
      setPanelHeight(state.panelHeight)
      setPanelWidth(state.panelWidth)
    }
    window.addEventListener('resize', handleResize)
    return () => { window.removeEventListener('resize', handleResize) }
  }, [setPanelHeight, setPanelWidth])

  // Clear error when user starts typing (like AgentPanel)
  const handleInputChange = useCallback(() => {
    if (error) {
      setLocalError(null)
      chat.clearError()
    }
  }, [error, chat])

  // Handlers
  const handleSendMessage = useCallback((message: ChatInputMessage) => {
    if (!chat.canSend) return
    // Build prompt with attachment references for CLI mode
    const prompt = buildPromptWithAttachments(message.content, message.attachments)
    void chat.sendMessage(prompt, message.model)
  }, [chat])

  const handleCancel = useCallback(async () => {
    await chat.cancel()
  }, [chat])

  const handleNewChat = useCallback(async () => {
    if (localMessages.length === 0) return
    try {
      if (activeSession) {
        await resetSession()
      }
      await createSession()
      setLocalMessages([])
    } catch (err) {
      console.error('[OrchestratorPanel] Failed to create new chat:', err)
    }
  }, [localMessages.length, activeSession, resetSession, createSession])

  const handleAddShell = useCallback(() => {
    setShells((prev) => {
      const next = (prev.length ? Math.max(...prev) : 0) + 1
      setActiveShell(next)
      return [...prev, next]
    })
  }, [])

  const handleCloseShell = useCallback((shell: number) => {
    setShells((prev) => {
      if (prev.length <= 1) return prev // never close the last shell
      const remaining = prev.filter((s) => s !== shell)
      setActiveShell((active) =>
        active === shell ? (remaining[remaining.length - 1] ?? active) : active,
      )
      // Kill the underlying tmux session (chef shells are user-driven, no pipeline).
      void killTaskSession(chefSessionKey(workspaceId, shell)).catch(() => {})
      return remaining
    })
  }, [workspaceId])

  // The `+` button is context-aware: it acts on whichever view is active.
  const handlePlus = useCallback(() => {
    if (viewMode === 'terminal') {
      handleAddShell()
    } else {
      void handleNewChat()
    }
  }, [viewMode, handleAddShell, handleNewChat])

  // `+` is shown on Chat (new chat) and Terminal (new shell); hidden on Files.
  const plusVisible = viewMode !== 'files'
  const plusDisabled = viewMode === 'chat' && localMessages.length === 0
  const plusTitle = viewMode === 'terminal' ? 'New shell' : 'New chat'

  const handleSelectSession = useCallback((session: typeof activeSession) => {
    if (!session) return
    switchSession(session)
  }, [switchSession])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await deleteSession(sessionId)
    } catch (err) {
      console.error('[OrchestratorPanel] Failed to delete session:', err)
    }
  }, [deleteSession])

  const displayHeight = isPanelCollapsed ? COLLAPSED_HEIGHT : (isRightDock ? undefined : panelHeight)
  const displayWidth = isPanelCollapsed ? COLLAPSED_HEIGHT : (isRightDock ? panelWidth : undefined)
  const isLoading = sessionsLoading || messagesLoading
  const isProcessing = chat.streaming.isStreaming

  const toolCalls = mapToolCalls(chat.streaming.toolCalls, workspaceId)

  return (
    <div className={`relative ${isRightDock ? 'flex h-full' : ''}`}>
      {/* Resize handle */}
      {!isPanelCollapsed && (
        <ResizeHandle
          direction={isRightDock ? 'horizontal' : 'vertical'}
          position={isRightDock ? 'left' : 'top'}
          onMouseDown={handleResizeMouseDown}
        />
      )}

      <motion.div
        ref={panelRef}
        initial={false}
        animate={isRightDock
          ? { width: isPanelCollapsed ? COLLAPSED_HEIGHT : displayWidth }
          : { height: displayHeight }
        }
        transition={isDragging ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }}
        className={`flex flex-col bg-surface overflow-hidden ${
          isRightDock ? 'border-l border-border-default h-full' : 'border-t border-border-default'
        }`}
        style={isRightDock
          ? { minWidth: COLLAPSED_HEIGHT }
          : { minHeight: COLLAPSED_HEIGHT }
        }
      >

      {/* Header - clickable to toggle. */}
      <PanelDensityContext.Provider value={headerDensity}>
      <div
        ref={headerRef}
        onClick={handleHeaderClick}
        role="button"
        aria-label={isPanelCollapsed ? 'Expand orchestrator panel' : 'Collapse orchestrator panel'}
        aria-expanded={!isPanelCollapsed}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            togglePanel()
          }
        }}
        className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 select-none transition-colors ${
          isPanelCollapsed ? 'hover:bg-surface-hover/60' : 'border-b border-border-default'
        }`}
        style={{ cursor: 'pointer' }}
      >
        {/* Left: view tabs first, then a ⋯ that reveals sidebar toggles */}
        <div className="flex min-w-0 items-center gap-1.5 justify-self-start">
          {!isPanelCollapsed && (
            <>
              <PanelTabs
                responsive
                aria-label="Orchestrator views"
                value={viewMode}
                onChange={setViewMode}
                tabs={ORCHESTRATOR_TABS}
              />
              <div className="h-4 w-px shrink-0 bg-border-default" aria-hidden="true" />
              <button
                type="button"
                onClick={() => { setMoreOpen((v) => !v) }}
                aria-label={moreOpen ? 'Hide more options' : 'More options'}
                aria-pressed={moreOpen}
                title="More"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
                  moreOpen
                    ? 'bg-surface-hover text-text-primary'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
                style={{ cursor: 'pointer' }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                  <path d="M5 10a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0ZM11.25 10a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0ZM16.25 11.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" />
                </svg>
              </button>
              <AnimatePresence initial={false}>
                {moreOpen && (
                  <motion.div
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 'auto', opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="flex shrink-0 items-center gap-1 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => { setSidebarMode(sidebarMode === 'history' ? null : 'history') }}
                      aria-label={sidebarMode === 'history' ? 'Hide history' : 'Show history'}
                      aria-pressed={sidebarMode === 'history'}
                      title="History"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
                        sidebarMode === 'history'
                          ? 'bg-surface-hover text-text-primary'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                      style={{ cursor: 'pointer' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                        <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSidebarMode(sidebarMode === 'dashboard' ? null : 'dashboard') }}
                      aria-label={sidebarMode === 'dashboard' ? 'Hide pipeline dashboard' : 'Show pipeline dashboard'}
                      aria-pressed={sidebarMode === 'dashboard'}
                      title="Pipeline dashboard"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
                        sidebarMode === 'dashboard'
                          ? 'bg-surface-hover text-text-primary'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                      style={{ cursor: 'pointer' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                        <path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM10 7a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 3 0v-8A1.5 1.5 0 0 0 10 7ZM4.5 12A1.5 1.5 0 0 0 3 13.5v3a1.5 1.5 0 0 0 3 0v-3A1.5 1.5 0 0 0 4.5 12Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => { setSidebarMode(sidebarMode === 'v2-dashboard' ? null : 'v2-dashboard') }}
                      aria-label={sidebarMode === 'v2-dashboard' ? 'Hide pipeline v2 dashboard' : 'Show pipeline v2 dashboard'}
                      aria-pressed={sidebarMode === 'v2-dashboard'}
                      title="Pipeline v2 dashboard — column distribution, ETA, cost"
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
                        sidebarMode === 'v2-dashboard'
                          ? 'bg-surface-hover text-text-primary'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                      style={{ cursor: 'pointer' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M1 2.75A.75.75 0 0 1 1.75 2h16.5a.75.75 0 0 1 0 1.5H18v8.75A2.75 2.75 0 0 1 15.25 15h-1.072l.798 3.06a.75.75 0 0 1-1.452.38L13.41 18H6.59l-.114.44a.75.75 0 0 1-1.452-.38L5.823 15H4.75A2.75 2.75 0 0 1 2 12.25V3.5h-.25A.75.75 0 0 1 1 2.75ZM7.373 15l-.391 1.5h6.036l-.392-1.5H7.373ZM13 7.5a.5.5 0 0 0-1 0v4a.5.5 0 0 0 1 0v-4Zm-3 2a.5.5 0 0 0-1 0v2a.5.5 0 0 0 1 0v-2Zm-2.5 1a.5.5 0 0 1 .5.5v.5a.5.5 0 0 1-1 0v-.5a.5.5 0 0 1 .5-.5Z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>

        {/* Center: Chef title + processing indicator */}
        <div className="flex items-center justify-self-center gap-2">
          <span className="text-sm font-medium text-text-primary">Chef</span>
          {isProcessing && (
            <ProcessingIndicator startTime={chat.streaming.startTime} />
          )}
        </div>

        {/* Right: new chat + dock + keyboard hint + collapse */}
        <div className="flex shrink-0 items-center justify-self-end gap-1">
          {!isPanelCollapsed && (
            <>
              {plusVisible && (
                <button
                  type="button"
                  onClick={handlePlus}
                  disabled={plusDisabled}
                  title={plusTitle}
                  aria-label={plusTitle}
                  data-testid="orchestrator-plus"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                  style={{ cursor: plusDisabled ? 'not-allowed' : 'pointer' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => { setPanelDock(isRightDock ? 'bottom' : 'right') }}
                title={isRightDock ? 'Dock to bottom' : 'Dock to right'}
                aria-label={isRightDock ? 'Dock to bottom' : 'Dock to right'}
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                style={{ cursor: 'pointer' }}
              >
                {isRightDock ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v11.5A2.25 2.25 0 0 1 15.75 18H4.25A2.25 2.25 0 0 1 2 15.75V4.25ZM4.25 3.5a.75.75 0 0 0-.75.75v7.5h13V4.25a.75.75 0 0 0-.75-.75H4.25ZM3.5 13.25v2.5c0 .414.336.75.75.75h11.5a.75.75 0 0 0 .75-.75v-2.5h-13Z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v11.5A2.25 2.25 0 0 1 15.75 18H4.25A2.25 2.25 0 0 1 2 15.75V4.25ZM4.25 3.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h7.5V3.5H4.25Zm9 0v13h2.5a.75.75 0 0 0 .75-.75V4.25a.75.75 0 0 0-.75-.75h-2.5Z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </>
          )}
          {(isPanelCollapsed || headerDensity === 'regular') && (
            <span className="shrink-0 text-xs text-text-secondary">
              {isPanelCollapsed ? 'Cmd+J to expand' : 'Cmd+J'}
            </span>
          )}
          <button
            type="button"
            onClick={togglePanel}
            aria-label={isPanelCollapsed ? 'Expand orchestrator panel' : 'Collapse orchestrator panel'}
            aria-expanded={!isPanelCollapsed}
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            style={{ cursor: 'pointer' }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`h-4 w-4 transition-transform ${
                isRightDock
                  ? (isPanelCollapsed ? 'rotate-180' : '')
                  : (isPanelCollapsed ? 'rotate-180' : '')
              }`}
            >
              {isRightDock ? (
                <path
                  fillRule="evenodd"
                  d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
                  clipRule="evenodd"
                />
              ) : (
                <path
                  fillRule="evenodd"
                  d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                  clipRule="evenodd"
                />
              )}
            </svg>
          </button>
        </div>
      </div>
      </PanelDensityContext.Provider>

      {/* Content - only shown when expanded */}
      <AnimatePresence>
        {!isPanelCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-1 overflow-hidden"
          >
            {/* Sidebar */}
            {sidebarMode === 'dashboard' ? (
              <PipelineDashboard workspaceId={workspaceId} />
            ) : sidebarMode === 'v2-dashboard' ? (
              <PipelineV2Dashboard workspaceId={workspaceId} />
            ) : (
              <PanelSidebar
                mode={sidebarMode}
                sessions={sessions}
                activeSessionId={activeSession?.id}
                isCurrentChatEmpty={localMessages.length === 0}
                onNewChat={() => { void handleNewChat() }}
                onSelectSession={(session) => { handleSelectSession(session) }}
                onDeleteSession={(sessionId) => { void handleDeleteSession(sessionId) }}
              />
            )}

            {/* Main chat / terminal area (view switch lives in the header) */}
            <ChatErrorBoundary panelName="Orchestrator Chat">
              <div className="flex flex-1 flex-col overflow-hidden">
                {viewMode === 'terminal' ? (
                  <OrchestratorTerminalView
                    workspaceId={workspaceId}
                    shells={shells}
                    activeShell={activeShell}
                    onSelectShell={setActiveShell}
                    onCloseShell={handleCloseShell}
                  />
                ) : viewMode === 'files' ? (
                  <WorkspaceFilesView workspaceId={workspaceId} />
                ) : (
                  <>
                    {/* CLI Detection Indicator */}
                    {cliDetecting && <CliDetectingBanner />}
                    {/* Single error banner (covers stream errors + send/spawn
                        failures). Dismiss clears every error source. */}
                    {error && !cliDetecting && (
                      <ErrorBanner
                        error={error}
                        onDismiss={() => { setLocalError(null); chat.clearError(); chat.dismissFailed() }}
                      />
                    )}
                    <ChatHistory
                      messages={localMessages}
                      isLoading={isLoading}
                      streamingContent={chat.streaming.content}
                      processingStartTime={chat.streaming.startTime}
                      thinkingContent={chat.streaming.thinkingContent}
                      toolCalls={toolCalls}
                      queuedMessages={chat.queue}
                    />
                    <ChatInput
                      config={{
                        showModelSelector: true,
                        showContextToggle: true,
                        showThinkingSelector: true,
                        showPermissionSelector: true,
                        showVoiceInput: true,
                        showAttachments: true,
                        placeholder: 'Ask me to create tasks...',
                      }}
                      onSend={handleSendMessage}
                      onCancel={() => { void handleCancel() }}
                      onInputChange={handleInputChange}
                      onAttachmentError={(err) => { setLocalError(`${err.file}: ${err.message}`) }}
                      isProcessing={isProcessing}
                      disabled={!chat.canSend || cliDetecting}
                      queueCount={chat.queue.length}
                    />
                  </>
                )}
              </div>
            </ChatErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    </div>
  )
}

// Elapsed time indicator component
function ProcessingIndicator({ startTime }: { startTime: number | null }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startTime) {
      setElapsed(0)
      return
    }

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    return () => { clearInterval(interval) }
  }, [startTime])

  return (
    <span className="flex items-center gap-1 text-xs text-accent">
      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Thinking{elapsed > 0 ? `... ${String(elapsed)}s` : '...'}
    </span>
  )
}
