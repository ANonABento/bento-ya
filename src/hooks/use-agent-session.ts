import { useState, useEffect, useCallback, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ChatMessageData, ToolCallData, SendMessageParams } from '@/components/shared/cli-chat'
import {
  initAgentSession,
  streamAgentChat,
  cancelAgentChat,
  resetAgentSession,
  type AgentStreamPayload,
  type AgentThinkingPayload,
  type AgentToolCallPayload,
  type AgentStatusPayload,
} from '@/lib/ipc'

export type AgentMessage = ChatMessageData & {
  taskId: string
  createdAt: string
}

export type UseAgentSessionConfig = {
  taskId: string
  workingDir: string
  cliPath: string
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

  // Actions
  initSession: () => Promise<void>
  sendMessage: (params: SendMessageParams) => void
  cancel: () => Promise<void>
  reset: () => Promise<void>
  clearMessages: () => void
}

export function useAgentSession(config: UseAgentSessionConfig): UseAgentSessionReturn {
  const { taskId, workingDir, cliPath } = config

  // Message state (session-only, not persisted)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [isInitialized, setIsInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null)
  const isProcessingRef = useRef(false)

  // Streaming state
  const [streamingContent, setStreamingContent] = useState('')
  const streamingContentRef = useRef('')
  const [thinkingContent, setThinkingContent] = useState('')
  const [activeToolCalls, setActiveToolCalls] = useState<Map<string, ToolCallData>>(new Map())

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

      // Processing complete
      const unsubComplete = await listen<AgentStatusPayload>('agent:complete', (event) => {
        if (isRelevantEvent(event.payload)) {
          // Finalize current streaming content as assistant message (use ref for current value)
          const finalContent = streamingContentRef.current
          if (finalContent) {
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

          isProcessingRef.current = false
          setIsProcessing(false)
          setProcessingStartTime(null)
          setStreamingContent('')
          streamingContentRef.current = ''
          setThinkingContent('')
          setActiveToolCalls(new Map())
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
          setThinkingContent('')
          setActiveToolCalls(new Map())
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
            setThinkingContent((prev) => prev + event.payload.content)
          }
        }
      })
      unsubscribes.push(unsubThinking)

      // Tool calls
      const unsubToolCall = await listen<AgentToolCallPayload>('agent:tool_call', (event) => {
        if (isRelevantEvent(event.payload)) {
          setActiveToolCalls((prev) => {
            const updated = new Map(prev)
            updated.set(event.payload.toolId, {
              toolId: event.payload.toolId,
              toolName: event.payload.toolName,
              status: event.payload.status as 'running' | 'complete' | 'error',
            })
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
  }, [taskId, isRelevantEvent])

  // Initialize session
  const initSession = useCallback(async () => {
    try {
      await initAgentSession(taskId, workingDir, cliPath)
      setIsInitialized(true)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }, [taskId, workingDir, cliPath])

  // Send a message
  const sendMessage = useCallback(
    (params: SendMessageParams) => {
      if (!isInitialized) return

      // Add optimistic user message
      const userMessage: AgentMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: params.content,
        taskId,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMessage])

      // Skip if already processing
      if (isProcessingRef.current) {
        return
      }

      // Start processing
      isProcessingRef.current = true
      setIsProcessing(true)
      setProcessingStartTime(Date.now())
      setError(null)

      void streamAgentChat(
        taskId,
        params.content,
        params.model,
        params.effortLevel !== 'default' ? params.effortLevel : undefined,
      ).catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
        isProcessingRef.current = false
        setIsProcessing(false)
        setProcessingStartTime(null)
      })
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

  // Reset session (fresh start)
  const reset = useCallback(async () => {
    try {
      await resetAgentSession(taskId)
      setIsInitialized(false)
      setMessages([])
      setStreamingContent('')
      streamingContentRef.current = ''
      setThinkingContent('')
      setActiveToolCalls(new Map())
      setIsProcessing(false)
      setProcessingStartTime(null)
      setError(null)
    } catch (err) {
      console.error('Failed to reset:', err)
    }
  }, [taskId])

  // Clear messages
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
    initSession,
    sendMessage,
    cancel,
    reset,
    clearMessages,
  }
}
