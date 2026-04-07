/**
 * Agent Panel - Per-task agent chat interface.
 * Uses the unified chat session hook and shared ChatInput component.
 */

import { useState, useCallback, useEffect } from 'react'
import type { Task } from '@/types'
import { buildPromptWithAttachments } from '@/types'
import { thinkingToEffort } from '@/components/shared/thinking-selector'
import { useChatSession } from '@/hooks/chat-session'
import { useCliPath } from '@/hooks/use-cli-path'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { ChatHistory } from './chat-history'
import { ErrorBanner, FailedMessageBanner, CliDetectingBanner, ChatInput, type ChatInputMessage, mapToolCalls, mapMessages } from './shared'

type AgentPanelProps = {
  task: Task
  onClose?: () => void
}

export function AgentPanel({ task, onClose }: AgentPanelProps) {
  const [localError, setLocalError] = useState<string | null>(null)

  // Get working directory from workspace
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = workspace?.repoPath ?? ''

  // Get CLI path with auto-detection
  const { cliPath, isDetecting: cliDetecting, detectionError: cliDetectionError } = useCliPath()

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
  const handleInputChange = useCallback(() => {
    if (error) {
      setLocalError(null)
      clearError()
    }
  }, [error, clearError])

  const handleSendMessage = useCallback(async (message: ChatInputMessage) => {
    const effortLevel = message.thinkingLevel ? thinkingToEffort(message.thinkingLevel) : undefined
    // Build prompt with attachment references for CLI mode
    const prompt = buildPromptWithAttachments(message.content, message.attachments)
    await sendMessage(prompt, message.model, effortLevel)
  }, [sendMessage])

  const handleClearHistory = useCallback(async () => {
    if (window.confirm('Clear all messages for this task?')) {
      await clearMessages()
    }
  }, [clearMessages])

  const chatMessages = mapMessages(messages, task.workspaceId, task.id)
  const toolCalls = mapToolCalls(streaming.toolCalls, task.workspaceId)
  const queuedMessages = queue

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
              title="Close agent chat (Esc)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 3l5 4-5 4" />
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

      {/* CLI Detection Indicator */}
      {cliDetecting && <CliDetectingBanner />}
      {/* Error Banner */}
      {error && !failedMessage && !cliDetecting && (
        <ErrorBanner
          error={error}
          onDismiss={() => { setLocalError(null); clearError(); }}
        />
      )}
      {/* Failed Message with Retry */}
      {failedMessage && (
        <FailedMessageBanner
          error={failedMessage.error}
          onRetry={() => { void retryFailed() }}
          onDismiss={dismissFailed}
        />
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
      <ChatInput
        config={{
          showModelSelector: true,
          showContextToggle: true,
          showThinkingSelector: true,
          showPermissionSelector: true,
          showVoiceInput: true,
          showAttachments: true,
          placeholder: cliDetecting ? 'Detecting CLI...' : `Ask agent about "${task.title}"...`,
        }}
        onSend={(msg) => { void handleSendMessage(msg) }}
        onCancel={() => { void cancel() }}
        onInputChange={handleInputChange}
        onAttachmentError={(err) => { setLocalError(`${err.file}: ${err.message}`) }}
        isProcessing={streaming.isStreaming}
        disabled={cliDetecting}
        queueCount={queue.length}
        messageCount={messages.length}
      />
    </div>
  )
}
