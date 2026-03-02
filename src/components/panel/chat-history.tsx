import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { ChatMessage, ToolCallEvent } from '@/lib/ipc'

type ChatHistoryProps = {
  messages: ChatMessage[]
  isLoading?: boolean
  streamingContent?: string
  processingStartTime?: number | null
  thinkingContent?: string
  toolCalls?: ToolCallEvent[]
}

export function ChatHistory({
  messages,
  isLoading = false,
  streamingContent = '',
  processingStartTime = null,
  thinkingContent = '',
  toolCalls = [],
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
        <div className="text-center">
          <p className="text-sm text-text-secondary">No messages yet</p>
          <p className="mt-1 text-xs text-text-secondary/70">
            Ask me to create tasks for you
          </p>
        </div>
      </div>
    )
  }

  const isProcessing = processingStartTime !== null

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map((msg, index) => (
        <MessageBubble key={msg.id} message={msg} isLatest={index === messages.length - 1 && !isProcessing} />
      ))}
      {isProcessing && (
        <StreamingBubble
          content={streamingContent}
          startTime={processingStartTime}
          thinkingContent={thinkingContent}
          toolCalls={toolCalls}
        />
      )}
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
      </div>
    </motion.div>
  )
}

type StreamingBubbleProps = {
  content: string
  startTime?: number | null
  thinkingContent?: string
  toolCalls?: ToolCallEvent[]
}

function StreamingBubble({ content, startTime, thinkingContent = '', toolCalls = [] }: StreamingBubbleProps) {
  const [elapsed, setElapsed] = useState(0)
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false)

  useEffect(() => {
    if (!startTime) {
      setElapsed(0)
      return
    }

    // Set initial elapsed
    setElapsed(Math.floor((Date.now() - startTime) / 1000))

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [startTime])

  const hasThinking = thinkingContent.length > 0
  const hasToolCalls = toolCalls.length > 0
  const hasContent = content.length > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-start"
    >
      <div className="max-w-[80%] rounded-xl px-3 py-2 bg-surface-hover text-text-primary space-y-2">
        {/* Thinking block - collapsible */}
        {hasThinking && (
          <div className="border-l-2 border-accent/30 pl-2">
            <button
              type="button"
              onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
              className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
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
            <AnimatePresence>
              {isThinkingExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <p className="mt-1 text-xs text-text-secondary/80 whitespace-pre-wrap">
                    {thinkingContent}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Tool calls */}
        {hasToolCalls && (
          <div className="space-y-1">
            {toolCalls.map((tool) => (
              <div
                key={tool.toolId}
                className="flex items-center gap-2 text-xs rounded bg-bg/50 px-2 py-1"
              >
                {tool.status === 'running' ? (
                  <svg className="h-3 w-3 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : tool.status === 'complete' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-green-400">
                    <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-red-400">
                    <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
                  </svg>
                )}
                <span className="font-mono text-text-secondary">{tool.toolName}</span>
              </div>
            ))}
          </div>
        )}

        {/* Streaming content or typing indicator */}
        {hasContent ? (
          <p className="text-sm whitespace-pre-wrap">{content}</p>
        ) : !hasThinking && !hasToolCalls ? (
          <TypingDots />
        ) : null}

        {/* Status line */}
        <p className="text-xs text-text-secondary flex items-center gap-1.5">
          {hasContent ? 'Typing' : hasToolCalls ? 'Using tools' : hasThinking ? 'Thinking' : 'Processing'}
          {elapsed > 0 ? ` · ${elapsed}s` : ''}
        </p>
      </div>
    </motion.div>
  )
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      <motion.span
        className="h-2 w-2 rounded-full bg-accent"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="h-2 w-2 rounded-full bg-accent"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
      />
      <motion.span
        className="h-2 w-2 rounded-full bg-accent"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
      />
    </div>
  )
}
