/**
 * Shared helpers for chat panels.
 *
 * Extracts duplicated logic from OrchestratorPanel and AgentPanel:
 * - Tool call mapping (streaming toolCalls → ChatHistory format)
 * - Message conversion (UnifiedMessage → ChatMessage format)
 * - Queue formatting
 */

import type { UnifiedMessage } from '@/hooks/chat-session'
import type { ToolCallData } from './tool-call-item'

/** Tool call status as expected by ChatHistory */
type ToolCallStatus = 'running' | 'complete' | 'error'

/** Streaming tool call from useChatSession */
type StreamingToolCall = {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'error'
  input: string
}

/** Map streaming tool calls to the format ChatHistory expects */
export function mapToolCalls(
  toolCalls: StreamingToolCall[],
): ToolCallData[] {
  return toolCalls.map((tc) => {
    let parsedInput: Record<string, unknown> | undefined
    if (tc.input) {
      try {
        parsedInput = JSON.parse(tc.input) as Record<string, unknown>
      } catch {
        parsedInput = { raw: tc.input }
      }
    }

    const status: ToolCallStatus =
      tc.status === 'completed' ? 'complete' :
      tc.status === 'pending' ? 'running' :
      tc.status

    return {
      toolId: tc.id,
      toolName: tc.name,
      status,
      input: parsedInput,
    }
  })
}

/** Convert UnifiedMessage[] to ChatMessage[] for ChatHistory */
export function mapMessages(
  messages: UnifiedMessage[],
  workspaceId: string,
  sessionId: string,
) {
  return messages.map((msg) => ({
    id: msg.id,
    workspaceId,
    sessionId,
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt,
  }))
}
