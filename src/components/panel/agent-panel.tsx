import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import {
  CliChatHistory,
  CliChatInput,
  type SendMessageParams,
} from '@/components/shared/cli-chat'
import { useAgentSession } from '@/hooks/use-agent-session'
import type { Task } from '@/types/task'

type AgentPanelProps = {
  task: Task
  workingDir?: string
  cliPath?: string
  onClose: () => void
}

export function AgentPanel({ task, workingDir, cliPath, onClose }: AgentPanelProps) {
  const [initError, setInitError] = useState<string | null>(null)

  const {
    messages,
    isProcessing,
    processingStartTime,
    streamingContent,
    thinkingContent,
    toolCalls,
    isInitialized,
    error,
    initSession,
    sendMessage,
    cancel,
    reset,
  } = useAgentSession({
    taskId: task.id,
    workingDir: workingDir ?? '',
    cliPath: cliPath ?? 'claude',
  })

  // Auto-initialize session when panel opens
  useEffect(() => {
    if (!isInitialized && workingDir && cliPath) {
      initSession().catch((err) => {
        setInitError(err instanceof Error ? err.message : String(err))
      })
    }
  }, [isInitialized, workingDir, cliPath, initSession])

  const handleSendMessage = useCallback(
    (params: SendMessageParams) => {
      sendMessage(params)
    },
    [sendMessage]
  )

  const handleCancel = useCallback(async () => {
    await cancel()
  }, [cancel])

  const handleReset = useCallback(async () => {
    setInitError(null)
    await reset()
    // Re-initialize after reset
    if (workingDir && cliPath) {
      await initSession()
    }
  }, [reset, initSession, workingDir, cliPath])

  // Combine messages with streaming state for display
  const displayMessages = useMemo(() => {
    const msgs = [...messages]

    // Add streaming assistant message if currently streaming
    if (streamingContent && isProcessing) {
      msgs.push({
        id: 'streaming',
        role: 'assistant' as const,
        content: streamingContent,
        taskId: task.id,
        createdAt: new Date().toISOString(),
      })
    }

    return msgs
  }, [messages, streamingContent, isProcessing, task.id])

  const displayError = error || initError

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex flex-col h-full bg-surface border-l border-border"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-text-primary truncate">{task.title}</h2>
            <p className="text-xs text-text-secondary">Agent Panel</p>
          </div>
        </div>

        {/* Agent controls */}
        <div className="flex items-center gap-2">
          {isProcessing && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 rounded-md hover:bg-red-500/30 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium bg-surface-hover text-text-secondary rounded-md hover:bg-border transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="px-4 py-2 border-b border-border bg-surface-hover">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isProcessing
                  ? 'bg-blue-400 animate-pulse'
                  : isInitialized
                    ? 'bg-green-400'
                    : 'bg-text-secondary'
              }`}
            />
            <span className="text-xs text-text-secondary">
              {isProcessing ? 'Processing...' : isInitialized ? 'Ready' : 'Initializing...'}
            </span>
          </div>

          {/* Thinking indicator */}
          {thinkingContent && (
            <span className="text-xs text-text-secondary italic truncate max-w-[200px]">
              Thinking...
            </span>
          )}

          {/* Tool call indicators */}
          {toolCalls.length > 0 && (
            <div className="flex items-center gap-1">
              {toolCalls.map((tool) => (
                <span
                  key={tool.toolId}
                  className={`px-2 py-0.5 text-[10px] rounded ${
                    tool.status === 'running'
                      ? 'bg-blue-500/20 text-blue-400'
                      : tool.status === 'complete'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {tool.toolName}
                </span>
              ))}
            </div>
          )}

          {/* Processing time */}
          {processingStartTime && (
            <ProcessingTimer startTime={processingStartTime} />
          )}
        </div>
        {displayError && <p className="mt-1 text-xs text-red-400">{displayError}</p>}
      </div>

      {/* Task context */}
      {task.description && (
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-xs font-medium text-text-secondary mb-2">Task Description</h3>
          <div className="text-sm text-text-primary bg-bg rounded-md p-2 max-h-32 overflow-y-auto">
            <pre className="whitespace-pre-wrap font-mono text-xs">{task.description}</pre>
          </div>
        </div>
      )}

      {/* Chat history */}
      <CliChatHistory
        messages={displayMessages}
        isLoading={!isInitialized && !displayError}
        emptyStateMessage={isInitialized ? 'Start a conversation' : 'Initializing agent...'}
        emptyStateHint={isInitialized ? 'Type a message below' : 'Please wait...'}
        streamingContent=""
        thinkingContent={thinkingContent}
        toolCalls={toolCalls}
      />

      {/* Input */}
      <CliChatInput
        onSendMessage={handleSendMessage}
        disabled={!isInitialized || isProcessing}
        placeholder={
          !isInitialized
            ? 'Initializing agent...'
            : isProcessing
              ? 'Agent is processing...'
              : 'Send message to agent...'
        }
        showModelPicker={false}
        showVoiceInput={false}
      />
    </motion.div>
  )
}

// Helper component for processing time display
function ProcessingTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => { clearInterval(interval); }
  }, [startTime])

  return (
    <span className="text-xs text-text-secondary tabular-nums">
      {elapsed}s
    </span>
  )
}
