/**
 * Structured output renderer for agent CLI sessions.
 * Parses raw terminal output for Claude CLI patterns and renders them
 * as visual components (tool call badges, code blocks, error blocks, etc.).
 */

import { useState, useMemo, memo } from 'react'
import ReactMarkdown from 'react-markdown'

// ─── Output block types ──────────────────────────────────────────────────────

type ToolCallBlock = {
  type: 'tool_call'
  name: string
  status: 'running' | 'complete' | 'error'
}

type CodeBlock = {
  type: 'code'
  language: string
  content: string
}

type ErrorBlock = {
  type: 'error'
  content: string
}

type ThinkingBlock = {
  type: 'thinking'
  content: string
}

type StatusBlock = {
  type: 'status'
  success: boolean
  content: string
}

type TextBlock = {
  type: 'text'
  content: string
}

type OutputBlock =
  | ToolCallBlock
  | CodeBlock
  | ErrorBlock
  | ThinkingBlock
  | StatusBlock
  | TextBlock

// ─── Parser ──────────────────────────────────────────────────────────────────

// Strip ANSI escape sequences for pattern matching
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
}

/** Parse raw terminal output into structured blocks */
function parseAgentOutput(raw: string): OutputBlock[] {
  const clean = stripAnsi(raw)
  const lines = clean.split('\n')
  const blocks: OutputBlock[] = []

  let i = 0
  let textBuffer: string[] = []

  const flushText = () => {
    if (textBuffer.length > 0) {
      const content = textBuffer.join('\n').trim()
      if (content) {
        blocks.push({ type: 'text', content })
      }
      textBuffer = []
    }
  }

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    // Tool calls: "⚙ tool_name" or "⏺ tool_name"
    if (/^[⚙⏺]\s+\w+/.test(trimmed)) {
      flushText()
      const name = trimmed.replace(/^[⚙⏺]\s+/, '').split(/\s/)[0] ?? 'unknown'
      // Check next lines for status hints
      const hasError = i + 1 < lines.length && /error|fail/i.test(lines[i + 1] ?? '')
      const hasCheck = /✓|✔/.test(trimmed)
      blocks.push({
        type: 'tool_call',
        name,
        status: hasError ? 'error' : hasCheck ? 'complete' : 'running',
      })
      i++
      continue
    }

    // Code blocks: ``` markers
    if (trimmed.startsWith('```')) {
      flushText()
      const language = trimmed.slice(3).trim() || 'text'
      const codeLines: string[] = []
      i++
      while (i < lines.length) {
        const codeLine = lines[i] ?? ''
        if (codeLine.trim().startsWith('```')) {
          i++
          break
        }
        codeLines.push(codeLine)
        i++
      }
      blocks.push({
        type: 'code',
        language,
        content: codeLines.join('\n'),
      })
      continue
    }

    // Thinking indicators
    if (/^thinking\.{2,}$/i.test(trimmed) || /^💭/.test(trimmed)) {
      flushText()
      const thinkingLines: string[] = [trimmed]
      i++
      // Consume indented lines that follow
      while (i < lines.length) {
        const thinkLine = lines[i] ?? ''
        if (!thinkLine.startsWith('  ') && thinkLine.trim() !== '') break
        if (thinkLine.trim()) thinkingLines.push(thinkLine.trim())
        i++
      }
      blocks.push({
        type: 'thinking',
        content: thinkingLines.join('\n'),
      })
      continue
    }

    // Error lines
    if (/^Error:|^error:|^✗\s|^❌/.test(trimmed)) {
      flushText()
      const errorLines: string[] = [trimmed]
      i++
      // Consume continuation lines (indented or non-empty following lines)
      while (i < lines.length) {
        const errorLine = lines[i] ?? ''
        if (!errorLine.startsWith('  ')) break
        errorLines.push(errorLine.trim())
        i++
      }
      blocks.push({
        type: 'error',
        content: errorLines.join('\n'),
      })
      continue
    }

    // Status indicators: ✓ or ✗
    if (/^[✓✔]\s/.test(trimmed)) {
      flushText()
      blocks.push({
        type: 'status',
        success: true,
        content: trimmed.replace(/^[✓✔]\s*/, ''),
      })
      i++
      continue
    }

    if (/^[✗✘]\s/.test(trimmed)) {
      flushText()
      blocks.push({
        type: 'status',
        success: false,
        content: trimmed.replace(/^[✗✘]\s*/, ''),
      })
      i++
      continue
    }

    // Default: accumulate as text
    textBuffer.push(line)
    i++
  }

  flushText()
  return blocks
}

