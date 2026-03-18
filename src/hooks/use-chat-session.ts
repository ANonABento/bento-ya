/**
 * Unified hook for managing chat sessions (both Agent and Orchestrator).
 * Consolidates streaming state, event handling, message management, and message queue.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AgentMessage } from '@/types'
import * as ipc from '@/lib/ipc'
import type {
  ChatMessage,
  StreamChunkEvent,
  ThinkingEvent,
  ToolCallEvent,
  OrchestratorEvent,
  AgentStreamEvent,
  AgentThinkingEvent,
  AgentToolCallEvent,
  AgentCompleteEvent,
} from '@/lib/ipc'

// ─── Helper: Extract error message from various error types ───────────────────
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    // Handle Tauri error objects which often have message property
    if ('message' in err && typeof err.message === 'string') return err.message
    // Try to stringify if it's a plain object
    try {
      return JSON.stringify(err)
    } catch {
      return 'Unknown error'
    }
  }
  return String(err)
}

// ─── Context Preamble Builder ───────────────────────────────────────────────

/** Extract a short summary from an assistant message (first sentence/line before code) */
function summarizeAssistantMessage(content: string): string {
  // Take everything before the first code fence or double newline
  const beforeCode = content.split(/```|\n\n/)[0] ?? content
  // Truncate to ~200 chars
  const trimmed = beforeCode.trim()
  return trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed
}

/** Build a context preamble from previous messages for a model switch.
 *  Uses the last 20 messages to keep the preamble bounded. */
function buildContextPreamble(messages: UnifiedMessage[]): string {
  if (messages.length === 0) return ''

  const userMessages: string[] = []
  const agentSummaries: string[] = []

  // Only look at last 20 messages to keep preamble reasonable
  const recent = messages.slice(-20)
  for (const msg of recent) {
    if (msg.role === 'user') {
      // Include user messages verbatim, truncate long ones
      const content = msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content
      userMessages.push(content)
    } else if (msg.role === 'assistant') {
      const summary = summarizeAssistantMessage(msg.content)
      if (summary) agentSummaries.push(summary)
    }
  }

  if (userMessages.length === 0) return ''

  let preamble = '[Previous conversation context]\n\n'
  preamble += 'User requests:\n'
  for (const msg of userMessages) {
    preamble += `- ${msg}\n`
  }
  if (agentSummaries.length > 0) {
    preamble += '\nAgent progress:\n'
    for (const summary of agentSummaries) {
      preamble += `- ${summary}\n`
    }
  }
  preamble += '\n---\n'

  // Hard cap at 4k chars to avoid blowing the first prompt
  if (preamble.length > 4000) {
    return preamble.slice(0, 3990) + '\n...\n---\n'
  }
  return preamble
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type ChatMode = 'agent' | 'orchestrator'

export type ToolCall = {
  id: string
  name: string
  input: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

export type StreamingState = {
  isStreaming: boolean
  content: string
  thinkingContent: string
  toolCalls: ToolCall[]
  startTime: number | null
}

export type UnifiedMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export type QueuedMessage = {
  id: string
  content: string
  model?: string
  effortLevel?: string
}

export type FailedMessage = {
  id: string
  content: string
  model?: string
  effortLevel?: string
  error: string
}

export type ChatSessionConfig = {
  mode: ChatMode
  // Agent mode
  taskId?: string
  workingDir?: string
  // Orchestrator mode
  workspaceId?: string
  sessionId?: string
  // Shared
  cliPath?: string
  connectionMode?: 'api' | 'cli'
  apiKey?: string
  onError?: (error: string) => void
  onToolResult?: () => void // Called when tools execute (for refreshing board)
  onComplete?: () => void // Called when message processing completes (for refreshing session list)
}

export type ChatSessionState = {
  messages: UnifiedMessage[]
  isLoading: boolean
  streaming: StreamingState
  error: string | null
  queue: QueuedMessage[]
  failedMessage: FailedMessage | null
  canSend: boolean // True when all required IDs are available for sending
}

export type ChatSessionActions = {
  sendMessage: (content: string, model?: string, effortLevel?: string) => Promise<void>
  cancel: () => Promise<void>
  clearMessages: () => Promise<void>
  refreshMessages: () => Promise<void>
  clearError: () => void
  retryFailed: () => Promise<void>
  dismissFailed: () => void
  clearQueue: () => void
}

// ─── Helper: Convert messages to unified format ────────────────────────────

function toUnifiedMessage(msg: AgentMessage | ChatMessage): UnifiedMessage {
  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    createdAt: msg.createdAt,
  }
}


// ─── Hook Implementation ───────────────────────────────────────────────────

export function useChatSession(config: ChatSessionConfig): ChatSessionState & ChatSessionActions {
  const {
    mode,
    taskId,
    workingDir = '',
    workspaceId,
    sessionId,
    cliPath = 'claude',
    connectionMode = 'cli',
    apiKey,
    onError,
    onToolResult,
    onComplete,
  } = config

  // Determine the primary ID for filtering events
  const primaryId = mode === 'agent' ? taskId : workspaceId

  // Determine if we can send messages (all required IDs present)
  const canSend = mode === 'agent'
    ? !!taskId
    : !!(workspaceId && sessionId)

  // State
  const [messages, setMessages] = useState<UnifiedMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState<StreamingState>({
    isStreaming: false,
    content: '',
    thinkingContent: '',
    toolCalls: [],
    startTime: null,
  })
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const [failedMessage, setFailedMessage] = useState<FailedMessage | null>(null)

  // Ref for synchronous processing check (avoids stale closure issues)
  const isProcessingRef = useRef(false)
  const unlistenRefs = useRef<UnlistenFn[]>([])
  // Track last model used to detect switches
  const lastModelRef = useRef<string | null>(null)
  // Ref for latest messages (avoids stale closure in sendMessage)
  const messagesRef = useRef<UnifiedMessage[]>([])
  messagesRef.current = messages

  // Callback refs - store latest values without causing re-renders
  const onErrorRef = useRef(onError)
  const onToolResultRef = useRef(onToolResult)
  const onCompleteRef = useRef(onComplete)

  // Keep refs in sync with latest props
  useEffect(() => {
    onErrorRef.current = onError
    onToolResultRef.current = onToolResult
    onCompleteRef.current = onComplete
  })

  // ─── Load Messages ─────────────────────────────────────────────────────

  const loadMessages = useCallback(async () => {
    if (!primaryId) return
    try {
      if (mode === 'agent' && taskId) {
        const agentMessages = await ipc.getAgentMessages(taskId)
        setMessages(agentMessages.map(toUnifiedMessage))
      } else if (mode === 'orchestrator' && sessionId) {
        const chatMessages = await ipc.getChatHistory(sessionId, 100)
        setMessages(chatMessages.map(toUnifiedMessage))
      }
    } catch (err) {
      onErrorRef.current?.(`Failed to load messages: ${getErrorMessage(err)}`)
    } finally {
      setIsLoading(false)
    }
  }, [mode, primaryId, taskId, sessionId])

  // Load on mount
  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  // ─── Event Listeners ───────────────────────────────────────────────────

  useEffect(() => {
    if (!primaryId) return

    let cancelled = false // Guard against StrictMode double-invoke race

    const setupListeners = async () => {
      const listeners: UnlistenFn[] = []

      if (mode === 'agent' && taskId) {
        // Agent event listeners
        const unlistenStream = await ipc.onAgentStream((payload: AgentStreamEvent) => {
          if (payload.taskId !== taskId) return
          setStreaming((prev) => ({
            ...prev,
            content: prev.content + payload.content,
          }))
        })
        listeners.push(unlistenStream)

        const unlistenThinking = await ipc.onAgentThinking((payload: AgentThinkingEvent) => {
          if (payload.taskId !== taskId) return
          if (payload.isComplete) return
          setStreaming((prev) => ({
            ...prev,
            thinkingContent: prev.thinkingContent + payload.content,
          }))
        })
        listeners.push(unlistenThinking)

        const unlistenToolCall = await ipc.onAgentToolCall((payload: AgentToolCallEvent) => {
          if (payload.taskId !== taskId) return
          const { toolId, toolName, toolInput, status } = payload
          setStreaming((prev) => {
            const existing = prev.toolCalls.find((t) => t.id === toolId)
            if (existing) {
              return {
                ...prev,
                toolCalls: prev.toolCalls.map((t) =>
                  t.id === toolId ? { ...t, status } : t
                ),
              }
            }
            return {
              ...prev,
              toolCalls: [...prev.toolCalls, { id: toolId, name: toolName, input: toolInput, status }],
            }
          })
        })
        listeners.push(unlistenToolCall)

        const unlistenComplete = await ipc.onAgentComplete((payload: AgentCompleteEvent) => {
          if (payload.taskId !== taskId) return
          isProcessingRef.current = false
          setStreaming({
            isStreaming: false,
            content: '',
            thinkingContent: '',
            toolCalls: [],
            startTime: null,
          })
          // Refresh messages then call onComplete
          void ipc.getAgentMessages(taskId).then((msgs) => {
            setMessages(msgs.map(toUnifiedMessage))
            onCompleteRef.current?.()
          })
        })
        listeners.push(unlistenComplete)
      } else if (mode === 'orchestrator' && workspaceId) {
        // Orchestrator event listeners
        const unlistenProcessing = await listen<OrchestratorEvent>('orchestrator:processing', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          setStreaming((prev) => ({
            ...prev,
            isStreaming: true,
            startTime: Date.now(),
          }))
          setError(null)
        })
        listeners.push(unlistenProcessing)

        const unlistenStream = await listen<StreamChunkEvent>('orchestrator:stream', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          if (event.payload.finishReason) {
            // Stream finished, content will be in final message
          } else if (event.payload.delta) {
            setStreaming((prev) => ({
              ...prev,
              content: prev.content + event.payload.delta,
            }))
          }
        })
        listeners.push(unlistenStream)

        const unlistenThinking = await listen<ThinkingEvent>('orchestrator:thinking', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          if (event.payload.isComplete) return
          if (event.payload.content) {
            setStreaming((prev) => ({
              ...prev,
              thinkingContent: prev.thinkingContent + event.payload.content,
            }))
          }
        })
        listeners.push(unlistenThinking)

        const unlistenToolCall = await listen<ToolCallEvent>('orchestrator:tool_call', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          const { toolId, toolName, status, input } = event.payload
          setStreaming((prev) => {
            const existing = prev.toolCalls.find((t) => t.id === toolId)
            const inputStr = input ? JSON.stringify(input) : ''
            if (existing) {
              return {
                ...prev,
                toolCalls: prev.toolCalls.map((t) =>
                  t.id === toolId ? { ...t, status: status as ToolCall['status'] } : t
                ),
              }
            }
            return {
              ...prev,
              toolCalls: [...prev.toolCalls, { id: toolId, name: toolName, input: inputStr, status: status as ToolCall['status'] }],
            }
          })
        })
        listeners.push(unlistenToolCall)

        const unlistenToolResult = await listen<{ workspaceId: string; isError: boolean }>('orchestrator:tool_result', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          if (!event.payload.isError) {
            onToolResultRef.current?.()
          }
        })
        listeners.push(unlistenToolResult)

        const unlistenComplete = await listen<OrchestratorEvent>('orchestrator:complete', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          // Refresh messages first, then clear streaming, then call onComplete
          if (sessionId) {
            void ipc.getChatHistory(sessionId, 100).then((msgs) => {
              setMessages(msgs.map(toUnifiedMessage))
              isProcessingRef.current = false
              setStreaming({
                isStreaming: false,
                content: '',
                thinkingContent: '',
                toolCalls: [],
                startTime: null,
              })
              onCompleteRef.current?.()
            })
          }
        })
        listeners.push(unlistenComplete)

        const unlistenError = await listen<OrchestratorEvent>('orchestrator:error', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          isProcessingRef.current = false
          setStreaming({
            isStreaming: false,
            content: '',
            thinkingContent: '',
            toolCalls: [],
            startTime: null,
          })
          setError(event.payload.message ?? 'An error occurred')
        })
        listeners.push(unlistenError)
      }

      // If cleanup ran while we were awaiting, tear down immediately
      if (cancelled) {
        listeners.forEach((unlisten) => { unlisten() })
        return
      }

      unlistenRefs.current = listeners
    }

    void setupListeners()

    return () => {
      cancelled = true
      unlistenRefs.current.forEach((unlisten) => { unlisten() })
      unlistenRefs.current = []
    }
  }, [mode, primaryId, taskId, workspaceId, sessionId])

  // ─── Queue Processing ─────────────────────────────────────────────────

  useEffect(() => {
    // Process queue when current request completes
    // Also check canSend - if IDs aren't ready, don't process queue yet
    if (!streaming.isStreaming && !isProcessingRef.current && queue.length > 0 && !failedMessage && canSend) {
      const [next, ...rest] = queue
      if (!next) return
      setQueue(rest)

      // Set ref and state
      isProcessingRef.current = true
      setStreaming((prev) => ({
        ...prev,
        isStreaming: true,
        startTime: Date.now(),
      }))

      // Add optimistic user message
      const optimisticMessage: UnifiedMessage = {
        id: `temp-${String(Date.now())}`,
        role: 'user',
        content: next.content,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimisticMessage])

      // Process the queued message
      const processQueued = async () => {
        try {
          if (mode === 'agent' && taskId) {
            console.debug('[useChatSession] Queue: Agent chat with cliPath:', cliPath)
            await ipc.streamAgentChat(taskId, next.content, workingDir, cliPath, next.model, next.effortLevel)
          } else if (mode === 'orchestrator' && workspaceId && sessionId) {
            console.debug('[useChatSession] Queue: Orchestrator chat with cliPath:', cliPath)
            await ipc.streamOrchestratorChat(
              workspaceId,
              sessionId,
              next.content,
              connectionMode,
              apiKey,
              next.model,
              cliPath
            )
          }
        } catch (err) {
          const errorMsg = getErrorMessage(err)
          setFailedMessage({
            id: next.id,
            content: next.content,
            model: next.model,
            effortLevel: next.effortLevel,
            error: errorMsg,
          })
          isProcessingRef.current = false
          setStreaming({
            isStreaming: false,
            content: '',
            thinkingContent: '',
            toolCalls: [],
            startTime: null,
          })
        }
      }
      void processQueued()
    }
  }, [streaming.isStreaming, queue, failedMessage, canSend, mode, taskId, workspaceId, sessionId, workingDir, cliPath, connectionMode, apiKey])

  // ─── Actions ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (content: string, model?: string, effortLevel?: string) => {
      // Guard: can't send without required IDs
      if (!canSend) {
        console.debug('[useChatSession] Cannot send: missing required IDs', { mode, taskId, workspaceId, sessionId })
        return
      }

      // Detect model switch — insert divider and build context preamble
      let effectiveContent = content
      const prevModel = lastModelRef.current
      const modelSwitched = prevModel !== null && model !== undefined && prevModel !== model

      if (modelSwitched) {
        // Insert a system divider message — save to DB so it persists across reloads
        const modelName = model.charAt(0).toUpperCase() + model.slice(1)
        const dividerContent = `Switched to ${modelName}`
        if (mode === 'agent' && taskId) {
          try {
            await ipc.saveAgentMessage(taskId, 'system', dividerContent)
          } catch {
            // Non-critical, continue even if save fails
          }
        }
        const dividerMessage: UnifiedMessage = {
          id: `switch-${String(Date.now())}`,
          role: 'system',
          content: dividerContent,
          createdAt: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, dividerMessage])

        // Build context preamble from previous messages (use ref for latest)
        const preamble = buildContextPreamble(messagesRef.current)
        if (preamble) {
          effectiveContent = preamble + content
        }
        console.debug(`[useChatSession] Model switched ${prevModel} -> ${model}, prepended context preamble`)
      }

      // Update last model ref
      if (model) lastModelRef.current = model

      // Add optimistic user message immediately (shows the original content, not the preamble)
      const optimisticMessage: UnifiedMessage = {
        id: `temp-${String(Date.now())}`,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimisticMessage])

      // If currently processing, queue the message
      if (isProcessingRef.current) {
        setQueue((prev) => [...prev, { id: `queued-${String(Date.now())}`, content: effectiveContent, model, effortLevel }])
        return
      }

      try {
        // Start streaming state
        isProcessingRef.current = true
        setStreaming({
          isStreaming: true,
          content: '',
          thinkingContent: '',
          toolCalls: [],
          startTime: Date.now(),
        })
        setError(null)
        setFailedMessage(null)

        if (mode === 'agent' && taskId) {
          console.debug('[useChatSession] Agent chat with cliPath:', cliPath)
          await ipc.streamAgentChat(taskId, effectiveContent, workingDir, cliPath, model, effortLevel)
        } else if (mode === 'orchestrator' && workspaceId && sessionId) {
          console.debug('[useChatSession] Orchestrator chat with cliPath:', cliPath, 'connectionMode:', connectionMode)
          await ipc.streamOrchestratorChat(
            workspaceId,
            sessionId,
            effectiveContent,
            connectionMode,
            apiKey,
            model,
            cliPath
          )
        }
      } catch (err) {
        const errorMsg = getErrorMessage(err)
        onErrorRef.current?.(`Failed to send message: ${errorMsg}`)
        setFailedMessage({
          id: `failed-${String(Date.now())}`,
          content: effectiveContent,
          model,
          effortLevel,
          error: errorMsg,
        })
        isProcessingRef.current = false
        setStreaming({
          isStreaming: false,
          content: '',
          thinkingContent: '',
          toolCalls: [],
          startTime: null,
        })
      }
    },
    [mode, canSend, taskId, workspaceId, sessionId, workingDir, cliPath, connectionMode, apiKey]
  )

  const cancel = useCallback(async () => {
    if (!canSend) {
      console.debug('[useChatSession] Cannot cancel: missing required IDs')
      // Still clear queue and reset state even without IDs
      setQueue([])
      isProcessingRef.current = false
      setStreaming({
        isStreaming: false,
        content: '',
        thinkingContent: '',
        toolCalls: [],
        startTime: null,
      })
      return
    }
    try {
      if (mode === 'agent' && taskId) {
        await ipc.cancelAgentChat(taskId)
      } else if (mode === 'orchestrator' && workspaceId && sessionId) {
        await ipc.cancelOrchestratorChat(sessionId, workspaceId)
      }
      // Clear queue on cancel
      setQueue([])
    } catch (err) {
      onErrorRef.current?.(`Failed to cancel: ${getErrorMessage(err)}`)
    }
  }, [mode, canSend, taskId, workspaceId, sessionId])

  const clearMessages = useCallback(async () => {
    try {
      if (mode === 'agent' && taskId) {
        await ipc.clearAgentMessages(taskId)
      } else if (mode === 'orchestrator' && sessionId) {
        await ipc.clearChatHistory(sessionId)
      }
      lastModelRef.current = null
      setMessages([])
    } catch (err) {
      onErrorRef.current?.(`Failed to clear messages: ${getErrorMessage(err)}`)
    }
  }, [mode, taskId, sessionId])

  const refreshMessages = useCallback(async () => {
    await loadMessages()
  }, [loadMessages])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const retryFailed = useCallback(async () => {
    if (!failedMessage) return
    const { content, model, effortLevel } = failedMessage
    setFailedMessage(null)
    // Re-send the message (the optimistic message is already in the list)
    await sendMessage(content, model, effortLevel)
  }, [failedMessage, sendMessage])

  const dismissFailed = useCallback(() => {
    setFailedMessage(null)
  }, [])

  const clearQueue = useCallback(() => {
    setQueue([])
  }, [])

  return {
    messages,
    isLoading,
    streaming,
    error,
    queue,
    failedMessage,
    canSend,
    sendMessage,
    cancel,
    clearMessages,
    refreshMessages,
    clearError,
    retryFailed,
    dismissFailed,
    clearQueue,
  }
}
