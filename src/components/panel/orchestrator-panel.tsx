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

const COLLAPSED_HEIGHT = 44

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null)
  const [thinkingContent, setThinkingContent] = useState('')
  const [activeToolCalls, setActiveToolCalls] = useState<Map<string, ToolCallEvent>>(new Map())
  const panelRef = useRef<HTMLDivElement>(null)
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
          setIsProcessing(false)
          setProcessingStartTime(null)
          setStreamingContent('')
          setThinkingContent('')
          setActiveToolCalls(new Map())
          // Refresh messages and sessions (title may have updated)
          void getChatHistory(activeSession.id, 100).then(setMessages)
          void listChatSessions(workspaceId).then(setSessions)
        }
      })
      unsubscribes.push(unsubComplete)

      const unsubError = await listen<OrchestratorEvent>('orchestrator:error', (event) => {
        if (event.payload.workspaceId === workspaceId) {
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

  const handleSendMessage = useCallback(async (params: SendMessageParams) => {
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
    setError(null)

    try {
      // Call IPC in background - events will handle UI updates
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
      setError(`${params.connectionMode.toUpperCase()} error: ${errorMessage}`)
      setIsProcessing(false)
      setProcessingStartTime(null)
      // Refresh to get actual state from backend
      void getChatHistory(activeSession.id, 100).then(setMessages)
    }
  }, [activeSession, workspaceId])

  const handleNewChat = useCallback(async () => {
    // Don't create new chat if current one is empty
    if (messages.length === 0) return

    try {
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
  }, [workspaceId, messages.length])

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
        className="flex items-center justify-between px-3 py-2 select-none"
        style={{ cursor: isPanelCollapsed ? 'pointer' : 'row-resize' }}
      >
        <div className="flex items-center gap-2" style={{ cursor: 'inherit' }}>
          {/* Sidebar toggle */}
          {!isPanelCollapsed && (
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 2 10Z" clipRule="evenodd" />
              </svg>
            </button>
          )}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4 text-accent"
            style={{ cursor: 'inherit' }}
          >
            <path
              fillRule="evenodd"
              d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902.848.137 1.705.248 2.57.331v3.443a.75.75 0 0 0 1.28.53l3.58-3.579a.78.78 0 0 1 .527-.224 41.202 41.202 0 0 0 5.183-.5c1.437-.232 2.43-1.49 2.43-2.903V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0 0 10 2Zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM8 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm5 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm font-medium text-text-primary" style={{ cursor: 'inherit' }}>Orchestrator</span>
          {isProcessing && (
            <ProcessingIndicator startTime={processingStartTime} />
          )}
        </div>

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
              isOpen={isSidebarOpen}
              sessions={sessions}
              activeSessionId={activeSession?.id}
              onNewChat={() => { void handleNewChat() }}
              onSelectSession={(session) => { void handleSelectSession(session) }}
              onDeleteSession={(sessionId) => { void handleDeleteSession(sessionId) }}
            />

            {/* Main chat area */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {error && (
                <div className="mx-3 mt-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}
              <ChatHistory
                messages={messages}
                isLoading={isLoading}
                streamingContent={streamingContent}
                processingStartTime={processingStartTime}
                thinkingContent={thinkingContent}
                toolCalls={Array.from(activeToolCalls.values())}
              />
              <PanelInput
                onSendMessage={handleSendMessage}
                isProcessing={isProcessing}
                disabled={!activeSession}
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
