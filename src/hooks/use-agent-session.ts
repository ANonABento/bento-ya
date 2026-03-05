import { useState, useEffect, useCallback, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ChatMessageData, ToolCallData, SendMessageParams } from '@/components/shared/cli-chat'
import {
  initAgentSession,
  streamAgentChat,
  cancelAgentChat,
  resetAgentSession,
  getAgentSessionForTask,
  getAgentMessages,
  saveAgentMessage,
  clearAgentMessages,
  updateAgentCliSessionId,
  getRunningAgentCount,
  type AgentStreamPayload,
  type AgentThinkingPayload,
  type AgentToolCallPayload,
  type AgentStatusPayload,
  type AgentMessage as DbAgentMessage,
} from '@/lib/ipc'

export type AgentMessage = ChatMessageData & {
  taskId: string
  createdAt: string
}

export type UseAgentSessionConfig = {
  taskId: string
  workingDir: string
  cliPath: string
  maxConcurrentAgents?: number
}

export type UseAgentSessionReturn = {
  // State
  messages: AgentMessage[]
  isProcessing: boolean
  processingStartTime: number | null
  streamingContent: string
  thinkingContent: string
  toolCalls: ToolCallData[]
  isInitialized: boolean
  error: string | null
  isLoadingHistory: boolean
  agentSessionId: string | null

  // Actions
  initSession: () => Promise<void>
  sendMessage: (params: SendMessageParams) => void
  cancel: () => Promise<void>
  reset: () => Promise<void>
  clearMessages: () => void
}

// Convert DB message to local message format
function dbMessageToLocal(msg: DbAgentMessage, taskId: string): AgentMessage {
  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    taskId,
    createdAt: msg.createdAt,
  }
}

