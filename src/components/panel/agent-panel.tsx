import { useState, useCallback } from 'react'
import { motion } from 'motion/react'
import {
  CliChatHistory,
  CliChatInput,
  type ChatMessageData,
  type SendMessageParams,
} from '@/components/shared/cli-chat'
import { useAgent } from '@/hooks/use-agent'
import type { Task } from '@/types/task'

type AgentPanelProps = {
  task: Task
  workingDir?: string
  cliPath?: string
  onClose: () => void
}

export function AgentPanel({ task, workingDir, cliPath, onClose }: AgentPanelProps) {
  const { status, startAgent, stopAgent } = useAgent({
    taskId: task.id,
    agentType: 'claude-code',
    workingDir,
    cliPath,
  })

  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageData[]>([])

  const handleStartAgent = useCallback(async () => {
    setIsStarting(true)
    setError(null)
    try {
      await startAgent()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStarting(false)
    }
  }, [startAgent])

  const handleStopAgent = useCallback(async () => {
    try {
      await stopAgent()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [stopAgent])

  // Placeholder for future chat integration
  const handleSendMessage = useCallback((_params: SendMessageParams) => {
    // TODO: Implement agent chat when backend supports it
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content: _params.content,
      },
      {
        id: `system-${Date.now()}`,
        role: 'system',
        content: 'Agent chat coming soon. Use the agent status panel to monitor progress.',
      },
    ])
  }, [])

  const isRunning = status === 'running'

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
          {isRunning ? (
            <button
              type="button"
              onClick={handleStopAgent}
              className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 rounded-md hover:bg-red-500/30 transition-colors"
            >
              Stop Agent
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartAgent}
              disabled={isStarting}
              className="px-3 py-1.5 text-xs font-medium bg-accent/20 text-accent rounded-md hover:bg-accent/30 transition-colors disabled:opacity-50"
            >
              {isStarting ? 'Starting...' : 'Start Agent'}
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="px-4 py-2 border-b border-border bg-surface-hover">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isRunning ? 'bg-green-400 animate-pulse' : 'bg-text-secondary'
            }`}
          />
          <span className="text-xs text-text-secondary capitalize">{status}</span>
        </div>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
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
        messages={messages}
        isLoading={false}
        emptyStateMessage={isRunning ? 'Agent is running' : 'Agent not started'}
        emptyStateHint={isRunning ? 'Chat integration coming soon' : 'Start the agent to begin'}
      />

      {/* Input */}
      <CliChatInput
        onSendMessage={handleSendMessage}
        disabled={!isRunning}
        placeholder={isRunning ? 'Send message to agent...' : 'Start the agent first'}
        showModelPicker={false}
        showVoiceInput={false}
      />
    </motion.div>
  )
}
