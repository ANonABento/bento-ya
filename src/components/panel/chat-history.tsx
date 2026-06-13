import { useState, useEffect, useRef, memo } from 'react'
import { motion } from 'motion/react'
import type { ChatMessage } from '@/lib/ipc'
import { ToolCallItem, type ToolCallData } from './shared'
import { ChatEntry, ChatDivider, ChatMarkdown } from './chat-flat'

type QueuedMessage = {
  id: string
  content: string
}

type ChatHistoryProps = {
  messages: ChatMessage[]
  isLoading?: boolean
  streamingContent?: string
  processingStartTime?: number | null
  thinkingContent?: string
  toolCalls?: ToolCallData[]
  queuedMessages?: QueuedMessage[]
  emptyState?: React.ReactNode
  /** Role label for assistant turns (the chef chat shows "chef"). */
  assistantLabel?: string
}

export function ChatHistory({
  messages,
  isLoading = false,
  streamingContent = '',
  processingStartTime = null,
  thinkingContent = '',
  toolCalls = [],
  queuedMessages = [],
  emptyState,
  assistantLabel = 'chef',
}: ChatHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingContent, thinkingContent, toolCalls])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-text-secondary">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading history...</span>
        </div>
      </div>
    )
  }

  if (messages.length === 0 && !processingStartTime) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        {emptyState ?? (
          <div className="text-center">
            <p className="text-sm text-text-secondary">No messages yet</p>
            <p className="mt-1 text-xs text-text-secondary/70">
              Ask me to create tasks for you
            </p>
          </div>
        )}
      </div>
    )
  }

  const isProcessing = processingStartTime !== null

  return (
    <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-bg px-4 py-3">
      {messages.map((msg, index) => (
        <MessageEntry
          key={msg.id}
          message={msg}
          assistantLabel={assistantLabel}
          isLatest={index === messages.length - 1 && !isProcessing && queuedMessages.length === 0}
        />
      ))}
      {isProcessing && (
        <StreamingEntry
          content={streamingContent}
          startTime={processingStartTime}
          thinkingContent={thinkingContent}
          toolCalls={toolCalls}
          queueCount={queuedMessages.length}
          assistantLabel={assistantLabel}
        />
      )}
      {queuedMessages.map((queued) => (
        <QueuedEntry key={queued.id} content={queued.content} />
      ))}
    </div>
  )
}

type MessageEntryProps = {
  message: ChatMessage
  assistantLabel: string
  isLatest: boolean
}

type ParsedAction = { action: string; title?: string; column?: string; task_id?: string }

