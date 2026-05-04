/**
 * Agent Panel — per-task agent activity + raw terminal interface.
 * Two tabs:
 *   - "Output" — structured live agent activity (tool calls, thinking, streamed
 *     text) rendered directly from useAgentStreamingStore. Default for any task
 *     that ever ran an agent.
 *   - "Terminal" — raw xterm.js view bound to the per-task PTY. Default when
 *     the task has no agent stream history (manual / shell-only tasks).
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Task } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useAgentStreamingStore, type LiveToolCall } from '@/stores/agent-streaming-store'
import { TerminalView } from './terminal-view'

type AgentPanelProps = {
  task: Task
  onClose?: () => void
}

type AgentPanelTab = 'output' | 'terminal'

function isAgentTask(task: Task): boolean {
  // Treat any non-idle status (or any history of a worktree being created) as
  // an agent task — Output tab is the right default for these.
  return (task.agentStatus !== null && task.agentStatus !== 'idle') || task.worktreePath !== null
}

export function AgentPanel({ task, onClose }: AgentPanelProps) {
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = task.worktreePath ?? workspace?.repoPath ?? ''

  const stream = useAgentStreamingStore((s) => s.streams.get(task.id))
  const hasStreamActivity = Boolean(
    stream && (stream.fullContent || stream.allToolCalls.length > 0 || stream.thinkingContent)
  )

  // Default to Output for any task that has run/is running an agent, OR has
  // active stream content. Terminal otherwise (manual tasks, shell sessions).
  const [tab, setTab] = useState<AgentPanelTab>(() =>
    isAgentTask(task) || hasStreamActivity ? 'output' : 'terminal',
  )

  // Auto-switch to Output the first time a stream appears for this task,
  // unless the user has manually picked a tab. Saves the user from missing
  // activity that started after the panel opened.
  const userPickedTab = useRef(false)
  const handleTabClick = (next: AgentPanelTab) => {
    userPickedTab.current = true
    setTab(next)
  }
  useEffect(() => {
    if (!userPickedTab.current && hasStreamActivity && tab === 'terminal') {
      setTab('output')
    }
  }, [hasStreamActivity, tab])

  const isStreamLive = Boolean(stream && !stream.completedAt)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              title="Close panel (Esc)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 3l5 4-5 4" />
              </svg>
            </button>
          )}
          <span className="max-w-[180px] truncate text-[10px] text-text-secondary">
            {task.title}
          </span>
        </div>

        <div className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface p-0.5 text-xs">
          <TabButton
            label="Output"
            active={tab === 'output'}
            onClick={() => { handleTabClick('output') }}
            indicator={isStreamLive && tab !== 'output'}
          />
          <TabButton
            label="Terminal"
            active={tab === 'terminal'}
            onClick={() => { handleTabClick('terminal') }}
          />
        </div>
      </div>

      {/* Body — keep TerminalView mounted (xterm.js binding is fragile to mount/unmount) */}
      <div className="relative min-h-0 flex-1">
        <div className={tab === 'output' ? 'h-full' : 'hidden'} aria-hidden={tab !== 'output'}>
          <OutputView task={task} />
        </div>
        <div
          className={tab === 'terminal' ? 'h-full' : 'invisible absolute inset-0 h-full'}
          aria-hidden={tab !== 'terminal'}
        >
          <TerminalView taskId={task.id} workingDir={workingDir} />
        </div>
      </div>
    </div>
  )
}

// Output view: Claude Code-style stream renderer.

