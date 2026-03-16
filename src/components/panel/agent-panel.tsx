/**
 * Agent Panel - Per-task agent chat interface.
 * Uses the unified chat session hook.
 */

import { useState, useCallback, useEffect } from 'react'
import type { Task } from '@/types'
import { useChatSession } from '@/hooks/use-chat-session'
import { useCliPath } from '@/hooks/use-cli-path'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { ChatHistory } from './chat-history'
import { ModelSelector, type ModelId } from '@/components/shared/model-selector'
import { ThinkingSelector, type ThinkingLevel } from '@/components/shared/thinking-selector'

type AgentPanelProps = {
  task: Task
  onClose?: () => void
}

export function AgentPanel({ task, onClose }: AgentPanelProps) {
  const [inputValue, setInputValue] = useState('')
  const [model, setModel] = useState<ModelId>('sonnet')
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium')
  const [localError, setLocalError] = useState<string | null>(null)

  // Get working directory from workspace
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = workspace?.repoPath ?? ''

  // Get CLI path with auto-detection
  const { cliPath, detectionError: cliDetectionError } = useCliPath()

  const {
    messages,
    isLoading,
    streaming,
    error: hookError,
    queue,
    failedMessage,
    sendMessage,
    cancel,
    clearMessages,
    clearError,
    retryFailed,
    dismissFailed,
  } = useChatSession({
    mode: 'agent',
    taskId: task.id,
    workingDir,
    cliPath,
    onError: (err) => {
      console.error('[AgentPanel]', err)
      setLocalError(err)
    },
  })

  // Sync hook error to local state (include CLI detection error)
  const error = localError ?? hookError ?? cliDetectionError
  useEffect(() => {
    if (hookError) setLocalError(hookError)
  }, [hookError])

  // Clear error when user starts typing
  const handleInputChange = (value: string) => {
    setInputValue(value)
    if (error) {
      setLocalError(null)
      clearError()
    }
  }

  const handleSendMessage = useCallback(async () => {
    const content = inputValue.trim()
    if (!content) return
    setInputValue('')
    // Pass model and thinking level to backend
    const effortLevel = thinkingLevel === 'none' ? undefined : thinkingLevel
    await sendMessage(content, model, effortLevel)
  }, [inputValue, sendMessage, model, thinkingLevel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSendMessage()
      }
    },
    [handleSendMessage]
  )

  const handleClearHistory = useCallback(async () => {
    if (window.confirm('Clear all messages for this task?')) {
      await clearMessages()
    }
  }, [clearMessages])

  // Convert UnifiedMessage[] to ChatMessage[] format for ChatHistory
  const chatMessages = messages.map((msg) => ({
    id: msg.id,
    workspaceId: task.workspaceId,
    sessionId: task.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt,
  }))

  // Convert toolCalls to the format expected by ChatHistory
  // Map agent statuses to orchestrator statuses: pending→running, completed→complete
  const mapStatus = (status: 'pending' | 'running' | 'completed' | 'error'): 'running' | 'complete' | 'error' => {
    if (status === 'completed') return 'complete'
    if (status === 'pending') return 'running'
    return status
  }

  const toolCalls = streaming.toolCalls.map((tc) => {
    let parsedInput: Record<string, unknown> | undefined
    if (tc.input) {
      try {
        parsedInput = JSON.parse(tc.input) as Record<string, unknown>
      } catch {
        parsedInput = { raw: tc.input }
      }
    }
    return {
      workspaceId: task.workspaceId,
      toolId: tc.id,
      toolName: tc.name,
      status: mapStatus(tc.status),
      input: parsedInput,
    }
  })

  // Convert queue to format expected by ChatHistory
  const queuedMessages = queue.map((m) => ({ id: m.id, content: m.content }))

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2">
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 3L4 7l4 4" />
              </svg>
            </button>
          )}
          <span className="text-xs font-medium text-text-primary">
            Agent Chat
          </span>
          <span className="text-[10px] text-text-secondary truncate max-w-[120px]">
            {task.title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {queue.length > 0 && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              {queue.length} queued
            </span>
          )}
          {streaming.isStreaming && (
            <button
              type="button"
              onClick={() => void cancel()}
              className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleClearHistory()}
            className="text-[10px] text-text-secondary hover:text-text-primary"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && !failedMessage && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M7 1a6 6 0 100 12A6 6 0 007 1zm0 9a.75.75 0 110-1.5.75.75 0 010 1.5zm.75-3a.75.75 0 01-1.5 0V4.5a.75.75 0 011.5 0V7z"/>
          </svg>
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => { setLocalError(null); clearError(); }}
            className="text-red-400 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* Failed Message with Retry */}
      {failedMessage && (
        <div className="mx-3 mt-2 rounded-md bg-red-500/10 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-red-400">{failedMessage.error}</p>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => { void retryFailed() }}
                className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={dismissFailed}
                className="rounded px-2 py-0.5 text-xs text-red-400/70 hover:bg-red-500/20 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat History */}
      <ChatHistory
        messages={chatMessages}
        isLoading={isLoading}
        streamingContent={streaming.content}
        processingStartTime={streaming.startTime}
        thinkingContent={streaming.thinkingContent}
        toolCalls={toolCalls}
        onCancel={streaming.isStreaming ? () => { void cancel() } : undefined}
        queuedMessages={queuedMessages}
        emptyState={
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="rounded-full bg-surface-hover p-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-secondary">
                <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-xs text-text-secondary">
              Start a conversation with the agent about this task.
            </p>
            <p className="text-[10px] text-text-secondary/60">
              The agent can help implement, debug, or explain code.
            </p>
          </div>
        }
      />

      {/* Input */}
      <div className="border-t border-border-default p-3">
        {/* Model/Thinking selector row */}
        <div className="mb-2 flex items-center gap-1">
          <ModelSelector value={model} onChange={setModel} />
          <ThinkingSelector value={thinkingLevel} onChange={setThinkingLevel} />
        </div>

        {/* Input row */}
        <div className="flex gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => {
              handleInputChange(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Ask agent about "${task.title}"...`}
            disabled={streaming.isStreaming && queue.length >= 5}
            className="flex-1 resize-none rounded-lg border border-border-default bg-surface-hover px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none disabled:opacity-50"
            rows={2}
          />
          <button
            type="button"
            onClick={() => void handleSendMessage()}
            disabled={!inputValue.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {streaming.isStreaming ? 'Queue' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
