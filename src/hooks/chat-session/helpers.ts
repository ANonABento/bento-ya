/**
 * Helper utilities for the chat session hook.
 * Includes error extraction, message format conversion, and context preamble building.
 */

import type { AgentMessage } from '@/types'
import type { ChatMessage } from '@/lib/ipc'
import type { UnifiedMessage } from './types'

// Re-export from shared location for backward compatibility
export { getErrorMessage } from '@/lib/errors'

/** Convert backend message formats (AgentMessage | ChatMessage) to the unified frontend format */
export function toUnifiedMessage(msg: AgentMessage | ChatMessage): UnifiedMessage {
  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    createdAt: msg.createdAt,
  }
}

/** Extract a short summary from an assistant message (first sentence/line before code) */
function summarizeAssistantMessage(content: string): string {
  const beforeCode = content.split(/```|\n\n/)[0] ?? content
  const trimmed = beforeCode.trim()
  return trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed
}

/**
 * Build a context preamble from previous messages for a model switch.
 * When the user switches models mid-conversation, this provides the new model
 * with a summary of what happened so far (last 20 messages, capped at 4k chars).
 */
export function buildContextPreamble(messages: UnifiedMessage[]): string {
  if (messages.length === 0) return ''

  const userMessages: string[] = []
  const agentSummaries: string[] = []

  const recent = messages.slice(-20)
  for (const msg of recent) {
    if (msg.role === 'user') {
      const content = msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content
      userMessages.push(content)
    } else if (msg.role === 'assistant') {
      const summary = summarizeAssistantMessage(msg.content)
      if (summary) agentSummaries.push(summary)
    }
  }

  if (userMessages.length === 0) return ''

  let preamble = '[Previous conversation context]\n\n'
  preamble += 'User requests:\n'
  for (const msg of userMessages) {
    preamble += `- ${msg}\n`
  }
  if (agentSummaries.length > 0) {
    preamble += '\nAgent progress:\n'
    for (const summary of agentSummaries) {
      preamble += `- ${summary}\n`
    }
  }
  preamble += '\n---\n'

  if (preamble.length > 4000) {
    return preamble.slice(0, 3990) + '\n...\n---\n'
  }
  return preamble
}
