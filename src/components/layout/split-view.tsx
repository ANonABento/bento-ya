import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTaskStore } from '@/stores/task-store'
import { TaskDetailPanel } from '@/components/task-detail/task-detail-panel'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAgentSession } from '@/hooks/use-agent-session'
import {
  CliChatHistory,
  CliChatInput,
  type SendMessageParams,
} from '@/components/shared/cli-chat'

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 28 }

type SplitViewProps = {
  taskId: string
  onClose: () => void
}

export function SplitView({ taskId, onClose }: SplitViewProps) {
  const tasks = useTaskStore((s) => s.tasks)
  const task = tasks.find((t) => t.id === taskId)

  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)

  // Get settings to determine which CLI to use
  const settings = useSettingsStore((s) => s.getEffective(activeWorkspaceId ?? ''))

  // Find enabled provider that uses CLI mode
  const cliProvider = settings.model.providers.find(
    (p) => p.enabled && p.connectionMode === 'cli'
  )
  const cliPath = cliProvider?.cliPath ?? cliProvider?.id ?? 'claude'
  const workingDir = workspace?.repoPath ?? ''

  const hasInitializedRef = useRef(false)
  const prevTaskIdRef = useRef(taskId)
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
    taskId,
    workingDir,
    cliPath,
  })

  // Reset when taskId changes
  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      hasInitializedRef.current = false
      prevTaskIdRef.current = taskId
      void reset()
    }
  }, [taskId, reset])

  // Auto-initialize session when split view opens
  useEffect(() => {
    if (!hasInitializedRef.current && workingDir && cliPath) {
      hasInitializedRef.current = true
      setInitError(null)
      initSession().catch((err: unknown) => {
        const errorMsg = err instanceof Error
          ? err.message
          : (err && typeof err === 'object' && 'message' in err)
            ? String((err as { message: unknown }).message)
            : String(err)
        console.error('[SplitView] Failed to init agent session:', errorMsg)
        setInitError(errorMsg)
      })
    }
  }, [workingDir, cliPath, initSession])

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
    hasInitializedRef.current = false
    setInitError(null)
    await reset()
    // Re-initialize after reset
    if (workingDir && cliPath) {
      hasInitializedRef.current = true
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
        taskId,
        createdAt: new Date().toISOString(),
      })
    }

    return msgs
  }, [messages, streamingContent, isProcessing, taskId])

  const displayError = error || initError

  if (!task) return null

  return (
    <div className="flex h-full">
      {/* Left panel — task details */}
      <motion.div
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: 240, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={SPRING}
        className="shrink-0 overflow-hidden border-r border-border-default bg-surface"
      >
        <div className="h-full w-[240px]">
          <TaskDetailPanel task={task} onClose={onClose} />
        </div>
      </motion.div>

      {/* Right panel — agent chat */}
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={SPRING}
        className="flex flex-1 flex-col overflow-hidden bg-surface"
      >
        {/* Status/Error bar */}
        {!cliPath && (
          <div className="shrink-0 border-b border-border-default bg-yellow-900/20 px-4 py-2 text-xs text-yellow-400">
            No CLI provider configured. Go to Settings → Agent to configure a provider with CLI mode.
          </div>
        )}

        {/* Header bar with status */}
        <div className="shrink-0 border-b border-border px-4 py-2 bg-surface-hover">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-2 h-2 shrink-0 rounded-full ${
                  isProcessing
                    ? 'bg-blue-400 animate-pulse'
                    : isInitialized
                      ? 'bg-green-400'
                      : 'bg-text-secondary'
                }`}
              />
              <span className="text-xs font-medium text-text-primary truncate">
                Agent: {task.title}
              </span>
              <span className="text-xs text-text-secondary shrink-0">
                {isProcessing ? '• Processing' : isInitialized ? '• Ready' : '• Initializing'}
              </span>

              {/* Thinking indicator */}
              {thinkingContent && (
                <span className="text-xs text-accent shrink-0 italic">— Thinking...</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Tool call indicators */}
              {toolCalls.length > 0 && (
                <div className="flex items-center gap-1">
                  {toolCalls.slice(-3).map((tool) => (
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

              {/* Control buttons */}
              {isProcessing && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-2 py-1 text-xs font-medium bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleReset}
                className="px-2 py-1 text-xs font-medium bg-surface text-text-secondary rounded hover:bg-border transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
          {displayError && <p className="mt-1 text-xs text-red-400">{displayError}</p>}
        </div>

        {/* Chat history */}
        <CliChatHistory
          messages={displayMessages}
          isLoading={!isInitialized && !displayError}
          emptyStateMessage={isInitialized ? 'Start a conversation' : 'Initializing agent...'}
          emptyStateHint={isInitialized ? 'Type a message below to interact with the agent' : 'Please wait...'}
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
                : `Message about "${task.title}"...`
          }
          showModelPicker={true}
          showVoiceInput={true}
        />
      </motion.div>
    </div>
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

export function SplitViewWrapper({
  isSplitView,
  taskId,
  onClose,
}: {
  isSplitView: boolean
  taskId: string | null
  onClose: () => void
}) {
  return (
    <AnimatePresence mode="wait">
      {isSplitView && taskId && (
        <motion.div
          key="split-view"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="h-full"
        >
          <SplitView taskId={taskId} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