// ─── Block renderers ─────────────────────────────────────────────────────────

function ToolCallBadge({ block }: { block: ToolCallBlock }) {
  const statusColors = {
    running: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    complete: 'bg-green-500/10 text-green-400 border-green-500/20',
    error: 'bg-red-500/10 text-red-400 border-red-500/20',
  }
  const statusIcons = {
    running: '⏳',
    complete: '✓',
    error: '✗',
  }

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-mono ${statusColors[block.status]}`}>
      <span>{statusIcons[block.status]}</span>
      <span>{block.name}</span>
    </div>
  )
}

function CodeBlockRenderer({ block }: { block: CodeBlock }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(block.content)
    setCopied(true)
    setTimeout(() => { setCopied(false) }, 2000)
  }

  return (
    <div className="rounded-lg border border-border-default overflow-hidden">
      <div className="flex items-center justify-between bg-surface-hover px-3 py-1">
        <span className="text-[10px] font-mono text-text-secondary">{block.language}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[10px] text-text-secondary hover:text-text-primary transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono bg-bg text-text-primary">
        <code>{block.content}</code>
      </pre>
    </div>
  )
}

function ErrorBlockRenderer({ block }: { block: ErrorBlock }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="text-red-400 shrink-0 mt-0.5">✗</span>
        <pre className="text-xs font-mono text-red-300 whitespace-pre-wrap break-words">{block.content}</pre>
      </div>
    </div>
  )
}

function ThinkingBlockRenderer({ block }: { block: ThinkingBlock }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-l-2 border-accent/30 pl-2">
      <button
        type="button"
        onClick={() => { setExpanded(!expanded) }}
        className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
        <span className="italic">Thinking...</span>
      </button>
      {expanded && (
        <p className="mt-1 text-xs text-text-secondary/80 whitespace-pre-wrap">
          {block.content}
        </p>
      )}
    </div>
  )
}

function StatusIndicator({ block }: { block: StatusBlock }) {
  return (
    <div className={`flex items-center gap-2 text-xs ${block.success ? 'text-green-400' : 'text-red-400'}`}>
      <span>{block.success ? '✓' : '✗'}</span>
      <span>{block.content}</span>
    </div>
  )
}

const TextBlockRenderer = memo(function TextBlockRenderer({ block }: { block: TextBlock }) {
  return (
    <div className="text-sm text-text-primary">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="my-1">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-1 ml-4 list-disc">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 ml-4 list-decimal">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
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
        }}
      >
        {block.content}
      </ReactMarkdown>
    </div>
  )
})

// ─── Main component ──────────────────────────────────────────────────────────

function BlockRenderer({ block }: { block: OutputBlock }) {
  switch (block.type) {
    case 'tool_call':
      return <ToolCallBadge block={block} />
    case 'code':
      return <CodeBlockRenderer block={block} />
    case 'error':
      return <ErrorBlockRenderer block={block} />
    case 'thinking':
      return <ThinkingBlockRenderer block={block} />
    case 'status':
      return <StatusIndicator block={block} />
    case 'text':
      return <TextBlockRenderer block={block} />
  }
}

type AgentOutputProps = {
  /** Raw terminal output string */
  rawOutput: string
}

export function AgentOutput({ rawOutput }: AgentOutputProps) {
  const blocks = useMemo(() => parseAgentOutput(rawOutput), [rawOutput])

  if (blocks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-text-secondary text-xs">
        No output yet
      </div>
    )
  }

  return (
    <div className="space-y-2 p-3">
      {blocks.map((block, index) => (
        <BlockRenderer key={index} block={block} />
      ))}
    </div>
  )
}
