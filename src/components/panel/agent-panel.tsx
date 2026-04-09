/**
 * Agent Panel - Per-task agent chat interface.
 */

import type { Task } from '@/types'
import { ChatHistory } from './chat-history'
import { useAgentPanelSession } from './use-agent-panel-session'
import { ErrorBanner, FailedMessageBanner, CliDetectingBanner, ChatInput } from './shared'

type AgentPanelProps = {
  task: Task
  onClose?: () => void
}

export function AgentPanel({ task, onClose }: AgentPanelProps) {
  const {
    chat,
    cliDetecting,
    error,
    chatMessages,
    toolCalls,
    handleAttachmentError,
    handleClearHistory,
    handleInputChange,
    handleSendMessage,
    clearDisplayedError,
  } = useAgentPanelSession(task)

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
          {chat.queue.length > 0 && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              {chat.queue.length} queued
            </span>
          )}
          {chat.streaming.isStreaming && (
            <button
              type="button"
              onClick={() => { void chat.cancel() }}
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
      {error && !chat.failedMessage && !cliDetecting && (
        <ErrorBanner
          error={error}
          onDismiss={clearDisplayedError}
        />
      )}
      {/* Failed Message with Retry */}
      {chat.failedMessage && (
        <FailedMessageBanner
          error={chat.failedMessage.error}
          onRetry={() => { void chat.retryFailed() }}
          onDismiss={chat.dismissFailed}
        />
      )}

      {/* Chat History */}
      <ChatHistory
        messages={chatMessages}
        isLoading={chat.isLoading}
        streamingContent={chat.streaming.content}
        processingStartTime={chat.streaming.startTime}
        thinkingContent={chat.streaming.thinkingContent}
        toolCalls={toolCalls}
        onCancel={chat.streaming.isStreaming ? () => { void chat.cancel() } : undefined}
        queuedMessages={chat.queue}
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
        onCancel={() => { void chat.cancel() }}
        onInputChange={handleInputChange}
        onAttachmentError={handleAttachmentError}
        isProcessing={chat.streaming.isStreaming}
        disabled={cliDetecting}
        queueCount={chat.queue.length}
        messageCount={chat.messages.length}
      />
    </div>
  )
}
