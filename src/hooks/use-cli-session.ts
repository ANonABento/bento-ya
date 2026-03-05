import { useState, useEffect, useCallback, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { SendMessageParams } from '@/components/shared/cli-chat'
import type { ToolCallData, ChatMessageData } from '@/components/shared/cli-chat'

// Generic event types that both orchestrator and agent can use
export type StreamEvent = {
  workspaceId: string
  sessionId?: string
  delta?: string
  finishReason?: string
  message?: string
}

export type ThinkingEvent = {
  workspaceId: string
  sessionId?: string
  content?: string
  isComplete?: boolean
}

export type ToolCallEvent = {
  workspaceId: string
  sessionId?: string
  toolId: string
  toolName: string
  status: 'running' | 'complete' | 'error'
}

export type StatusEvent = {
  workspaceId: string
  sessionId?: string
  message?: string
}

// Message with additional metadata
export type CliMessage = ChatMessageData & {
  workspaceId?: string
  sessionId?: string
  createdAt?: string
}

type QueuedMessage = SendMessageParams & { id: string }

type FailedMessage = {
  id: string
  content: string
  params: SendMessageParams
  error: string
}

export type UseCliSessionConfig = {
  // Unique identifier for filtering events
  workspaceId: string
  sessionId: string | null

  // Event namespace prefix (e.g., 'orchestrator' or 'agent')
  eventNamespace: string

  // Functions to call backend
  sendMessage: (params: SendMessageParams) => Promise<void>
  cancelMessage: () => Promise<void>
  loadHistory: () => Promise<CliMessage[]>

  // Optional callbacks
  onToolResult?: (isError: boolean) => void
  onComplete?: () => void
}

export type UseCliSessionReturn = {
  // State
  messages: CliMessage[]
  isLoading: boolean
  isProcessing: boolean
  processingStartTime: number | null
  streamingContent: string
  thinkingContent: string
  toolCalls: ToolCallData[]
  messageQueue: QueuedMessage[]
  failedMessage: FailedMessage | null

  // Actions
  sendMessage: (params: SendMessageParams) => void
  cancel: () => Promise<void>
  retry: () => Promise<void>
  dismissError: () => void
  setMessages: React.Dispatch<React.SetStateAction<CliMessage[]>>
  refreshHistory: () => Promise<void>
}

export function useCliSession(config: UseCliSessionConfig): UseCliSessionReturn {
  const {
    workspaceId,
    sessionId,
    eventNamespace,
    sendMessage: sendMessageFn,
    cancelMessage: cancelMessageFn,
    loadHistory,
    onToolResult,
    onComplete,
  } = config

  // Message state
  const [messages, setMessages] = useState<CliMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null)
  const isProcessingRef = useRef(false)

  // Streaming state
  const [streamingContent, setStreamingContent] = useState('')
  const [thinkingContent, setThinkingContent] = useState('')
  const [activeToolCalls, setActiveToolCalls] = useState<Map<string, ToolCallData>>(new Map())

  // Queue state
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([])
  const [failedMessage, setFailedMessage] = useState<FailedMessage | null>(null)

  // Load history on mount/session change
  const refreshHistory = useCallback(async () => {
    if (!sessionId) return
    setIsLoading(true)
    try {
      const history = await loadHistory()
      setMessages(history)
    } catch (err) {
      console.error('Failed to load history:', err)
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, loadHistory])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  // Event filter helper
  const isRelevantEvent = useCallback(
    (payload: { workspaceId: string; sessionId?: string }) => {
      return payload.workspaceId === workspaceId && (!sessionId || payload.sessionId === sessionId)
    },
    [workspaceId, sessionId]
  )

  // Listen for events
  useEffect(() => {
    const unsubscribes: UnlistenFn[] = []

    const setupListeners = async () => {
      // Processing started
      const unsubProcessing = await listen<StatusEvent>(`${eventNamespace}:processing`, (event) => {
        if (isRelevantEvent(event.payload)) {
          setIsProcessing(true)
          isProcessingRef.current = true
          setProcessingStartTime(Date.now())
        }
      })
      unsubscribes.push(unsubProcessing)

      // Processing complete
      const unsubComplete = await listen<StatusEvent>(`${eventNamespace}:complete`, async (event) => {
        if (isRelevantEvent(event.payload)) {
          // Refresh history then clear streaming state
          try {
            const history = await loadHistory()
            setMessages(history)
          } catch (err) {
            console.error('Failed to refresh history:', err)
          }

          isProcessingRef.current = false
          setIsProcessing(false)
          setProcessingStartTime(null)
          setStreamingContent('')
          setThinkingContent('')
          setActiveToolCalls(new Map())
          onComplete?.()
        }
      })
      unsubscribes.push(unsubComplete)

      // Error
      const unsubError = await listen<StatusEvent>(`${eventNamespace}:error`, (event) => {
        if (isRelevantEvent(event.payload)) {
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
      const unsubStream = await listen<StreamEvent>(`${eventNamespace}:stream`, (event) => {
        if (isRelevantEvent(event.payload)) {
          if (event.payload.finishReason) {
            setStreamingContent('')
          } else if (event.payload.delta) {
            setStreamingContent((prev) => prev + event.payload.delta)
          }
        }
      })
      unsubscribes.push(unsubStream)

      // Thinking
      const unsubThinking = await listen<ThinkingEvent>(`${eventNamespace}:thinking`, (event) => {
        if (isRelevantEvent(event.payload)) {
          if (!event.payload.isComplete && event.payload.content) {
            setThinkingContent((prev) => prev + event.payload.content)
          }
        }
      })
      unsubscribes.push(unsubThinking)

      // Tool calls
      const unsubToolCall = await listen<ToolCallEvent>(`${eventNamespace}:tool_call`, (event) => {
        if (isRelevantEvent(event.payload)) {
          setActiveToolCalls((prev) => {
            const updated = new Map(prev)
            updated.set(event.payload.toolId, {
              toolId: event.payload.toolId,
              toolName: event.payload.toolName,
              status: event.payload.status,
            })
            return updated
          })
        }
      })
      unsubscribes.push(unsubToolCall)

      // Tool result (optional callback)
      if (onToolResult) {
        const unsubToolResult = await listen<{ workspaceId: string; sessionId?: string; isError?: boolean }>(
          `${eventNamespace}:tool_result`,
          (event) => {
            if (isRelevantEvent(event.payload)) {
              onToolResult(event.payload.isError ?? false)
            }
          }
        )
        unsubscribes.push(unsubToolResult)
      }
    }

    void setupListeners()

    return () => {
      for (const unsub of unsubscribes) {
        unsub()
      }
    }
  }, [eventNamespace, isRelevantEvent, loadHistory, onComplete, onToolResult])

  // Process queue when current request completes
  useEffect(() => {
    if (!isProcessing && !isProcessingRef.current && messageQueue.length > 0 && sessionId && !failedMessage) {
      const [next, ...rest] = messageQueue
      if (!next) return
      setMessageQueue(rest)

      // Set ref and state
      isProcessingRef.current = true
      setIsProcessing(true)
      setProcessingStartTime(Date.now())

      // Add optimistic message
      const optimisticMessage: CliMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: next.content,
        workspaceId,
        sessionId,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimisticMessage])

      // Process the message
      void sendMessageFn(next).catch((err) => {
        console.error('Failed to send queued message:', err)
        isProcessingRef.current = false
        setIsProcessing(false)
        setProcessingStartTime(null)
      })
    }
  }, [isProcessing, messageQueue, sessionId, failedMessage, workspaceId, sendMessageFn])

  // Send a message
  const sendMessage = useCallback(
    (params: SendMessageParams) => {
      if (!sessionId) return

      // Add optimistic user message
      const optimisticMessage: CliMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: params.content,
        workspaceId,
        sessionId,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimisticMessage])

      // Queue if already processing
      if (isProcessingRef.current) {
        setMessageQueue((prev) => [...prev, { ...params, id: `queued-${Date.now()}` }])
        return
      }

      // Start processing
      isProcessingRef.current = true
      setIsProcessing(true)
      setProcessingStartTime(Date.now())
      setFailedMessage(null)

      void sendMessageFn(params).catch((err) => {
        const errorMessage =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null
              ? JSON.stringify(err)
              : String(err)

        setFailedMessage({
          id: `failed-${Date.now()}`,
          content: params.content,
          params,
          error: errorMessage,
        })
        isProcessingRef.current = false
        setIsProcessing(false)
        setProcessingStartTime(null)
      })
    },
    [sessionId, workspaceId, sendMessageFn]
  )

  // Cancel current message
  const cancel = useCallback(async () => {
    try {
      await cancelMessageFn()
      setMessageQueue([])
    } catch (err) {
      console.error('Failed to cancel:', err)
    }
  }, [cancelMessageFn])

  // Retry failed message
  const retry = useCallback(async () => {
    if (!failedMessage) return
    const params = failedMessage.params
    setFailedMessage(null)

    isProcessingRef.current = true
    setIsProcessing(true)
    setProcessingStartTime(Date.now())

    try {
      await sendMessageFn(params)
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null
            ? JSON.stringify(err)
            : String(err)

      setFailedMessage({
        id: `failed-${Date.now()}`,
        content: params.content,
        params,
        error: errorMessage,
      })
      isProcessingRef.current = false
      setIsProcessing(false)
      setProcessingStartTime(null)
    }
  }, [failedMessage, sendMessageFn])

  // Dismiss error
  const dismissError = useCallback(() => {
    setFailedMessage(null)
  }, [])

  return {
    messages,
    isLoading,
    isProcessing,
    processingStartTime,
    streamingContent,
    thinkingContent,
    toolCalls: Array.from(activeToolCalls.values()),
    messageQueue,
    failedMessage,
    sendMessage,
    cancel,
    retry,
    dismissError,
    setMessages,
    refreshHistory,
  }
}
