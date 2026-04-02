/**
 * Unified hook for managing chat sessions (both Agent and Orchestrator).
 * Consolidates streaming state, event handling, message management, and message queue.
 *
 * Types are in ./types.ts, helpers in ./helpers.ts.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import * as ipc from '@/lib/ipc'
import type {
  StreamChunkEvent,
  ThinkingEvent,
  ToolCallEvent,
  OrchestratorEvent,
  AgentStreamEvent,
  AgentThinkingEvent,
  AgentToolCallEvent,
  AgentCompleteEvent,
} from '@/lib/ipc'
import type {
  ToolCall,
  UnifiedMessage,
  QueuedMessage,
  FailedMessage,
  ChatSessionConfig,
  ChatSessionState,
  ChatSessionActions,
} from './types'
import { INITIAL_STREAMING_STATE } from './types'
import { getErrorMessage, toUnifiedMessage, buildContextPreamble } from './helpers'

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
    apiKeyEnvVar,
    onError,
    onToolResult,
    onComplete,
  } = config

  const primaryId = mode === 'agent' ? taskId : workspaceId
  const canSend = mode === 'agent'
    ? !!taskId
    : !!(workspaceId && sessionId)

  // State
  const [messages, setMessages] = useState<UnifiedMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(INITIAL_STREAMING_STATE)
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const [failedMessage, setFailedMessage] = useState<FailedMessage | null>(null)

  // Refs
  const isProcessingRef = useRef(false)
  const unlistenRefs = useRef<UnlistenFn[]>([])
  const lastModelRef = useRef<string | null>(null)
  const messagesRef = useRef<UnifiedMessage[]>([])
  messagesRef.current = messages

  const onErrorRef = useRef(onError)
  const onToolResultRef = useRef(onToolResult)
  const onCompleteRef = useRef(onComplete)

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

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  // ─── Event Listeners ───────────────────────────────────────────────────

  useEffect(() => {
    if (!primaryId) return

    let cancelled = false

    const setupListeners = async () => {
      const listeners: UnlistenFn[] = []

      if (mode === 'agent' && taskId) {
        const unlistenStream = await ipc.onAgentStream((payload: AgentStreamEvent) => {
          if (payload.taskId !== taskId) return
          setStreaming((prev) => ({ ...prev, content: prev.content + payload.content }))
        })
        listeners.push(unlistenStream)

        const unlistenThinking = await ipc.onAgentThinking((payload: AgentThinkingEvent) => {
          if (payload.taskId !== taskId) return
          if (payload.isComplete) return
          setStreaming((prev) => ({ ...prev, thinkingContent: prev.thinkingContent + payload.content }))
        })
        listeners.push(unlistenThinking)

        const unlistenToolCall = await ipc.onAgentToolCall((payload: AgentToolCallEvent) => {
          if (payload.taskId !== taskId) return
          const { toolId, toolName, toolInput, status } = payload
          setStreaming((prev) => {
            const existing = prev.toolCalls.find((t) => t.id === toolId)
            if (existing) {
              return { ...prev, toolCalls: prev.toolCalls.map((t) => t.id === toolId ? { ...t, status } : t) }
            }
            return { ...prev, toolCalls: [...prev.toolCalls, { id: toolId, name: toolName, input: toolInput, status }] }
          })
        })
        listeners.push(unlistenToolCall)

        const unlistenComplete = await ipc.onAgentComplete((payload: AgentCompleteEvent) => {
          if (payload.taskId !== taskId) return
          isProcessingRef.current = false
          setStreaming(INITIAL_STREAMING_STATE)
          void ipc.getAgentMessages(taskId).then((msgs) => {
            setMessages(msgs.map(toUnifiedMessage))
            onCompleteRef.current?.()
          })
        })
        listeners.push(unlistenComplete)
      } else if (mode === 'orchestrator' && workspaceId) {
        const unlistenProcessing = await listen<OrchestratorEvent>('orchestrator:processing', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          setStreaming((prev) => ({ ...prev, isStreaming: true, startTime: Date.now() }))
          setError(null)
        })
        listeners.push(unlistenProcessing)

        const unlistenStream = await listen<StreamChunkEvent>('orchestrator:stream', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          if (event.payload.finishReason) return
          if (event.payload.delta) {
            setStreaming((prev) => ({ ...prev, content: prev.content + event.payload.delta }))
          }
        })
        listeners.push(unlistenStream)

        const unlistenThinking = await listen<ThinkingEvent>('orchestrator:thinking', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          if (event.payload.isComplete) return
          if (event.payload.content) {
            setStreaming((prev) => ({ ...prev, thinkingContent: prev.thinkingContent + event.payload.content }))
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
              return { ...prev, toolCalls: prev.toolCalls.map((t) => t.id === toolId ? { ...t, status: status as ToolCall['status'] } : t) }
            }
            return { ...prev, toolCalls: [...prev.toolCalls, { id: toolId, name: toolName, input: inputStr, status: status as ToolCall['status'] }] }
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
          if (sessionId) {
            void ipc.getChatHistory(sessionId, 100).then((msgs) => {
              setMessages(msgs.map(toUnifiedMessage))
              isProcessingRef.current = false
              setStreaming(INITIAL_STREAMING_STATE)
              onCompleteRef.current?.()
            })
          }
        })
        listeners.push(unlistenComplete)

        const unlistenError = await listen<OrchestratorEvent>('orchestrator:error', (event) => {
          if (event.payload.workspaceId !== workspaceId) return
          isProcessingRef.current = false
          setStreaming(INITIAL_STREAMING_STATE)
          setError(event.payload.message ?? 'An error occurred')
        })
        listeners.push(unlistenError)
      }

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
    if (!streaming.isStreaming && !isProcessingRef.current && queue.length > 0 && !failedMessage && canSend) {
      const [next, ...rest] = queue
      if (!next) return
      setQueue(rest)

      isProcessingRef.current = true
      setStreaming((prev) => ({ ...prev, isStreaming: true, startTime: Date.now() }))

      const optimisticMessage: UnifiedMessage = {
        id: `temp-${String(Date.now())}`,
        role: 'user',
        content: next.content,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimisticMessage])

      const processQueued = async () => {
        try {
          if (mode === 'agent' && taskId) {
            await ipc.streamAgentChat(taskId, next.content, workingDir, cliPath, next.model, next.effortLevel)
          } else if (mode === 'orchestrator' && workspaceId && sessionId) {
            await ipc.streamOrchestratorChat(workspaceId, sessionId, next.content, connectionMode, apiKey, apiKeyEnvVar, next.model, cliPath)
          }
        } catch (err) {
          setFailedMessage({ id: next.id, content: next.content, model: next.model, effortLevel: next.effortLevel, error: getErrorMessage(err) })
          isProcessingRef.current = false
          setStreaming(INITIAL_STREAMING_STATE)
        }
      }
      void processQueued()
    }
  }, [streaming.isStreaming, queue, failedMessage, canSend, mode, taskId, workspaceId, sessionId, workingDir, cliPath, connectionMode, apiKey, apiKeyEnvVar])

  // ─── Actions ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (content: string, model?: string, effortLevel?: string) => {
      if (!canSend) return

      // Detect model switch — insert divider and build context preamble
      let effectiveContent = content
      const prevModel = lastModelRef.current
      const modelSwitched = prevModel !== null && model !== undefined && prevModel !== model

      if (modelSwitched) {
        const modelName = model.charAt(0).toUpperCase() + model.slice(1)
        const dividerContent = `Switched to ${modelName}`
        if (mode === 'agent' && taskId) {
          try { await ipc.saveAgentMessage(taskId, 'system', dividerContent) } catch { /* non-critical */ }
        }
        const dividerMessage: UnifiedMessage = {
          id: `switch-${String(Date.now())}`,
          role: 'system',
          content: dividerContent,
          createdAt: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, dividerMessage])

        const preamble = buildContextPreamble(messagesRef.current)
        if (preamble) effectiveContent = preamble + content
      }

      if (model) lastModelRef.current = model

      // Optimistic user message (shows original content, not the preamble)
      const optimisticMessage: UnifiedMessage = {
        id: `temp-${String(Date.now())}`,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimisticMessage])

      // Queue if currently processing
      if (isProcessingRef.current) {
        setQueue((prev) => [...prev, { id: `queued-${String(Date.now())}`, content: effectiveContent, model, effortLevel }])
        return
      }

      try {
        isProcessingRef.current = true
        setStreaming({ isStreaming: true, content: '', thinkingContent: '', toolCalls: [], startTime: Date.now() })
        setError(null)
        setFailedMessage(null)

        if (mode === 'agent' && taskId) {
          await ipc.streamAgentChat(taskId, effectiveContent, workingDir, cliPath, model, effortLevel)
        } else if (mode === 'orchestrator' && workspaceId && sessionId) {
          await ipc.streamOrchestratorChat(workspaceId, sessionId, effectiveContent, connectionMode, apiKey, apiKeyEnvVar, model, cliPath)
        }
      } catch (err) {
        const errorMsg = getErrorMessage(err)
        onErrorRef.current?.(`Failed to send message: ${errorMsg}`)
        setFailedMessage({ id: `failed-${String(Date.now())}`, content: effectiveContent, model, effortLevel, error: errorMsg })
        isProcessingRef.current = false
        setStreaming(INITIAL_STREAMING_STATE)
      }
    },
    [mode, canSend, taskId, workspaceId, sessionId, workingDir, cliPath, connectionMode, apiKey, apiKeyEnvVar]
  )

  const cancel = useCallback(async () => {
    if (!canSend) {
      setQueue([])
      isProcessingRef.current = false
      setStreaming(INITIAL_STREAMING_STATE)
      return
    }
    try {
      if (mode === 'agent' && taskId) {
        await ipc.cancelAgentChat(taskId)
      } else if (mode === 'orchestrator' && workspaceId && sessionId) {
        await ipc.cancelOrchestratorChat(sessionId, workspaceId)
      }
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

  const clearError = useCallback(() => { setError(null) }, [])

  const retryFailed = useCallback(async () => {
    if (!failedMessage) return
    const { content, model, effortLevel } = failedMessage
    setFailedMessage(null)
    await sendMessage(content, model, effortLevel)
  }, [failedMessage, sendMessage])

  const dismissFailed = useCallback(() => { setFailedMessage(null) }, [])

  const clearQueue = useCallback(() => { setQueue([]) }, [])

  return {
    messages, isLoading, streaming, error, queue, failedMessage, canSend,
    sendMessage, cancel, clearMessages, refreshMessages, clearError, retryFailed, dismissFailed, clearQueue,
  }
}
