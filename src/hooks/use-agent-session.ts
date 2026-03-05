/**
 * Hook for managing agent chat sessions per task.
 * Handles message persistence, streaming state, and event listening.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { AgentMessage } from '@/types'
import * as ipc from '@/lib/ipc'

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

type UseAgentSessionOptions = {
  taskId: string
  workingDir: string
  cliPath: string
  onError?: (error: string) => void
}

export function useAgentSession({
  taskId,
  workingDir,
  cliPath,
  onError,
}: UseAgentSessionOptions) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [streaming, setStreaming] = useState<StreamingState>({
    isStreaming: false,
    content: '',
    thinkingContent: '',
    toolCalls: [],
    startTime: null,
  })

  const unlistenRefs = useRef<Array<() => void>>([])

  // Load existing messages on mount
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const existingMessages = await ipc.getAgentMessages(taskId)
        setMessages(existingMessages)
      } catch (err) {
        onError?.(`Failed to load messages: ${String(err)}`)
      } finally {
        setIsLoading(false)
      }
    }
    void loadMessages()
  }, [taskId, onError])

  // Set up event listeners
  useEffect(() => {
    const setupListeners = async () => {
      // Listen for streaming content
      const unlistenStream = await ipc.onAgentStream((payload) => {
        if (payload.taskId !== taskId) return
        setStreaming((prev) => ({
          ...prev,
          content: prev.content + payload.content,
        }))
      })

      // Listen for thinking content
      const unlistenThinking = await ipc.onAgentThinking((payload) => {
        if (payload.taskId !== taskId) return
        setStreaming((prev) => ({
          ...prev,
          thinkingContent: prev.thinkingContent + payload.content,
        }))
      })

      // Listen for tool calls
      const unlistenToolCall = await ipc.onAgentToolCall((payload) => {
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
            toolCalls: [
              ...prev.toolCalls,
              { id: toolId, name: toolName, input: toolInput, status },
            ],
          }
        })
      })

      // Listen for completion
      const unlistenComplete = await ipc.onAgentComplete((payload) => {
        if (payload.taskId !== taskId) return
        setStreaming({
          isStreaming: false,
          content: '',
          thinkingContent: '',
          toolCalls: [],
          startTime: null,
        })
        // Refresh messages after completion
        void ipc.getAgentMessages(taskId).then(setMessages)
      })

      unlistenRefs.current = [
        unlistenStream,
        unlistenThinking,
        unlistenToolCall,
        unlistenComplete,
      ]
    }

    void setupListeners()

    return () => {
      unlistenRefs.current.forEach((unlisten) => {
        unlisten()
      })
      unlistenRefs.current = []
    }
  }, [taskId])

  // Send a message and stream response
  const sendMessage = useCallback(
    async (content: string, model?: string, effortLevel?: string) => {
      try {
        // Start streaming state
        setStreaming({
          isStreaming: true,
          content: '',
          thinkingContent: '',
          toolCalls: [],
          startTime: Date.now(),
        })

        // Invoke backend streaming command
        await ipc.streamAgentChat(
          taskId,
          content,
          workingDir,
          cliPath,
          model,
          effortLevel
        )
      } catch (err) {
        onError?.(`Failed to send message: ${String(err)}`)
        setStreaming({
          isStreaming: false,
          content: '',
          thinkingContent: '',
          toolCalls: [],
          startTime: null,
        })
      }
    },
    [taskId, workingDir, cliPath, onError]
  )

  // Cancel ongoing streaming
  const cancel = useCallback(async () => {
    try {
      await ipc.cancelAgentChat(taskId)
    } catch (err) {
      onError?.(`Failed to cancel: ${String(err)}`)
    }
  }, [taskId, onError])

  // Save an assistant message (typically called after streaming completes)
  const saveAssistantMessage = useCallback(
    async (
      content: string,
      model?: string,
      effortLevel?: string,
      toolCalls?: string,
      thinkingContent?: string
    ) => {
      try {
        const message = await ipc.saveAgentMessage(
          taskId,
          'assistant',
          content,
          model,
          effortLevel,
          toolCalls,
          thinkingContent
        )
        setMessages((prev) => [...prev, message])
        return message
      } catch (err) {
        onError?.(`Failed to save message: ${String(err)}`)
        return null
      }
    },
    [taskId, onError]
  )

  // Clear all messages for this task
  const clearMessages = useCallback(async () => {
    try {
      await ipc.clearAgentMessages(taskId)
      setMessages([])
    } catch (err) {
      onError?.(`Failed to clear messages: ${String(err)}`)
    }
  }, [taskId, onError])

  // Refresh messages from DB
  const refreshMessages = useCallback(async () => {
    try {
      const msgs = await ipc.getAgentMessages(taskId)
      setMessages(msgs)
    } catch (err) {
      onError?.(`Failed to refresh messages: ${String(err)}`)
    }
  }, [taskId, onError])

  return {
    messages,
    isLoading,
    streaming,
    sendMessage,
    cancel,
    saveAssistantMessage,
    clearMessages,
    refreshMessages,
  }
}
