import { useEffect, useRef } from 'react'
import {
  CliChatBubble,
  StreamingBubble,
  QueuedBubble,
  type ChatMessageData,
  type ActionParser,
  type ToolCallData,
} from './cli-chat-bubble'

type QueuedMessage = {
  id: string
  content: string
}

type CliChatHistoryProps = {
  messages: ChatMessageData[]
  isLoading?: boolean
  streamingContent?: string
  processingStartTime?: number | null
  thinkingContent?: string
  toolCalls?: ToolCallData[]
  onCancel?: () => void
  queuedMessages?: QueuedMessage[]
  actionParser?: ActionParser
  emptyStateMessage?: string
  emptyStateHint?: string
}

export function CliChatHistory({
  messages,
  isLoading = false,
  streamingContent = '',
  processingStartTime = null,
  thinkingContent = '',
  toolCalls = [],
  onCancel,
  queuedMessages = [],
  actionParser,
  emptyStateMessage = 'No messages yet',
  emptyStateHint = 'Start a conversation',
}: CliChatHistoryProps) {
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
        <div className="text-center">
          <p className="text-sm text-text-secondary">{emptyStateMessage}</p>
          <p className="mt-1 text-xs text-text-secondary/70">{emptyStateHint}</p>
        </div>
      </div>
    )
  }

  const isProcessing = processingStartTime !== null

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map((msg, index) => (
        <CliChatBubble
          key={msg.id}
          message={msg}
          isLatest={index === messages.length - 1 && !isProcessing && queuedMessages.length === 0}
          actionParser={actionParser}
        />
      ))}
      {isProcessing && (
        <StreamingBubble
          content={streamingContent}
          startTime={processingStartTime}
          thinkingContent={thinkingContent}
          toolCalls={toolCalls}
          onCancel={onCancel}
          queueCount={queuedMessages.length}
        />
      )}
      {/* Queued messages shown as pending */}
      {queuedMessages.map((queued) => (
        <QueuedBubble key={queued.id} content={queued.content} />
      ))}
    </div>
  )
}
