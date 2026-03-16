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
import { useChatSession } from '@/hooks/use-chat-session'
import { getChatHistory, type ChatMessage } from '@/lib/ipc'
import { useCliPath } from '@/hooks/use-cli-path'
import { ChatHistory } from './chat-history'
import { PanelInput, type SendMessageParams } from './panel-input'
import { PanelSidebar } from './panel-sidebar'
import { ChatErrorBoundary } from './chat-error-boundary'

type OrchestratorPanelProps = {
  workspaceId: string
}

const COLLAPSED_HEIGHT = 40

export function OrchestratorPanel({ workspaceId }: OrchestratorPanelProps) {
  // UI stores
  const panelHeight = useUIStore((s) => s.panelHeight)
  const isPanelCollapsed = useUIStore((s) => s.isPanelCollapsed)
  const setPanelHeight = useUIStore((s) => s.setPanelHeight)
  const togglePanel = useUIStore((s) => s.togglePanel)
  const loadTasks = useTaskStore((s) => s.load)

  // Get settings for LLM connection
  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')
  const connectionMode = anthropicProvider?.connectionMode ?? 'cli'
  const { cliPath, detectionError: cliDetectionError } = useCliPath()
  const apiKey = settings.agent.envVars['ANTHROPIC_API_KEY'] || undefined

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
  const [sidebarMode, setSidebarMode] = useState<'history' | 'files' | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

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
    dragStartY.current = e.clientY
    dragStartHeight.current = panelHeight
    setIsDragging(true)
  }, [panelHeight, isPanelCollapsed])

  // Header click handler (toggle panel)
  const handleHeaderClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    togglePanel()
  }, [togglePanel])

  useEffect(() => {
    if (!isDragging) return

    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartY.current - e.clientY
      const newHeight = dragStartHeight.current + deltaY
      setPanelHeight(newHeight)
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
  }, [isDragging, setPanelHeight])

  // Handlers
  const handleSendMessage = useCallback((params: SendMessageParams) => {
    if (!chat.canSend) return
    void chat.sendMessage(params.content, params.model)
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

  const displayHeight = isPanelCollapsed ? COLLAPSED_HEIGHT : panelHeight
  const isLoading = sessionsLoading || messagesLoading
  const isProcessing = chat.streaming.isStreaming

  // Convert tool calls to format expected by ChatHistory
  const toolCalls = chat.streaming.toolCalls.map((tc) => ({
    workspaceId,
    toolId: tc.id,
    toolName: tc.name,
    status: tc.status === 'completed' ? 'complete' as const : tc.status === 'pending' ? 'running' as const : tc.status as 'running' | 'complete' | 'error',
    input: tc.input ? (() => { try { return JSON.parse(tc.input) as Record<string, unknown> } catch { return { raw: tc.input } } })() : undefined,
  }))

  return (
    <motion.div
      ref={panelRef}
      initial={false}
      animate={{ height: displayHeight }}
      transition={isDragging ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }}
      className="flex flex-col border-t border-border-default bg-surface"
      style={{ minHeight: COLLAPSED_HEIGHT }}
    >
      {/* Resize handle - top edge only */}
      {!isPanelCollapsed && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute -top-1 left-0 right-0 h-3 z-10 group"
          style={{ cursor: 'ns-resize' }}
        >
          <div className="absolute bottom-0 left-0 right-0 h-px bg-transparent group-hover:bg-accent/50 transition-colors" />
        </div>
      )}

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
          <button
            type="button"
            onClick={togglePanel}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`h-4 w-4 transition-transform ${isPanelCollapsed ? 'rotate-180' : ''}`}
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
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

            {/* Main chat area */}
            <ChatErrorBoundary panelName="Orchestrator Chat">
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* Error Banner */}
                {(localError ?? cliDetectionError) && !chat.failedMessage && (
                  <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                      <path d="M7 1a6 6 0 100 12A6 6 0 007 1zm0 9a.75.75 0 110-1.5.75.75 0 010 1.5zm.75-3a.75.75 0 01-1.5 0V4.5a.75.75 0 011.5 0V7z"/>
                    </svg>
                    <span className="flex-1">{localError ?? cliDetectionError}</span>
                    {localError && (
                      <button
                        type="button"
                        onClick={() => { setLocalError(null) }}
                        className="text-red-400 hover:text-red-300"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
                {/* Failed message with retry/dismiss */}
                {chat.failedMessage && (
                  <div className="mx-3 mt-2 rounded-md bg-red-500/10 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-red-400">{chat.failedMessage.error}</p>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => { void chat.retryFailed() }}
                          className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={chat.dismissFailed}
                          className="rounded px-2 py-0.5 text-xs text-red-400/70 hover:bg-red-500/20 transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <ChatHistory
                  messages={localMessages}
                  isLoading={isLoading}
                  streamingContent={chat.streaming.content}
                  processingStartTime={chat.streaming.startTime}
                  thinkingContent={chat.streaming.thinkingContent}
                  toolCalls={toolCalls}
                  onCancel={() => { void handleCancel() }}
                  queuedMessages={chat.queue.map((m) => ({ id: m.id, content: m.content }))}
                />
                <PanelInput
                  onSendMessage={handleSendMessage}
                  onCancel={() => { void handleCancel() }}
                  isProcessing={isProcessing}
                  disabled={!chat.canSend}
                  queueCount={chat.queue.length}
                />
              </div>
            </ChatErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
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
