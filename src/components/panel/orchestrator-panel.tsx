import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { listen } from '@tauri-apps/api/event'
import { useUIStore } from '@/stores/ui-store'
import { useTaskStore } from '@/stores/task-store'
import {
  getChatHistory,
  getActiveChatSession,
  createChatSession,
  listChatSessions,
  deleteChatSession,
  streamOrchestratorChat,
  cancelOrchestratorChat,
  resetCliSession,
  type ChatMessage,
  type ChatSession,
  type OrchestratorEvent,
  type StreamChunkEvent,
  type ToolResultEvent,
  type ThinkingEvent,
  type ToolCallEvent,
} from '@/lib/ipc'
import { ChatHistory } from './chat-history'
import { PanelInput, type SendMessageParams } from './panel-input'
import { PanelSidebar } from './panel-sidebar'

type OrchestratorPanelProps = {
  workspaceId: string
}

type QueuedMessage = SendMessageParams & { id: string }

type FailedMessage = {
  id: string
  content: string
  params: SendMessageParams
  error: string
}

const COLLAPSED_HEIGHT = 40

export function OrchestratorPanel({ workspaceId }: OrchestratorPanelProps) {
  const panelHeight = useUIStore((s) => s.panelHeight)
  const isPanelCollapsed = useUIStore((s) => s.isPanelCollapsed)
  const setPanelHeight = useUIStore((s) => s.setPanelHeight)
  const togglePanel = useUIStore((s) => s.togglePanel)
  const loadTasks = useTaskStore((s) => s.load)

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [sidebarMode, setSidebarMode] = useState<'history' | 'files' | null>(null)
  const [_error, setError] = useState<string | null>(null)
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null)
  const [thinkingContent, setThinkingContent] = useState('')
  const [activeToolCalls, setActiveToolCalls] = useState<Map<string, ToolCallEvent>>(new Map())
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([])
  const [failedMessage, setFailedMessage] = useState<FailedMessage | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Ref for synchronous processing check (avoids stale closure issues)
  const isProcessingRef = useRef(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)
  const hasDragged = useRef(false)

  // Load active session and sessions list on mount
  useEffect(() => {
    async function loadSession() {
      setIsLoading(true)
      try {
        const session = await getActiveChatSession(workspaceId)
        setActiveSession(session)
        const sessionList = await listChatSessions(workspaceId)
        setSessions(sessionList)
        const history = await getChatHistory(session.id, 100)
        setMessages(history)
      } catch (err) {
        console.error('Failed to load session:', err)
      } finally {
        setIsLoading(false)
      }
    }
    void loadSession()
  }, [workspaceId])

  // Listen for orchestrator events
  useEffect(() => {
    const unsubscribes: Array<() => void> = []

    const setupListeners = async () => {
      const unsubProcessing = await listen<OrchestratorEvent>('orchestrator:processing', (event) => {
        if (event.payload.workspaceId === workspaceId) {
          setIsProcessing(true)
          setProcessingStartTime(Date.now())
          setError(null)
        }
      })
      unsubscribes.push(unsubProcessing)

      const unsubComplete = await listen<OrchestratorEvent>('orchestrator:complete', (event) => {
        if (event.payload.workspaceId === workspaceId && activeSession) {
          // Load messages FIRST, then clear streaming state to avoid flicker
          Promise.all([
            getChatHistory(activeSession.id, 100),
            listChatSessions(workspaceId),
          ]).then(([newMessages, newSessions]) => {
            setMessages(newMessages)
            setSessions(newSessions)
            // Clear streaming state AFTER messages are loaded
            isProcessingRef.current = false
            setIsProcessing(false)
            setProcessingStartTime(null)
            setStreamingContent('')
            setThinkingContent('')
            setActiveToolCalls(new Map())
          })
        }
      })
      unsubscribes.push(unsubComplete)

      const unsubError = await listen<OrchestratorEvent>('orchestrator:error', (event) => {
        if (event.payload.workspaceId === workspaceId) {
          isProcessingRef.current = false
          setIsProcessing(false)
          setProcessingStartTime(null)
          setStreamingContent('')
          setThinkingContent('')
          setActiveToolCalls(new Map())
          setError(event.payload.message ?? 'An error occurred')
        }
      })
      unsubscribes.push(unsubError)

      const unsubStream = await listen<StreamChunkEvent>('orchestrator:stream', (event) => {
        if (event.payload.workspaceId === workspaceId) {
          if (event.payload.finishReason) {
            setStreamingContent('')
          } else if (event.payload.delta) {
            setStreamingContent((prev) => prev + event.payload.delta)
          }
        }
      })
      unsubscribes.push(unsubStream)

      // Listen for tool results to refresh the board
      const unsubToolResult = await listen<ToolResultEvent>('orchestrator:tool_result', (event) => {
        if (event.payload.workspaceId === workspaceId && !event.payload.isError) {
          // Refresh tasks when tools execute successfully
          void loadTasks(workspaceId)
        }
      })
      unsubscribes.push(unsubToolResult)

      // Listen for thinking events
      const unsubThinking = await listen<ThinkingEvent>('orchestrator:thinking', (event) => {
        if (event.payload.workspaceId === workspaceId) {
          if (event.payload.isComplete) {
            // Thinking block complete - keep content for display
          } else if (event.payload.content) {
            setThinkingContent((prev) => prev + event.payload.content)
          }
        }
      })
      unsubscribes.push(unsubThinking)

      // Listen for tool call events
      const unsubToolCall = await listen<ToolCallEvent>('orchestrator:tool_call', (event) => {
        if (event.payload.workspaceId === workspaceId) {
          setActiveToolCalls((prev) => {
            const updated = new Map(prev)
            updated.set(event.payload.toolId, event.payload)
            return updated
          })
        }
      })
      unsubscribes.push(unsubToolCall)

      // Also listen for direct task events (from tool executor)
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
  }, [workspaceId, activeSession, loadTasks])

  // Keyboard shortcut: Cmd+J to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePanel])

  // Process queue when current request completes
  useEffect(() => {
    if (!isProcessing && !isProcessingRef.current && messageQueue.length > 0 && activeSession && !failedMessage) {
      const [next, ...rest] = messageQueue
      if (!next) return
      setMessageQueue(rest)

      // Set ref and state
      isProcessingRef.current = true
      setIsProcessing(true)
      setProcessingStartTime(Date.now())

      // Add optimistic message for queued item
      const optimisticMessage: ChatMessage = {
        id: `temp-${Date.now()}`,
        workspaceId,
        sessionId: activeSession.id,
        role: 'user',
        content: next.content,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimisticMessage])

      // Process the next message
      void streamOrchestratorChat(
        workspaceId,
        activeSession.id,
        next.content,
        next.connectionMode,
        next.apiKey,
        next.model,
        next.cliPath,
      )
    }
  }, [isProcessing, messageQueue, activeSession, workspaceId, failedMessage])

  // Header click/drag handlers - simplified
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    // Ignore if clicking on a button
    if ((e.target as HTMLElement).closest('button')) return

    e.preventDefault()
    hasDragged.current = false
    dragStartY.current = e.clientY
    dragStartHeight.current = panelHeight
    setIsDragging(true)
  }, [panelHeight])

  useEffect(() => {
    if (!isDragging) return

    // Set cursor on body during drag
    if (!isPanelCollapsed) {
      document.body.style.cursor = 'ns-resize'
    }
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartY.current - e.clientY
      if (Math.abs(deltaY) > 3) {
        hasDragged.current = true
        // Only resize if expanded
        if (!isPanelCollapsed) {
          const newHeight = dragStartHeight.current + deltaY
          setPanelHeight(newHeight)
        }
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      // If didn't drag, treat as click to toggle
      if (!hasDragged.current) {
        togglePanel()
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, isPanelCollapsed, setPanelHeight, togglePanel])

  // Process a single message (internal helper)
  const processMessage = useCallback(async (params: SendMessageParams) => {
    if (!activeSession) return

    setFailedMessage(null)
    setError(null)

    try {
      await streamOrchestratorChat(
        workspaceId,
        activeSession.id,
        params.content,
        params.connectionMode,
        params.apiKey,
        params.model,
        params.cliPath,
      )
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null
          ? JSON.stringify(err)
          : String(err)

      // Store failed message for retry
      setFailedMessage({
        id: `failed-${Date.now()}`,
        content: params.content,
        params,
        error: `${params.connectionMode.toUpperCase()} error: ${errorMessage}`,
      })
      isProcessingRef.current = false
      setIsProcessing(false)
      setProcessingStartTime(null)
      // Refresh to get actual state from backend
      void getChatHistory(activeSession.id, 100).then(setMessages)
    }
  }, [activeSession, workspaceId])

  const handleSendMessage = useCallback((params: SendMessageParams) => {
    if (!activeSession) return

    // Add optimistic user message immediately
    const optimisticMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      workspaceId,
      sessionId: activeSession.id,
      role: 'user',
      content: params.content,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticMessage])

    // Use ref for synchronous check (avoids stale closure when clicking fast)
    if (isProcessingRef.current) {
      setMessageQueue((prev) => [...prev, { ...params, id: `queued-${Date.now()}` }])
      return
    }

    // Set ref synchronously, then state for UI
    isProcessingRef.current = true
    setIsProcessing(true)
    setProcessingStartTime(Date.now())

    // Process the message
    void processMessage(params)
  }, [activeSession, workspaceId, processMessage])

  // Handle cancel
  const handleCancel = useCallback(async () => {
    if (!activeSession) return
    try {
      await cancelOrchestratorChat(activeSession.id, workspaceId)
      // Clear queue on cancel
      setMessageQueue([])
    } catch (err) {
      console.error('Failed to cancel:', err)
    }
  }, [activeSession, workspaceId])

  // Handle retry failed message
  const handleRetry = useCallback(async () => {
    if (!failedMessage) return
    const params = failedMessage.params
    setFailedMessage(null)
    await processMessage(params)
  }, [failedMessage, processMessage])

  // Dismiss failed message
  const handleDismissError = useCallback(() => {
    setFailedMessage(null)
  }, [])

  const handleNewChat = useCallback(async () => {
    // Don't create new chat if current one is empty
    if (messages.length === 0) return

    try {
      // Kill the old CLI process and clear its session ID (fresh start)
      if (activeSession) {
        await resetCliSession(activeSession.id)
      }

      const newSession = await createChatSession(workspaceId)
      setActiveSession(newSession)
      setMessages([])
      setError(null)
      // Refresh session list
      const sessionList = await listChatSessions(workspaceId)
      setSessions(sessionList)
    } catch (err) {
      console.error('Failed to create new chat:', err)
    }
  }, [workspaceId, messages.length, activeSession])

  const handleSelectSession = useCallback(async (session: ChatSession) => {
    try {
      setActiveSession(session)
      setIsLoading(true)
      const history = await getChatHistory(session.id, 100)
      setMessages(history)
    } catch (err) {
      console.error('Failed to load session:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await deleteChatSession(sessionId)
      // Refresh session list
      const sessionList = await listChatSessions(workspaceId)
      setSessions(sessionList)
      // If deleted active session, switch to another or create new
      if (activeSession?.id === sessionId) {
        const firstSession = sessionList[0]
        if (firstSession) {
          await handleSelectSession(firstSession)
        } else {
          await handleNewChat()
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }, [workspaceId, activeSession, handleSelectSession, handleNewChat])

  const displayHeight = isPanelCollapsed ? COLLAPSED_HEIGHT : panelHeight

  return (
    <motion.div
      ref={panelRef}
      initial={false}
      animate={{ height: displayHeight }}
      transition={isDragging ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }}
      className="flex flex-col border-t border-border-default bg-surface"
      style={{ minHeight: COLLAPSED_HEIGHT }}
    >
      {/* Header - clickable to toggle, draggable to resize */}
      <div
        onMouseDown={handleHeaderMouseDown}
        onMouseMove={(e) => {
          if (isDragging) return
          // Only set resize cursor if not over a button
          if ((e.target as HTMLElement).closest('button')) {
            document.body.style.cursor = ''
          } else {
            document.body.style.cursor = isPanelCollapsed ? 'pointer' : 'ns-resize'
          }
        }}
        onMouseLeave={() => {
          if (!isDragging) document.body.style.cursor = ''
        }}
        className="relative flex items-center justify-between px-3 py-1.5 select-none"
      >
        {/* Left: History + Files buttons */}
        <div className="flex items-center gap-1" style={{ cursor: 'inherit' }}>
          {!isPanelCollapsed && (
            <>
              {/* History button */}
              <button
                type="button"
                onClick={() => setSidebarMode(sidebarMode === 'history' ? null : 'history')}
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
              {/* Files button */}
              <button
                type="button"
                onClick={() => setSidebarMode(sidebarMode === 'files' ? null : 'files')}
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
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2" style={{ cursor: 'inherit' }}>
          <span className="text-sm font-medium text-text-primary" style={{ cursor: 'inherit' }}>Chef</span>
          {isProcessing && (
            <ProcessingIndicator startTime={processingStartTime} />
          )}
        </div>

        {/* Right: New chat + collapse */}
        <div className="flex items-center gap-2" style={{ cursor: 'inherit' }}>
          {/* New Chat button */}
          {!isPanelCollapsed && (
            <button
              type="button"
              onClick={() => { void handleNewChat() }}
              disabled={messages.length === 0}
              className="flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
              </svg>
              New
            </button>
          )}
          <span className="text-xs text-text-secondary" style={{ cursor: 'inherit' }}>
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
              onNewChat={() => { void handleNewChat() }}
              onSelectSession={(session) => { void handleSelectSession(session) }}
              onDeleteSession={(sessionId) => { void handleDeleteSession(sessionId) }}
            />

            {/* Main chat area */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Failed message with retry/dismiss */}
              {failedMessage && (
                <div className="mx-3 mt-2 rounded-md bg-red-500/10 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-red-400">{failedMessage.error}</p>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => { void handleRetry() }}
                        className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        onClick={handleDismissError}
                        className="rounded px-2 py-0.5 text-xs text-red-400/70 hover:bg-red-500/20 transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <ChatHistory
                messages={messages}
                isLoading={isLoading}
                streamingContent={streamingContent}
                processingStartTime={processingStartTime}
                thinkingContent={thinkingContent}
                toolCalls={Array.from(activeToolCalls.values())}
                onCancel={handleCancel}
                queuedMessages={messageQueue.map((m) => ({ id: m.id, content: m.content }))}
              />
              <PanelInput
                onSendMessage={handleSendMessage}
                onCancel={handleCancel}
                isProcessing={isProcessing}
                disabled={!activeSession}
                queueCount={messageQueue.length}
              />
            </div>
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

    return () => clearInterval(interval)
  }, [startTime])

  return (
    <span className="flex items-center gap-1 text-xs text-accent" style={{ cursor: 'inherit' }}>
      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" style={{ cursor: 'inherit' }}>
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Thinking{elapsed > 0 ? `... ${elapsed}s` : '...'}
    </span>
  )
}
