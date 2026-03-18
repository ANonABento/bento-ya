/**
 * Chat session hook - barrel export.
 * Re-exports everything from the split modules for backward compatibility.
 */
export { useChatSession } from './use-chat-session'
export type {
  ChatMode,
  ToolCall,
  StreamingState,
  UnifiedMessage,
  QueuedMessage,
  FailedMessage,
  ChatSessionConfig,
  ChatSessionState,
  ChatSessionActions,
} from './types'
export { INITIAL_STREAMING_STATE } from './types'
export { getErrorMessage, toUnifiedMessage, buildContextPreamble } from './helpers'