function OutputView({ task }: { task: Task }) {
  const stream = useAgentStreamingStore((s) => s.streams.get(task.id))
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [autoFollow, setAutoFollow] = useState(true)
  const activityKey = `${stream?.fullContent.length ?? 0}:${stream?.thinkingContent.length ?? 0}:${stream?.allToolCalls.length ?? 0}:${stream?.completedAt ?? 0}`

  useLayoutEffect(() => {
    if (!autoFollow) return
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollTop = scroller.scrollHeight
  }, [activityKey, autoFollow])

  const handleScroll = () => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    setAutoFollow(distanceFromBottom < 64)
  }

  if (!stream || (!stream.fullContent && stream.allToolCalls.length === 0 && !stream.thinkingContent)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-text-secondary/60">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
          <path d="M9 3v2.25m6-2.25v2.25M3.75 8.625v9.75c0 .621.504 1.125 1.125 1.125h14.25c.621 0 1.125-.504 1.125-1.125v-9.75M3.75 8.625A2.25 2.25 0 0 1 6 6.375h12A2.25 2.25 0 0 1 20.25 8.625" strokeLinecap="round" />
        </svg>
        <p className="text-xs">
          {task.agentStatus === 'running'
            ? 'Agent starting — output will stream in here.'
            : (task.agentStatus === null || task.agentStatus === 'idle') && task.worktreePath === null
              ? 'No agent has run on this task yet.'
              : 'No streaming output captured.'}
        </p>
        <p className="text-[10px] text-text-secondary/50">
          Switch to Terminal for raw PTY view.
        </p>
      </div>
    )
  }

  const isCompleted = Boolean(stream.completedAt)

  return (
    <div className="relative h-full">
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-3 py-3 text-sm"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          <StreamStatusBar
            isCompleted={isCompleted}
            toolCount={stream.toolCount}
            startedAt={stream.startTime}
            completedAt={stream.completedAt}
          />

          {stream.allToolCalls.length > 0 && (
            <div className="flex flex-col gap-2">
              {stream.allToolCalls.map((tool) => (
                <ToolBlock key={tool.id} tool={tool} />
              ))}
            </div>
          )}

          {stream.thinkingContent.trim() && (
            <ThinkingBlock content={stream.thinkingContent} />
          )}

          {stream.fullContent && (
            <MarkdownStream content={stream.fullContent} />
          )}
        </div>
      </div>

      {!autoFollow && (
        <button
          type="button"
          onClick={() => {
            setAutoFollow(true)
            requestAnimationFrame(() => {
              const scroller = scrollerRef.current
              if (scroller) scroller.scrollTop = scroller.scrollHeight
            })
          }}
          className="absolute bottom-3 right-3 rounded border border-border-default bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary shadow-lg hover:bg-surface-hover hover:text-text-primary"
          style={{ cursor: 'pointer' }}
        >
          Resume auto-scroll
        </button>
      )}
    </div>
  )
}

type MarkdownPart =
  | { type: 'markdown'; content: string }
  | { type: 'diff'; content: string }

function StreamStatusBar({
  isCompleted,
  toolCount,
  startedAt,
  completedAt,
}: {
  isCompleted: boolean
  toolCount: number
  startedAt: number
  completedAt?: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-default pb-2 text-[10px] uppercase tracking-wider">
      {isCompleted ? (
        <span className="rounded bg-success/10 px-2 py-0.5 text-success">Completed</span>
      ) : (
        <span className="rounded bg-running/10 px-2 py-0.5 text-running">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-running align-middle" />
          Streaming
        </span>
      )}
      <span className="text-text-secondary/70">{toolCount} tool calls</span>
      <span className="text-text-secondary/50">{formatDuration(startedAt, completedAt ?? Date.now())}</span>
    </div>
  )
}

