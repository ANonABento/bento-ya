/**
 * Orchestrator Panel - Main chat interface for workspace-level orchestration.
 * Uses:
 * - useOrchestratorSessions for session management (create, switch, delete)
 * - useChatSession for chat logic (send, cancel, queue, streaming)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { listen } from '@tauri-apps/api/event'
import { useUIStore } from '@/stores/ui-store'
import { useTaskStore } from '@/stores/task-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useOrchestratorSessions } from '@/hooks/use-orchestrator-sessions'
import { useChatSession } from '@/hooks/chat-session'
import { getChatHistory, type ChatMessage } from '@/lib/ipc'
import { buildPromptWithAttachments } from '@/types'
import { useCliPath } from '@/hooks/use-cli-path'
import { ChatHistory } from './chat-history'
import { PanelSidebar } from './panel-sidebar'
import { PipelineDashboard } from './pipeline-dashboard'
import { ChatErrorBoundary } from './chat-error-boundary'
import { ErrorBanner, FailedMessageBanner, CliDetectingBanner, ChatInput, type ChatInputMessage, mapToolCalls } from './shared'

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

  // Local UI state
  const [sidebarMode, setSidebarMode] = useState<'history' | 'files' | 'dashboard' | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Sync hook error to local state (like AgentPanel does)
  const error = localError ?? chat.error ?? cliDetectionError
  useEffect(() => {
    if (chat.error) setLocalError(chat.error)
  }, [chat.error])

  const panelRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

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
      const unsubTaskCreated = await listen('task:created', (event) => {
        const payload = event.payload as { workspace_id?: string }
        if (payload.workspace_id === workspaceId) {
          void loadTasks(workspaceId)
        }
      })
      unsubscribes.push(unsubTaskCreated)

      const unsubTaskUpdated = await listen('task:updated', (event) => {
        const payload = event.payload as { workspace_id?: string }
        if (payload.workspace_id === workspaceId) {
          void loadTasks(workspaceId)
        }
      })
      unsubscribes.push(unsubTaskUpdated)

      const unsubTaskDeleted = await listen('task:deleted', (event) => {
        const payload = event.payload as { workspace_id?: string }
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

  // Resize handle drag handler
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (isPanelCollapsed) return
    e.preventDefault()
    e.stopPropagation()
    dragStartY.current = isRightDock ? e.clientX : e.clientY
    dragStartHeight.current = isRightDock ? panelWidth : panelHeight
    setIsDragging(true)
  }, [panelHeight, panelWidth, isPanelCollapsed, isRightDock])

  // Header click handler (toggle panel)
  const handleHeaderClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    togglePanel()
  }, [togglePanel])

  useEffect(() => {
    if (!isDragging) return

    document.body.style.cursor = isRightDock ? 'ew-resize' : 'ns-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (isRightDock) {
        // Handle at left edge of right panel: drag LEFT → panel grows, drag RIGHT → panel shrinks
        const deltaX = dragStartY.current - e.clientX
        const newWidth = dragStartHeight.current + deltaX
        setPanelWidth(newWidth)
      } else {
        // Handle at top edge of bottom panel: drag UP → panel grows, drag DOWN → panel shrinks
        const deltaY = dragStartY.current - e.clientY
        const newHeight = dragStartHeight.current + deltaY
        setPanelHeight(newHeight)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, setPanelHeight, setPanelWidth, isRightDock])

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
        isRightDock ? (
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute -left-1.5 top-0 bottom-0 w-3 z-50 group"
            style={{ cursor: 'col-resize' }}
          >
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-transparent group-hover:bg-accent/60 transition-colors -translate-x-1/2" />
          </div>
        ) : (
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute -top-1.5 left-0 right-0 h-3 z-50 group"
            style={{ cursor: 'row-resize' }}
          >
            <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-transparent group-hover:bg-accent/60 transition-colors -translate-y-1/2" />
          </div>
        )
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

      {/* Header - clickable to toggle */}
      <div
        onClick={handleHeaderClick}
        className="relative flex items-center justify-between px-3 py-1.5 select-none cursor-pointer"
      >
        {/* Left: History + Files buttons */}
        <div className="flex items-center gap-1">
          {!isPanelCollapsed && (
            <>
              <button
                type="button"
                onClick={() => { setSidebarMode(sidebarMode === 'history' ? null : 'history') }}
                className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors ${
                  sidebarMode === 'history'
                    ? 'bg-surface-hover text-text-primary'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => { setSidebarMode(sidebarMode === 'files' ? null : 'files') }}
                className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors ${
                  sidebarMode === 'files'
                    ? 'bg-surface-hover text-text-primary'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75Z" />
                  <path fillRule="evenodd" d="M2 9.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 .75.75v5a1.75 1.75 0 0 1-1.75 1.75H3.75A1.75 1.75 0 0 1 2 14.25v-5Z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => { setSidebarMode(sidebarMode === 'dashboard' ? null : 'dashboard') }}
                className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors ${
                  sidebarMode === 'dashboard'
                    ? 'bg-surface-hover text-text-primary'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
                title="Pipeline dashboard"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM10 7a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 3 0v-8A1.5 1.5 0 0 0 10 7ZM4.5 12A1.5 1.5 0 0 0 3 13.5v3a1.5 1.5 0 0 0 3 0v-3A1.5 1.5 0 0 0 4.5 12Z" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Center: Chef title + processing indicator */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">Chef</span>
          {isProcessing && (
            <ProcessingIndicator startTime={chat.streaming.startTime} />
          )}
        </div>

        {/* Right: New chat + collapse */}
        <div className="flex items-center gap-2">
          {!isPanelCollapsed && (
            <button
              type="button"
              onClick={() => { void handleNewChat() }}
              disabled={localMessages.length === 0}
              className="flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
              </svg>
              New
            </button>
          )}
          <span className="text-xs text-text-secondary">
            {isPanelCollapsed ? 'Cmd+J to expand' : 'Cmd+J'}
          </span>
          {/* Dock position toggle */}
          {!isPanelCollapsed && (
            <button
              type="button"
              onClick={() => { setPanelDock(isRightDock ? 'bottom' : 'right') }}
              title={isRightDock ? 'Dock to bottom' : 'Dock to right'}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              {isRightDock ? (
                /* Icon: dock bottom */
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v11.5A2.25 2.25 0 0 1 15.75 18H4.25A2.25 2.25 0 0 1 2 15.75V4.25ZM4.25 3.5a.75.75 0 0 0-.75.75v7.5h13V4.25a.75.75 0 0 0-.75-.75H4.25ZM3.5 13.25v2.5c0 .414.336.75.75.75h11.5a.75.75 0 0 0 .75-.75v-2.5h-13Z" clipRule="evenodd" />
                </svg>
              ) : (
                /* Icon: dock right */
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v11.5A2.25 2.25 0 0 1 15.75 18H4.25A2.25 2.25 0 0 1 2 15.75V4.25ZM4.25 3.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h7.5V3.5H4.25Zm9 0v13h2.5a.75.75 0 0 0 .75-.75V4.25a.75.75 0 0 0-.75-.75h-2.5Z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={togglePanel}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
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
            ) : (
              <PanelSidebar
                mode={sidebarMode}
                sessions={sessions}
                activeSessionId={activeSession?.id}
                workspaceId={workspaceId}
                isCurrentChatEmpty={localMessages.length === 0}
                onNewChat={() => { void handleNewChat() }}
                onSelectSession={(session) => { handleSelectSession(session) }}
                onDeleteSession={(sessionId) => { void handleDeleteSession(sessionId) }}
              />
            )}

            {/* Main chat area */}
            <ChatErrorBoundary panelName="Orchestrator Chat">
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* CLI Detection Indicator */}
                {cliDetecting && <CliDetectingBanner />}
                {/* Error Banner */}
                {error && !chat.failedMessage && !cliDetecting && (
                  <ErrorBanner
                    error={error}
                    onDismiss={() => { setLocalError(null); chat.clearError(); }}
                  />
                )}
                {/* Failed message with retry/dismiss */}
                {chat.failedMessage && (
                  <FailedMessageBanner
                    error={chat.failedMessage.error}
                    onRetry={() => { void chat.retryFailed() }}
                    onDismiss={chat.dismissFailed}
                  />
                )}
                <ChatHistory
                  messages={localMessages}
                  isLoading={isLoading}
                  streamingContent={chat.streaming.content}
                  processingStartTime={chat.streaming.startTime}
                  thinkingContent={chat.streaming.thinkingContent}
                  toolCalls={toolCalls}
                  onCancel={() => { void handleCancel() }}
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
                  messageCount={chat.messages.length}
                />
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
