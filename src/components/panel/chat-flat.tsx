/**
 * Shared flat-document chat primitives used by BOTH the per-task agent transcript
 * and the chef/orchestrator chat — a single reading experience, no bubbles.
 *
 * A message is a left-border entry (accent tone), a small role label, and a
 * full-width markdown body. This is the agent-transcript visual language lifted
 * into one place so the chef chat can drop its bubbles and match it.
 */

import { memo, type ReactNode } from 'react'
import { motion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type ChatTone = 'user' | 'agent' | 'running' | 'queued' | 'warning' | 'error' | 'system'

const TONE_BORDER: Record<ChatTone, string> = {
  user: 'border-accent/50',
  agent: 'border-border-default',
  running: 'border-running/50',
  queued: 'border-accent/30',
  warning: 'border-warning/50',
  error: 'border-error/50',
  system: 'border-border-default',
}

const TONE_LABEL: Record<ChatTone, string> = {
  user: 'text-accent',
  agent: 'text-text-secondary',
  running: 'text-running',
  queued: 'text-accent/70',
  warning: 'text-warning',
  error: 'text-error',
  system: 'text-text-secondary',
}

function formatTime(timestamp?: string): string | null {
  if (!timestamp) return null
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * One flat-document entry: left accent border + optional role label/detail/time,
 * then arbitrary body (markdown, tool disclosures, streaming status, …).
 */
export function ChatEntry({
  tone,
  label,
  detail,
  timestamp,
  isLatest = false,
  headerRight,
  children,
}: {
  tone: ChatTone
  label?: string
  detail?: string
  timestamp?: string
  isLatest?: boolean
  /** Optional control rendered at the far right of the header row (e.g. Cancel). */
  headerRight?: ReactNode
  children?: ReactNode
}) {
  const time = formatTime(timestamp)
  const hasHeader = Boolean(label || detail || time || headerRight)
  return (
    <motion.article
      initial={isLatest ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      className={`border-l pl-3 ${TONE_BORDER[tone]}`}
    >
      {hasHeader && (
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
          {label && <span className={`font-semibold ${TONE_LABEL[tone]}`}>{label}</span>}
          {detail && <span className="min-w-0 break-words text-text-secondary/70">{detail}</span>}
          {time && <time className="text-text-secondary/50">{time}</time>}
          {headerRight && <span className="ml-auto">{headerRight}</span>}
        </div>
      )}
      {children}
    </motion.article>
  )
}

/** Centered divider used for system notices (model switches, etc.). */
export function ChatDivider({ children, isLatest = false }: { children: ReactNode; isLatest?: boolean }) {
  return (
    <motion.div
      initial={isLatest ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 py-0.5"
    >
      <div className="h-px flex-1 bg-border-default" />
      <span className="max-w-full truncate text-[10px] text-text-secondary">{children}</span>
      <div className="h-px flex-1 bg-border-default" />
    </motion.div>
  )
}

/**
 * The single markdown renderer for all chat surfaces. GFM (tables, strikethrough,
 * task lists) on everywhere; newline-preserving paragraphs so agent output keeps
 * its shape.
 */
export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  muted = false,
}: {
  content: string
  muted?: boolean
}) {
  return (
    <div className={`markdown-content break-words text-sm leading-relaxed ${muted ? 'text-text-primary/90' : 'text-text-primary'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5 whitespace-pre-wrap break-words">{children}</p>,
          h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold text-text-primary">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-text-primary">{children}</h3>,
          ul: ({ children }) => <ul className="my-1 ml-5 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 ml-5 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="my-3 border-border-default" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-border-default px-2 py-1 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-border-default px-2 py-1">{children}</td>,
          code: ({ className, children }) => {
            const isInline = !className
            return isInline ? (
              <code className="rounded bg-surface px-1 py-0.5 text-[0.9em] text-accent">{children}</code>
            ) : (
              <code className={className}>{children}</code>
            )
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-auto whitespace-pre-wrap break-words rounded border border-border-default bg-surface p-3 text-xs leading-relaxed">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l border-border-default pl-3 text-text-secondary">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-accent underline underline-offset-2 hover:opacity-80" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