function ToolBlock({ tool }: { tool: LiveToolCall }) {
  const palette = {
    pending: 'border-border-default bg-surface text-text-secondary',
    running: 'border-running/30 bg-running/10 text-running',
    completed: 'border-success/30 bg-success/10 text-success',
    error: 'border-error/30 bg-error/10 text-error',
  } as const
  const icon = {
    pending: '...',
    running: '>',
    completed: '✓',
    error: '!',
  } as const
  const duration = formatDuration(tool.startedAt, tool.endedAt ?? Date.now())
  const defaultOpen = tool.status === 'running' || tool.status === 'error'
  const [isOpen, setIsOpen] = useState(defaultOpen)

  useEffect(() => {
    if (defaultOpen) setIsOpen(true)
  }, [defaultOpen])

  return (
    <details
      className={`rounded-md border ${palette[tool.status]}`}
      open={isOpen}
      onToggle={(event) => { setIsOpen(event.currentTarget.open) }}
    >
      <summary
        className="flex select-none items-center gap-2 px-3 py-2 text-xs"
        style={{ cursor: 'pointer' }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg/40 font-mono text-[11px]">
          {icon[tool.status]}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono">{tool.name}</span>
        <span className="rounded bg-bg/30 px-1.5 py-0.5 font-mono text-[10px] uppercase">
          {tool.status}
        </span>
        <span className="font-mono text-[10px] opacity-70">{duration}</span>
      </summary>
      <div className="border-t border-current/10 px-3 py-2 text-[11px] text-text-secondary">
        <div className="grid gap-1 font-mono">
          <div>id: {tool.id}</div>
          <div>started: {new Date(tool.startedAt).toLocaleTimeString()}</div>
          {tool.endedAt && <div>ended: {new Date(tool.endedAt).toLocaleTimeString()}</div>}
        </div>
      </div>
    </details>
  )
}

function ThinkingBlock({ content }: { content: string }) {
  const lineCount = content.split('\n').filter(Boolean).length

  return (
    <details className="rounded-md border border-accent/30 bg-accent/10">
      <summary
        className="select-none px-3 py-2 text-xs font-medium text-accent"
        style={{ cursor: 'pointer' }}
      >
        Thinking ({lineCount} lines)
      </summary>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-accent/20 px-3 py-2 text-[11px] font-mono text-text-secondary">
        <AnsiText text={content} />
      </pre>
    </details>
  )
}

const MarkdownStream = memo(function MarkdownStream({ content }: { content: string }) {
  const parts = useMemo(() => splitMarkdownParts(content), [content])

  return (
    <div className="flex flex-col gap-3">
      {parts.map((part, index) => (
        part.type === 'diff'
          ? <DiffBlock key={index} content={part.content} />
          : <MarkdownBlock key={index} content={part.content} />
      ))}
    </div>
  )
})

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="max-w-none text-sm leading-6 text-text-primary">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-2 text-sm font-semibold">{children}</h3>,
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          ul: ({ children }) => <ul className="my-1.5 ml-5 list-disc">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 ml-5 list-decimal">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border-default pl-3 text-text-secondary">
              {children}
            </blockquote>
          ),
          code: ({ className, children }) => {
            const language = /language-(\w+)/.exec(className ?? '')?.[1] ?? ''
            const code = childrenToText(children).replace(/\n$/, '')
            if (!className) {
              return <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[0.9em] text-accent">{children}</code>
            }
            if (language === 'diff' || looksLikeDiff(code)) {
              return <DiffBlock content={code} />
            }
            return <CodeBlock language={language || 'text'} content={code} />
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {stripAnsi(content)}
      </ReactMarkdown>
    </div>
  )
}

function CodeBlock({ language, content }: { language: string; content: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => { setCopied(false) }, 1200)
  }

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border-default bg-bg">
      <div className="flex items-center justify-between border-b border-border-default bg-surface px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-secondary">{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          style={{ cursor: 'pointer' }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-[520px] overflow-auto p-3 text-xs leading-5">
        <code className="font-mono">
          <AnsiText text={content} />
        </code>
      </pre>
    </div>
  )
}

function DiffBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const lines = content.split('\n')
  const visibleLines = expanded ? lines : lines.slice(0, 320)
  const isTruncated = lines.length > visibleLines.length

  const handleCopy = () => {
    void navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => { setCopied(false) }, 1200)
  }

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border-default bg-bg">
      <div className="flex items-center justify-between border-b border-border-default bg-surface px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-secondary">diff</span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          style={{ cursor: 'pointer' }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-[560px] overflow-auto py-2 text-xs leading-5">
        {visibleLines.map((line, index) => (
          <DiffLine key={`${index}:${line}`} line={line} lineNumber={index + 1} />
        ))}
      </pre>
      {isTruncated && (
        <button
          type="button"
          onClick={() => { setExpanded(true) }}
          className="w-full border-t border-border-default bg-surface px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          style={{ cursor: 'pointer' }}
        >
          Show {lines.length - visibleLines.length} more lines
        </button>
      )}
    </div>
  )
}

function DiffLine({ line, lineNumber }: { line: string; lineNumber: number }) {
  const isAdd = line.startsWith('+') && !line.startsWith('+++')
  const isRemove = line.startsWith('-') && !line.startsWith('---')
  const isMeta = line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')
  const className = isAdd
    ? 'bg-success/10 text-success'
    : isRemove
      ? 'bg-error/10 text-error'
      : isMeta
        ? 'bg-running/10 text-running'
        : 'text-text-secondary'

  return (
    <div className={`grid grid-cols-[3.5rem_1fr] px-3 font-mono ${className}`}>
      <span className="select-none pr-3 text-right text-text-secondary/50">{lineNumber}</span>
      <code className="whitespace-pre-wrap break-words">{line || ' '}</code>
    </div>
  )
}