export function useAgentSession(config: UseAgentSessionConfig): UseAgentSessionReturn {
  const { taskId, workingDir, cliPath, maxConcurrentAgents = 3 } = config

  // Message state (persisted to DB)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [isInitialized, setIsInitialized] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Session state (for resume support)
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null)
  const cliSessionIdRef = useRef<string | null>(null)

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null)
  const isProcessingRef = useRef(false)

  // Streaming state
  const [streamingContent, setStreamingContent] = useState('')
  const streamingContentRef = useRef('')
  const [thinkingContent, setThinkingContent] = useState('')
  const thinkingContentRef = useRef('')
  const [activeToolCalls, setActiveToolCalls] = useState<Map<string, ToolCallData>>(new Map())
  const toolCallsRef = useRef<Map<string, ToolCallData>>(new Map())

  // Current model/effort for saving with messages
  const currentModelRef = useRef<string | undefined>(undefined)
  const currentEffortRef = useRef<string | undefined>(undefined)

  // Event filter helper
  const isRelevantEvent = useCallback(
    (payload: { taskId: string }) => payload.taskId === taskId,
    [taskId]
  )

  // Listen for agent events
  useEffect(() => {
    const unsubscribes: UnlistenFn[] = []

    const setupListeners = async () => {
      // Processing started
      const unsubProcessing = await listen<AgentStatusPayload>('agent:processing', (event) => {
        if (isRelevantEvent(event.payload)) {
          setIsProcessing(true)
          isProcessingRef.current = true
          setProcessingStartTime(Date.now())
          setError(null)
        }
      })
      unsubscribes.push(unsubProcessing)

      // Processing complete - save assistant message to DB
      const unsubComplete = await listen<AgentStatusPayload>('agent:complete', async (event) => {
        if (isRelevantEvent(event.payload)) {
          const finalContent = streamingContentRef.current
          const thinkingSnapshot = thinkingContentRef.current
          const toolCallsSnapshot = JSON.stringify(Array.from(toolCallsRef.current.values()))

          // Persist cli_session_id for resume support
          if (event.payload.cliSessionId && agentSessionId) {
            cliSessionIdRef.current = event.payload.cliSessionId
            try {
              await updateAgentCliSessionId(agentSessionId, event.payload.cliSessionId)
            } catch (err) {
              console.error('Failed to persist cli_session_id:', err)
            }
          }

          // Save assistant message to DB if we have content
          if (finalContent) {
            try {
              const savedMsg = await saveAgentMessage(
                taskId,
                'assistant',
                finalContent,
                currentModelRef.current,
                currentEffortRef.current,
                toolCallsSnapshot !== '[]' ? toolCallsSnapshot : undefined,
                thinkingSnapshot || undefined,
              )

              // Add to local state
              setMessages((prev) => [
                ...prev,
                dbMessageToLocal(savedMsg, taskId),
              ])
            } catch (err) {
              console.error('Failed to save assistant message:', err)
              // Still add locally even if DB save fails
              setMessages((prev) => [
                ...prev,
                {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: finalContent,
                  taskId,
                  createdAt: new Date().toISOString(),
                },
              ])
            }
          }

          isProcessingRef.current = false
          setIsProcessing(false)
          setProcessingStartTime(null)
          setStreamingContent('')
          streamingContentRef.current = ''
          setThinkingContent('')
          thinkingContentRef.current = ''
          setActiveToolCalls(new Map())
          toolCallsRef.current = new Map()
        }
      })
      unsubscribes.push(unsubComplete)

      // Error
      const unsubError = await listen<AgentStatusPayload>('agent:error', (event) => {
        if (isRelevantEvent(event.payload)) {
          setError(event.payload.message ?? 'Unknown error')
          isProcessingRef.current = false
          setIsProcessing(false)
          setProcessingStartTime(null)
          setStreamingContent('')
          streamingContentRef.current = ''
          setThinkingContent('')
          thinkingContentRef.current = ''
          setActiveToolCalls(new Map())
          toolCallsRef.current = new Map()
        }
      })
      unsubscribes.push(unsubError)

      // Stream chunks
      const unsubStream = await listen<AgentStreamPayload>('agent:stream', (event) => {
        if (isRelevantEvent(event.payload)) {
          if (event.payload.finishReason) {
            // Stream complete - don't clear yet, wait for complete event
          } else if (event.payload.delta) {
            setStreamingContent((prev) => {
              const newContent = prev + event.payload.delta
              streamingContentRef.current = newContent
              return newContent
            })
          }
        }
      })
      unsubscribes.push(unsubStream)

      // Thinking
      const unsubThinking = await listen<AgentThinkingPayload>('agent:thinking', (event) => {
        if (isRelevantEvent(event.payload)) {
          if (!event.payload.isComplete && event.payload.content) {
            setThinkingContent((prev) => {
              const newContent = prev + event.payload.content
              thinkingContentRef.current = newContent
              return newContent
            })
          }
        }
      })
      unsubscribes.push(unsubThinking)

      // Tool calls
      const unsubToolCall = await listen<AgentToolCallPayload>('agent:tool_call', (event) => {
        if (isRelevantEvent(event.payload)) {
          setActiveToolCalls((prev) => {
            const updated = new Map(prev)
            const toolData: ToolCallData = {
              toolId: event.payload.toolId,
              toolName: event.payload.toolName,
              status: event.payload.status as 'running' | 'complete' | 'error',
            }
            updated.set(event.payload.toolId, toolData)
            toolCallsRef.current = updated
            return updated
          })
        }
      })
      unsubscribes.push(unsubToolCall)
    }

    void setupListeners()

    return () => {
      for (const unsub of unsubscribes) {
        unsub()
      }
    }
  }, [taskId, isRelevantEvent, agentSessionId])

  // Initialize session - load from DB
  const initSession = useCallback(async () => {
    try {
      setIsLoadingHistory(true)

      // Check max concurrent agents limit
      const runningCount = await getRunningAgentCount()
      if (runningCount >= maxConcurrentAgents) {
        throw new Error(`Max concurrent agents (${maxConcurrentAgents}) reached. Please wait for other agents to complete.`)
      }

      // Get or create DB session
      const dbSession = await getAgentSessionForTask(taskId, workingDir)
      setAgentSessionId(dbSession.id)
      cliSessionIdRef.current = dbSession.cliSessionId ?? null

      // Load message history from DB
      const dbMessages = await getAgentMessages(taskId)
      const localMessages = dbMessages.map((m) => dbMessageToLocal(m, taskId))
      setMessages(localMessages)

      // Initialize in-memory session (with resume ID if available)
      await initAgentSession(taskId, workingDir, cliPath)

      setIsInitialized(true)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setIsLoadingHistory(false)
    }
  }, [taskId, workingDir, cliPath, maxConcurrentAgents])

  // Send a message - save to DB immediately
  const sendMessage = useCallback(
    async (params: SendMessageParams) => {
      if (!isInitialized) return

      // Store model/effort for assistant message persistence
      currentModelRef.current = params.model
      currentEffortRef.current = params.effortLevel

      // Save user message to DB first
      try {
        const savedMsg = await saveAgentMessage(
          taskId,
          'user',
          params.content,
          params.model,
          params.effortLevel,
        )

        // Add to local state
        setMessages((prev) => [...prev, dbMessageToLocal(savedMsg, taskId)])
      } catch (err) {
        console.error('Failed to save user message:', err)
        // Add optimistic local message if DB save fails
        const userMessage: AgentMessage = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: params.content,
          taskId,
          createdAt: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, userMessage])
      }

      // Skip if already processing
      if (isProcessingRef.current) {
        return
      }

      // Start processing
      isProcessingRef.current = true
      setIsProcessing(true)
      setProcessingStartTime(Date.now())
      setError(null)

      try {
        await streamAgentChat(
          taskId,
          params.content,
          params.model,
          params.effortLevel !== 'default' ? params.effortLevel : undefined,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        isProcessingRef.current = false
        setIsProcessing(false)
        setProcessingStartTime(null)
      }
    },
    [isInitialized, taskId]
  )

  // Cancel current message
  const cancel = useCallback(async () => {
    try {
      await cancelAgentChat(taskId)
    } catch (err) {
      console.error('Failed to cancel:', err)
    }
  }, [taskId])

  // Reset session (fresh start - clears DB messages too)
  const reset = useCallback(async () => {
    try {
      // Clear DB messages
      await clearAgentMessages(taskId)

      // Clear cli_session_id for fresh start
      if (agentSessionId) {
        await updateAgentCliSessionId(agentSessionId, undefined)
        cliSessionIdRef.current = null
      }

      // Reset in-memory session
      await resetAgentSession(taskId)

      // Clear local state
      setIsInitialized(false)
      setMessages([])
      setStreamingContent('')
      streamingContentRef.current = ''
      setThinkingContent('')
      thinkingContentRef.current = ''
      setActiveToolCalls(new Map())
      toolCallsRef.current = new Map()
      setIsProcessing(false)
      setProcessingStartTime(null)
      setError(null)
    } catch (err) {
      console.error('Failed to reset:', err)
    }
  }, [taskId, agentSessionId])

  // Clear messages (local only - for UI refresh)
  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return {
    messages,
    isProcessing,
    processingStartTime,
    streamingContent,
    thinkingContent,
    toolCalls: Array.from(activeToolCalls.values()),
    isInitialized,
    error,
    isLoadingHistory,
    agentSessionId,
    initSession,
    sendMessage,
    cancel,
    reset,
    clearMessages,
  }
}
