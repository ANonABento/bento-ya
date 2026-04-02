/**
 * Type definitions for the unified chat session hook.
 * Shared between agent and orchestrator chat modes.
 */

export type ChatMode = 'agent' | 'orchestrator'

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

/** Default (reset) streaming state */
export const INITIAL_STREAMING_STATE: StreamingState = {
  isStreaming: false,
  content: '',
  thinkingContent: '',
  toolCalls: [],
  startTime: null,
}

export type UnifiedMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export type QueuedMessage = {
  id: string
  content: string
  model?: string
  effortLevel?: string
}

export type FailedMessage = {
  id: string
  content: string
  model?: string
  effortLevel?: string
  error: string
}

export type ChatSessionConfig = {
  mode: ChatMode
  // Agent mode
  taskId?: string
  workingDir?: string
  // Orchestrator mode
  workspaceId?: string
  sessionId?: string
  // Shared
  cliPath?: string
  connectionMode?: 'api' | 'cli'
  apiKey?: string
  apiKeyEnvVar?: string
  onError?: (error: string) => void
  /** Called when tools execute (for refreshing board) */
  onToolResult?: () => void
  /** Called when message processing completes (for refreshing session list) */
  onComplete?: () => void
}

export type ChatSessionState = {
  messages: UnifiedMessage[]
  isLoading: boolean
  streaming: StreamingState
  error: string | null
  queue: QueuedMessage[]
  failedMessage: FailedMessage | null
  /** True when all required IDs are available for sending */
  canSend: boolean
}

export type ChatSessionActions = {
  sendMessage: (content: string, model?: string, effortLevel?: string) => Promise<void>
  cancel: () => Promise<void>
  clearMessages: () => Promise<void>
  refreshMessages: () => Promise<void>
  clearError: () => void
  retryFailed: () => Promise<void>
  dismissFailed: () => void
  clearQueue: () => void
}