function AnsiText({ text }: { text: string }) {
  return <>{parseAnsi(text)}</>
}

function parseAnsi(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const regex = /\x1b\[([0-9;]*)m/g
  let lastIndex = 0
  let className = ''
  let key = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={key++} className={className}>{text.slice(lastIndex, match.index)}</span>)
    }
    className = ansiClassName(match[1] ?? '', className)
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    nodes.push(<span key={key++} className={className}>{text.slice(lastIndex)}</span>)
  }

  return nodes
}

function ansiClassName(code: string, current: string): string {
  const classes = new Set(current.split(' ').filter(Boolean))
  const codes = code.split(';').filter(Boolean).map(Number)
  if (codes.length === 0 || codes.includes(0)) return ''

  for (const value of codes) {
    if (value === 1) classes.add('font-bold')
    if (value === 2) classes.add('opacity-60')
    if (value === 22) {
      classes.delete('font-bold')
      classes.delete('opacity-60')
    }
    const color = ANSI_COLOR_CLASS[value]
    if (color) {
      for (const existing of Array.from(classes)) {
        if (existing.startsWith('text-')) classes.delete(existing)
      }
      classes.add(color)
    }
    if (value === 39) {
      for (const existing of Array.from(classes)) {
        if (existing.startsWith('text-')) classes.delete(existing)
      }
    }
  }

  return Array.from(classes).join(' ')
}

const ANSI_COLOR_CLASS: Record<number, string> = {
  30: 'text-text-primary',
  31: 'text-error',
  32: 'text-success',
  33: 'text-warning',
  34: 'text-running',
  35: 'text-accent',
  36: 'text-running',
  37: 'text-text-primary',
  90: 'text-text-secondary',
  91: 'text-error',
  92: 'text-success',
  93: 'text-warning',
  94: 'text-running',
  95: 'text-accent',
  96: 'text-running',
  97: 'text-text-primary',
}

function splitMarkdownParts(content: string): MarkdownPart[] {
  const lines = content.split('\n')
  const parts: MarkdownPart[] = []
  let buffer: string[] = []
  let diffBuffer: string[] = []
  let inFence = false

  const flushMarkdown = () => {
    const markdown = buffer.join('\n').trim()
    if (markdown) parts.push({ type: 'markdown', content: markdown })
    buffer = []
  }
  const flushDiff = () => {
    const diff = diffBuffer.join('\n').trimEnd()
    if (diff) parts.push({ type: 'diff', content: diff })
    diffBuffer = []
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      buffer.push(line)
      continue
    }

    if (!inFence && isRawDiffLine(line)) {
      flushMarkdown()
      diffBuffer.push(line)
      continue
    }

    if (diffBuffer.length > 0) flushDiff()
    buffer.push(line)
  }

  if (diffBuffer.length > 0) flushDiff()
  flushMarkdown()
  return parts
}

function isRawDiffLine(line: string): boolean {
  return line.startsWith('diff --git ')
    || line.startsWith('index ')
    || line.startsWith('+++ ')
    || line.startsWith('--- ')
    || line.startsWith('@@')
    || line.startsWith('+')
    || line.startsWith('-')
}

function looksLikeDiff(content: string): boolean {
  const lines = content.split('\n')
  return lines.some((line) => line.startsWith('@@') || line.startsWith('diff --git '))
    || (lines.some((line) => line.startsWith('+') && !line.startsWith('+++'))
      && lines.some((line) => line.startsWith('-') && !line.startsWith('---')))
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function childrenToText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  return ''
}

function formatDuration(start: number, end: number): string {
  const ms = Math.max(0, end - start)
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.floor(seconds % 60)}s`
}

function TabButton({
  label,
  active,
  onClick,
  indicator,
}: {
  label: string
  active: boolean
  onClick: () => void
  indicator?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded px-2 py-0.5 font-medium transition-colors ${
        active
          ? 'bg-accent text-bg'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
      }`}
    >
      {label}
      {indicator && (
        <span className="absolute -right-0.5 -top-0.5 flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-running opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
        </span>
      )}
    </button>
  )
}
