import { memo, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import ReactMarkdown from 'react-markdown'

export type ChatMessageData = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type ParsedAction = {
  action: string
  label: string
  [key: string]: unknown
}

export type ActionParser = (content: string) => {
  displayText: string
  actions: ParsedAction[]
}

type CliChatBubbleProps = {
  message: ChatMessageData
  isLatest?: boolean
  actionParser?: ActionParser
}

// Default action parser - no action parsing
const defaultActionParser: ActionParser = (content) => ({
  displayText: content,
  actions: [],
})

export function CliChatBubble({
  message,
  isLatest = false,
  actionParser = defaultActionParser,
}: CliChatBubbleProps) {
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

  // Parse actions for assistant messages
  const { displayText, actions } = isUser
    ? { displayText: message.content, actions: [] }
    : actionParser(message.content)

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
        {/* Show executed actions with checkmarks */}
        {actions.length > 0 && (
          <div className="mb-2 space-y-1">
            {actions.map((action, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs rounded bg-bg/50 px-2 py-1">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-green-400 shrink-0">
                  <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                </svg>
                <span className="text-text-secondary">{action.label}</span>
              </div>
            ))}
          </div>
        )}
        {displayText && <MarkdownContent content={displayText} />}
      </div>
    </motion.div>
  )
}

// Memoized markdown renderer for chat messages
export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="text-sm markdown-content">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="my-1">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-1 ml-4 list-disc">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 ml-4 list-decimal">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          h1: ({ children }) => <h1 className="text-lg font-bold my-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold my-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold my-1">{children}</h3>,
          code: ({ className, children }) => {
            const isInline = !className
            return isInline ? (
              <code className="text-accent bg-bg/50 px-1 py-0.5 rounded text-[0.85em]">{children}</code>
            ) : (
              <code className={className}>{children}</code>
            )
          },
          pre: ({ children }) => (
            <pre className="my-2 p-2 bg-bg/50 rounded overflow-x-auto text-xs">{children}</pre>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-accent underline hover:opacity-80" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent/50 pl-2 my-2 text-text-secondary italic">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

// Queued message bubble - shows as pending user message
export function QueuedBubble({ content }: { content: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 0.6, y: 0 }}
      className="flex justify-end"
    >
      <div className="max-w-[80%] rounded-xl px-3 py-2 bg-accent/50 text-bg border border-dashed border-accent/30">
        <p className="text-sm whitespace-pre-wrap">{content}</p>
        <p className="text-xs mt-1 opacity-70">Queued</p>
      </div>
    </motion.div>
  )
}

// Tool call data type
export type ToolCallData = {
  toolId: string
  toolName: string
  status: 'running' | 'complete' | 'error'
}

type StreamingBubbleProps = {
  content: string
  startTime?: number | null
  thinkingContent?: string
  toolCalls?: ToolCallData[]
  onCancel?: () => void
  queueCount?: number
}

export function StreamingBubble({
  content,
  startTime,
  thinkingContent = '',
  toolCalls = [],
  onCancel,
  queueCount = 0,
}: StreamingBubbleProps) {
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
          <MarkdownContent content={content} />
        ) : !hasThinking && !hasToolCalls ? (
          <TypingDots />
        ) : null}

        {/* Status line with cancel button */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-text-secondary flex items-center gap-1.5">
            {hasContent ? 'Typing' : hasToolCalls ? 'Using tools' : hasThinking ? 'Thinking' : 'Processing'}
            {elapsed > 0 ? ` · ${elapsed}s` : ''}
            {queueCount > 0 && (
              <span className="text-accent"> · {queueCount} queued</span>
            )}
          </p>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-text-secondary hover:text-red-400 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
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
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        className="h-2 w-2 rounded-full bg-accent"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
      />
      <motion.span
        className="h-2 w-2 rounded-full bg-accent"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
      />
    </div>
  )
}
