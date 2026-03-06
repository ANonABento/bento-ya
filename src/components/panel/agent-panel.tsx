/**
 * Agent Panel - Per-task agent chat interface.
 * Uses the shared CLI chat components and agent session hook.
 */

import { useState, useCallback } from 'react'
import type { Task } from '@/types'
import { useAgentSession } from '@/hooks/use-agent-session'
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

  // Get working directory from workspace
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = workspace?.repoPath ?? ''

  // Default CLI path - could come from settings
  const cliPath = 'claude'

  const {
    messages,
    isLoading,
    streaming,
    sendMessage,
    cancel,
    clearMessages,
  } = useAgentSession({
    taskId: task.id,
    workingDir,
    cliPath,
    onError: (err) => {
      console.error('[AgentPanel]', err)
    },
  })

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

  // Convert AgentMessage[] to ChatMessage[] format for ChatHistory
  const chatMessages = messages.map((msg) => ({
    id: msg.id,
    workspaceId: task.workspaceId,
    sessionId: task.id,
    role: msg.role as 'user' | 'assistant',
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
          {streaming.isStreaming && (
            <button
              type="button"
              onClick={() => void cancel()}
              className="text-[10px] text-red-500 hover:text-red-400"
            >
              Cancel
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

      {/* Chat History */}
      <ChatHistory
        messages={chatMessages}
        isLoading={isLoading}
        streamingContent={streaming.content}
        processingStartTime={streaming.startTime}
        thinkingContent={streaming.thinkingContent}
        toolCalls={toolCalls}
        onCancel={streaming.isStreaming ? () => { void cancel() } : undefined}
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
              setInputValue(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Ask agent about "${task.title}"...`}
            disabled={streaming.isStreaming}
            className="flex-1 resize-none rounded-lg border border-border-default bg-surface-hover px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none disabled:opacity-50"
            rows={2}
          />
          <button
            type="button"
            onClick={() => void handleSendMessage()}
            disabled={streaming.isStreaming || !inputValue.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
