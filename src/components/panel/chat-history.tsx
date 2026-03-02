import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import type { ChatMessage } from '@/lib/ipc'

type ChatHistoryProps = {
  messages: ChatMessage[]
  isLoading?: boolean
}

export function ChatHistory({ messages, isLoading = false }: ChatHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

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

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm text-text-secondary">No messages yet</p>
          <p className="mt-1 text-xs text-text-secondary/70">
            Ask me to create tasks for you
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map((msg, index) => (
        <MessageBubble key={msg.id} message={msg} isLatest={index === messages.length - 1} />
      ))}
    </div>
  )
}

type MessageBubbleProps = {
  message: ChatMessage
  isLatest: boolean
}

function MessageBubble({ message, isLatest }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <motion.div
        initial={isLatest ? { opacity: 0, y: 5 } : false}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-center"
      >
        <span className="rounded-full bg-surface-hover px-3 py-1 text-xs text-text-secondary">
          {message.content}
        </span>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={isLatest ? { opacity: 0, y: 5 } : false}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[80%] rounded-xl px-3 py-2 ${
          isUser
            ? 'bg-accent text-bg'
            : 'bg-surface-hover text-text-primary'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        <p className={`mt-1 text-xs ${isUser ? 'text-bg/70' : 'text-text-secondary'}`}>
          {formatTime(message.createdAt)}
        </p>
      </div>
    </motion.div>
  )
}

function formatTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