// Parse ```action blocks from message content; return display text + actions.
function parseMessageContent(content: string): { displayText: string; actions: ParsedAction[] } {
  const actions: ParsedAction[] = []
  const actionBlockRegex = /```action\s*\n?([\s\S]*?)```/g
  let match

  while ((match = actionBlockRegex.exec(content)) !== null) {
    try {
      const captured = match[1]
      if (!captured) continue
      const parsed: unknown = JSON.parse(captured.trim())
      if (Array.isArray(parsed)) {
        actions.push(...(parsed as ParsedAction[]))
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  const displayText = content.replace(actionBlockRegex, '').trim()
  return { displayText, actions }
}

function formatAction(action: ParsedAction): string {
  switch (action.action) {
    case 'create_task':
      return `Created "${action.title ?? 'task'}"${action.column ? ` in ${action.column}` : ''}`
    case 'update_task':
      return `Updated task${action.title ? `: "${action.title}"` : ''}`
    case 'move_task':
      return `Moved task to ${action.column ?? 'column'}`
    case 'delete_task':
      return 'Deleted task'
    default:
      return action.action
  }
}

// Memoized: while a response streams, the parent re-renders on every token but
// the settled history messages don't change — skip re-rendering them.
const MessageEntry = memo(function MessageEntry({ message, assistantLabel, isLatest }: MessageEntryProps) {
  if (message.role === 'system') {
    return <ChatDivider isLatest={isLatest}>{message.content}</ChatDivider>
  }

  const isUser = message.role === 'user'
  const { displayText, actions } = isUser
    ? { displayText: message.content, actions: [] as ParsedAction[] }
    : parseMessageContent(message.content)

  return (
    <ChatEntry
      tone={isUser ? 'user' : 'agent'}
      label={isUser ? 'you' : assistantLabel}
      timestamp={message.createdAt}
      isLatest={isLatest}
    >
      {actions.length > 0 && <ActionList actions={actions} />}
      {displayText && <ChatMarkdown content={displayText} />}
    </ChatEntry>
  )
})

function ActionList({ actions }: { actions: ParsedAction[] }) {
  return (
    <div className="mb-2 space-y-1">
      {actions.map((action, idx) => (
        <div key={idx} className="flex items-center gap-2 rounded bg-surface/40 px-2 py-1 text-xs">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0 text-running">
            <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
          </svg>
          <span className="text-text-secondary">{formatAction(action)}</span>
        </div>
      ))}
    </div>
  )
}

type StreamingEntryProps = {
  content: string
  startTime?: number | null
  thinkingContent?: string
  toolCalls?: ToolCallData[]
  queueCount?: number
  assistantLabel: string
}

function StreamingEntry({
  content,
  startTime,
  thinkingContent = '',
  toolCalls = [],
  queueCount = 0,
  assistantLabel,
}: StreamingEntryProps) {
  const [elapsed, setElapsed] = useState(0)
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false)

  useEffect(() => {
    if (!startTime) {
      setElapsed(0)
      return
    }
    setElapsed(Math.floor((Date.now() - startTime) / 1000))
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => { clearInterval(interval) }
  }, [startTime])

  const hasThinking = thinkingContent.length > 0
  const hasToolCalls = toolCalls.length > 0
  const hasContent = content.length > 0

  const statusLabel = hasContent ? 'Typing' : hasToolCalls ? 'Using tools' : hasThinking ? 'Thinking' : 'Processing'
  const detail = [
    statusLabel,
    elapsed > 0 ? `${String(elapsed)}s` : null,
    queueCount > 0 ? `${String(queueCount)} queued` : null,
  ].filter(Boolean).join(' · ')

  return (
    <ChatEntry tone="running" label={assistantLabel} detail={detail} isLatest>
      <div className="space-y-2">
        {hasThinking && (
          <div className="border-l-2 border-accent/30 pl-2">
            <button
              type="button"
              onClick={() => { setIsThinkingExpanded(!isThinkingExpanded) }}
              className="flex items-center gap-1 text-xs text-text-secondary transition-colors hover:text-text-primary"
              style={{ cursor: 'pointer' }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className={`h-3 w-3 transition-transform ${isThinkingExpanded ? 'rotate-90' : ''}`}
              >
                <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
              <span className="italic">Thinking...</span>
            </button>
            {isThinkingExpanded && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary/80">{thinkingContent}</p>
            )}
          </div>
        )}

        {hasToolCalls && (
          <div className="space-y-1">
            {toolCalls.map((tool) => (
              <ToolCallItem
                key={tool.toolId}
                toolCall={{
                  toolId: tool.toolId,
                  toolName: tool.toolName,
                  status: tool.status,
                  input: tool.input,
                }}
              />
            ))}
          </div>
        )}

        {hasContent ? (
          <ChatMarkdown content={content} />
        ) : !hasThinking && !hasToolCalls ? (
          <TypingDots />
        ) : null}
      </div>
    </ChatEntry>
  )
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 0.2, 0.4].map((delay) => (
        <motion.span
          key={delay}
          className="h-2 w-2 rounded-full bg-accent"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay }}
        />
      ))}
    </div>
  )
}

// Pending (not-yet-sent) turn. Visually distinct from sent messages: a muted,
// dashed, indented wrap with a "Queued" pill — so it reads as "waiting", not
// "delivered".
function QueuedEntry({ content }: { content: string }) {
  return (
    <div className="ml-3 rounded-md border border-dashed border-border-default bg-surface/30 px-3 py-2 opacity-70">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary/70">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3 w-3" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Queued
      </div>
      <div className="whitespace-pre-wrap break-words text-sm text-text-secondary">{content}</div>
    </div>
  )
}
