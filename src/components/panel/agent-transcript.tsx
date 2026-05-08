import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import type { ChatMessage } from '@/lib/ipc'
import type { AgentTranscriptEvent } from '@/types/events'
import type { ChatToolCall } from './shared/chat-helpers'

type QueuedMessage = {
  id: string
  content: string
}

type AgentTranscriptProps = {
  events?: AgentTranscriptEvent[]
  messages?: ChatMessage[]
  isLoading?: boolean
  streamingContent?: string
  processingStartTime?: number | null
  thinkingContent?: string
  toolCalls?: ChatToolCall[]
  queuedMessages?: QueuedMessage[]
  onCancel?: () => void
}

type RenderItem =
  | { kind: 'meta'; id: string; label: string; detail?: string; timestamp: string }
  | { kind: 'user'; id: string; content: string; timestamp: string; detail?: string }
  | { kind: 'assistant'; id: string; content: string; timestamp: string; source?: 'agent_output' }
  | { kind: 'thinking'; id: string; content: string; timestamp: string }
  | { kind: 'tool'; id: string; status: 'started' | 'completed' | 'output'; name: string; detail?: string; timestamp: string }
  | { kind: 'command'; id: string; status: 'started' | 'output' | 'completed'; name: string; content?: string; detail?: string; timestamp: string }
  | { kind: 'end'; id: string; status: 'completed' | 'failed' | 'cancelled'; detail?: string; timestamp: string }

type DeltaBuffer = { id: string; content: string; timestamp: string }
type TranscriptGroup =
  | { kind: 'single'; item: RenderItem }
  | { kind: 'run'; id: string; header: Extract<RenderItem, { kind: 'meta' }>; items: RenderItem[] }
type AgentOutputSection =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool'; name: string; details: string[] }
  | { type: 'done'; content: string }

export function AgentTranscript({
  events = [],
  isLoading = false,
  processingStartTime = null,
  queuedMessages = [],
  onCancel,
}: AgentTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const items = useMemo(() => buildRenderItems(events), [events])
  const groups = useMemo(() => groupTranscriptItems(items), [items])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [groups, queuedMessages, processingStartTime])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">
        Loading transcript...
      </div>
    )
  }

  const isEmpty = items.length === 0 && queuedMessages.length === 0

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto bg-bg px-4 py-3 font-mono"
      data-testid="agent-transcript"
    >
      {isEmpty ? (
        <div className="flex h-full items-center justify-center">
          <div className="max-w-sm text-center">
            <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-text-secondary">
              No semantic transcript yet
            </div>
            <p className="text-sm leading-relaxed text-text-secondary">
              Open Terminal for the raw tmux session.
            </p>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-4xl space-y-4">
          {groups.map((group, index) => (
            <TranscriptGroupView key={group.kind === 'run' ? group.id : group.item.id} group={group} isLatest={index === groups.length - 1} />
          ))}

          {processingStartTime !== null && (
            <RunningEntry startTime={processingStartTime} queueCount={queuedMessages.length} onCancel={onCancel} />
          )}

          {queuedMessages.map((message) => (
            <QueuedEntry key={message.id} content={message.content} />
          ))}
        </div>
      )}
    </div>
  )
}

function groupTranscriptItems(items: RenderItem[]): TranscriptGroup[] {
  const groups: TranscriptGroup[] = []
  let currentRun: Extract<TranscriptGroup, { kind: 'run' }> | null = null

  for (const item of items) {
    if (currentRun && item.kind === 'meta' && item.label === 'run started') {
      continue
    }

    if (item.kind === 'meta' && item.label === 'run started') {
      currentRun = { kind: 'run', id: item.id, header: item, items: [] }
      groups.push(currentRun)
      continue
    }

    if (currentRun) {
      currentRun.items.push(item)
      if (item.kind === 'end') {
        currentRun = null
      }
      continue
    }

    groups.push({ kind: 'single', item })
  }

  return groups
}

function buildRenderItems(events: AgentTranscriptEvent[]): RenderItem[] {
  const items: RenderItem[] = []
  let assistantBuffer: DeltaBuffer | undefined
  let thinkingBuffer: DeltaBuffer | undefined
  let lastRunKey: string | null = null

  const flushAssistant = () => {
    if (!assistantBuffer) return
    if (assistantBuffer.content.trim()) {
      items.push({ kind: 'assistant', ...assistantBuffer })
    }
    assistantBuffer = undefined
  }

  const flushThinking = () => {
    if (!thinkingBuffer) return
    if (thinkingBuffer.content.trim()) {
      items.push({ kind: 'thinking', ...thinkingBuffer })
    }
    thinkingBuffer = undefined
  }

  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const metadata = parseMetadata(event.metadataJson)
    switch (event.eventType) {
      case 'agent_text_delta':
        flushThinking()
        {
          const current = assistantBuffer
          assistantBuffer = {
            id: current ? current.id : event.id,
            content: (current ? current.content : '') + (event.content ?? ''),
            timestamp: event.createdAt,
          }
        }
        break
      case 'agent_thinking_delta':
        flushAssistant()
        {
          const current = thinkingBuffer
          thinkingBuffer = {
            id: current ? current.id : event.id,
            content: (current ? current.content : '') + (event.content ?? ''),
            timestamp: event.createdAt,
          }
        }
        break
      case 'user_input':
        flushAssistant()
        flushThinking()
        items.push({
          kind: 'user',
          id: event.id,
          content: event.content ?? '',
          detail: userInputDetail(metadata),
          timestamp: event.createdAt,
        })
        break
      case 'session_started':
        flushAssistant()
        flushThinking()
        lastRunKey = runKey(metadata)
        items.push({
          kind: 'meta',
          id: event.id,
          label: 'run started',
          detail: compactRunDetail(metadata),
          timestamp: event.createdAt,
        })
        break
      case 'agent_started':
        flushAssistant()
        flushThinking()
        if (lastRunKey && lastRunKey === runKey(metadata)) {
          break
        }
        items.push({
          kind: 'meta',
          id: event.id,
          label: 'agent started',
          detail: compactRunDetail(metadata),
          timestamp: event.createdAt,
        })
        break
      case 'tool_started':
      case 'tool_completed':
      case 'tool_output':
        flushAssistant()
        flushThinking()
        items.push({
          kind: 'tool',
          id: event.id,
          status: event.eventType === 'tool_started' ? 'started' : event.eventType === 'tool_completed' ? 'completed' : 'output',
          name: stringMeta(metadata, 'toolName') ?? stringMeta(metadata, 'name') ?? 'tool',
          detail: event.content ?? stringMeta(metadata, 'toolInput') ?? undefined,
          timestamp: event.createdAt,
        })
        break
      case 'command_started':
      case 'command_output':
      case 'command_completed':
        flushAssistant()
        flushThinking()
        if (event.eventType === 'command_started') {
          if (!hasCommandIdentity(metadata)) break
          items.push({
            kind: 'command',
            id: event.id,
            status: 'started',
            name: commandDisplayName(metadata),
            detail: formatCommandDetail(event.eventType, metadata),
            timestamp: event.createdAt,
          })
          break
        }
        if (event.eventType === 'command_output') {
          if (isTmuxTranscriptSource(metadata)) {
            appendAgentOutput(items, event)
            break
          }
          const output = transcriptCommandOutput(event.content, metadata)
          if (!output) break
          items.push({
            kind: 'command',
            id: event.id,
            status: 'output',
            name: commandDisplayName(metadata),
            content: output,
            detail: formatCommandDetail(event.eventType, metadata),
            timestamp: event.createdAt,
          })
          break
        }
        if (!hasCommandIdentity(metadata)) break
        items.push({
          kind: 'command',
          id: event.id,
          status: 'completed',
          name: commandDisplayName(metadata),
          detail: formatCommandDetail(event.eventType, metadata),
          timestamp: event.createdAt,
        })
        break
      case 'agent_completed':
      case 'agent_failed':
      case 'agent_cancelled':
        flushAssistant()
        flushThinking()
        items.push({
          kind: 'end',
          id: event.id,
          status: endStatus(event.eventType, metadata),
          detail: event.content ?? formatEndDetail(metadata),
          timestamp: event.createdAt,
        })
        break
      default:
        flushAssistant()
        flushThinking()
        items.push({
          kind: 'meta',
          id: event.id,
          label: event.eventType,
          detail: event.content ?? undefined,
          timestamp: event.createdAt,
        })
    }
  }

  flushAssistant()
  flushThinking()
  return items
}

function appendAgentOutput(items: RenderItem[], event: AgentTranscriptEvent) {
  const content = event.content ?? ''
  if (!content.trim()) return
  const previous = items.at(-1)
  if (previous?.kind === 'assistant' && previous.source === 'agent_output') {
    previous.content += content
    previous.timestamp = event.createdAt
    return
  }
  items.push({
    kind: 'assistant',
    id: event.id,
    content,
    timestamp: event.createdAt,
    source: 'agent_output',
  })
}

function TranscriptGroupView({ group, isLatest }: { group: TranscriptGroup; isLatest: boolean }) {
  if (group.kind === 'single') {
    return <TranscriptItem item={group.item} isLatest={isLatest} />
  }
  return <RunGroup group={group} isLatest={isLatest} />
}

function RunGroup({ group, isLatest }: { group: Extract<TranscriptGroup, { kind: 'run' }>; isLatest: boolean }) {
  const status = runStatus(group.items)
  const [open, setOpen] = usePersistentDisclosure(
    `agent-transcript:run:${group.id}`,
    isLatest || status === 'running',
  )
  const endItem = useMemo(
    () => [...group.items].reverse().find((item): item is Extract<RenderItem, { kind: 'end' }> => item.kind === 'end'),
    [group.items],
  )
  const visibleItems = useMemo(
    () => coalesceRunItems(group.items.filter((item) => item.kind !== 'end')),
    [group.items],
  )

  return (
    <motion.section
      initial={isLatest ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded border border-border-default/80 bg-surface/15"
    >
      <button
        type="button"
        onClick={() => { setOpen(!open) }}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface/35"
        style={{ cursor: 'pointer' }}
      >
        <span className={`text-xs text-text-secondary transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
          <span className="font-semibold text-text-primary">run</span>
          {group.header.detail ? ` · ${group.header.detail}` : ''}
        </span>
        <RunStatusBadge status={status} detail={runStatusDetail(group.items)} />
        <time className="shrink-0 text-[10px] text-text-secondary/50">
          {new Date(group.header.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border-default/80"
          >
            <div className="space-y-4 px-3 py-3">
              {visibleItems.length > 0 ? (
                visibleItems.map((item, index) => (
                  <TranscriptItem key={item.id} item={item} isLatest={isLatest && index === visibleItems.length - 1} />
                ))
              ) : (
                <div className="text-sm text-text-secondary">
                  Only lifecycle events captured. Open Terminal for the raw session.
                </div>
              )}
              {endItem && <TranscriptItem item={endItem} isLatest={isLatest && visibleItems.length === 0} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}

function coalesceRunItems(items: RenderItem[]): RenderItem[] {
  const coalesced: RenderItem[] = []

  for (const item of items) {
    const previous = coalesced.at(-1)
    if (
      item.kind === 'assistant' &&
      item.source === 'agent_output' &&
      previous?.kind === 'assistant' &&
      previous.source === 'agent_output'
    ) {
      previous.content = `${previous.content}\n${item.content}`
      previous.timestamp = item.timestamp
      continue
    }
    if (item.kind === 'tool' && previous?.kind === 'tool' && previous.name === item.name) {
      previous.status = item.status === 'completed' ? 'completed' : previous.status
      previous.detail = joinDetails(previous.detail, item.detail)
      previous.timestamp = item.timestamp
      continue
    }
    if (item.kind === 'command' && previous?.kind === 'command' && previous.name === item.name) {
      previous.status = item.status === 'completed' ? 'completed' : previous.status === 'completed' ? 'completed' : item.status
      previous.content = joinDetails(previous.content, item.content)
      previous.detail = joinDetails(previous.detail, item.detail)
      previous.timestamp = item.timestamp
      continue
    }
    coalesced.push(item)
  }

  return coalesced
}

function joinDetails(existing?: string, next?: string): string | undefined {
  if (!existing) return next
  if (!next || existing.includes(next)) return existing
  return `${existing}\n\n${next}`
}

function RunStatusBadge({ status, detail }: { status: RunStatus; detail?: string }) {
  const className = {
    completed: 'border-running/25 text-running/85',
    failed: 'border-error/35 text-error',
    cancelled: 'border-warning/35 text-warning',
    running: 'border-accent/30 text-accent/80',
  }[status]
  const label = {
    completed: 'agent completed',
    failed: 'agent failed',
    cancelled: 'agent cancelled',
    running: 'running',
  }[status]

  return (
    <span className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold ${className}`}>
      {label}{detail ? ` · ${detail}` : ''}
    </span>
  )
}

type RunStatus = 'completed' | 'failed' | 'cancelled' | 'running'

function runStatus(items: RenderItem[]): RunStatus {
  const end = [...items].reverse().find((item): item is Extract<RenderItem, { kind: 'end' }> => item.kind === 'end')
  return end?.status ?? 'running'
}

function runStatusDetail(items: RenderItem[]): string | undefined {
  const end = [...items].reverse().find((item): item is Extract<RenderItem, { kind: 'end' }> => item.kind === 'end')
  return end?.detail
}

function TranscriptItem({ item, isLatest }: { item: RenderItem; isLatest: boolean }) {
  switch (item.kind) {
    case 'meta':
      return <MetaEntry item={item} isLatest={isLatest} />
    case 'user':
      return (
        <EntryShell isLatest={isLatest} border="border-accent/50">
          <EntryMeta label="> user" tone="user" detail={item.detail} timestamp={item.timestamp} />
          <MarkdownBlock content={item.content} muted />
        </EntryShell>
      )
    case 'assistant':
      return (
        <EntryShell isLatest={isLatest} border="border-border-default">
          <EntryMeta label={item.source === 'agent_output' ? 'agent output' : 'agent'} tone="agent" timestamp={item.timestamp} />
          {item.source === 'agent_output'
            ? <AgentOutputBlock content={item.content} storageKeyPrefix={`agent-transcript:agent-output:${item.id}`} />
            : <MarkdownBlock content={item.content} />}
        </EntryShell>
      )
    case 'thinking':
      return (
        <EntryShell isLatest={isLatest} border="border-border-default">
          <CollapsibleBlock label="thinking" content={item.content} storageKey={`agent-transcript:thinking:${item.id}`} />
        </EntryShell>
      )
    case 'tool':
      return <ToolEntry item={item} isLatest={isLatest} />
    case 'command':
      return <CommandEntry item={item} isLatest={isLatest} />
    case 'end':
      return (
        <EntryShell isLatest={isLatest} border={item.status === 'completed' ? 'border-running/50' : item.status === 'cancelled' ? 'border-warning/50' : 'border-error/50'}>
          <EntryMeta
            label={item.status === 'completed' ? 'agent completed' : item.status === 'cancelled' ? 'agent cancelled' : 'agent failed'}
            tone={item.status === 'completed' ? 'running' : item.status === 'cancelled' ? 'queued' : 'error'}
            detail={item.detail}
            timestamp={item.timestamp}
          />
        </EntryShell>
      )
  }
}

function EntryShell({
  children,
  isLatest,
  border,
}: {
  children: ReactNode
  isLatest: boolean
  border: string
}) {
  return (
    <motion.article
      initial={isLatest ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      className={`border-l pl-3 ${border}`}
    >
      {children}
    </motion.article>
  )
}

function MetaEntry({ item, isLatest }: { item: Extract<RenderItem, { kind: 'meta' }>; isLatest: boolean }) {
  return (
    <motion.div
      initial={isLatest ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 py-0.5"
    >
      <div className="h-px flex-1 bg-border-default" />
      <span className="max-w-full truncate text-[10px] text-text-secondary">
        {item.label}{item.detail ? ` · ${item.detail}` : ''}
      </span>
      <div className="h-px flex-1 bg-border-default" />
    </motion.div>
  )
}

function ToolEntry({ item, isLatest }: { item: Extract<RenderItem, { kind: 'tool' }>; isLatest: boolean }) {
  const detail = item.detail?.trim()
  return (
    <EntryShell isLatest={isLatest} border="border-border-default">
      <ActionDisclosure
        title={item.name}
        detail={detail}
        status={item.status}
        timestamp={item.timestamp}
        storageKey={`agent-transcript:tool:${item.id}:${item.name}`}
      />
    </EntryShell>
  )
}

function CommandEntry({ item, isLatest }: { item: Extract<RenderItem, { kind: 'command' }>; isLatest: boolean }) {
  const detail = joinDetails(item.content, item.detail)?.trim()
  return (
    <EntryShell isLatest={isLatest} border="border-border-default">
      <ActionDisclosure
        title={item.name}
        detail={detail}
        status={item.status}
        timestamp={item.timestamp}
        storageKey={`agent-transcript:command:${item.id}:${item.name}`}
      />
    </EntryShell>
  )
}

function usePersistentDisclosure(key: string | undefined, defaultOpen: boolean): [boolean, (value: boolean) => void] {
  const [open, setOpenState] = useState(() => {
    if (!key || typeof window === 'undefined') return defaultOpen
    const saved = window.localStorage.getItem(key)
    if (saved === 'open') return true
    if (saved === 'closed') return false
    return defaultOpen
  })

  const setOpen = (value: boolean) => {
    setOpenState(value)
    if (!key || typeof window === 'undefined') return
    window.localStorage.setItem(key, value ? 'open' : 'closed')
  }

  return [open, setOpen]
}

function CollapsibleBlock({ label, content, storageKey }: { label: string; content: string; storageKey?: string }) {
  const [open, setOpen] = usePersistentDisclosure(storageKey, false)
  return (
    <section className="rounded border border-border-default bg-surface/50">
      <button
        type="button"
        onClick={() => { setOpen(!open) }}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-text-secondary hover:text-text-primary"
        style={{ cursor: 'pointer' }}
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        {label}
      </button>
      <AnimatePresence>
        {open && (
          <motion.pre
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-border-default px-3 py-2 text-xs leading-relaxed text-text-secondary"
          >
            {content}
          </motion.pre>
        )}
      </AnimatePresence>
    </section>
  )
}

function AgentOutputBlock({ content, storageKeyPrefix }: { content: string; storageKeyPrefix: string }) {
  const sections = useMemo(() => parseAgentOutputSections(cleanTmuxTailForTranscript(content)), [content])

  return (
    <div className="space-y-2">
      {sections.map((section, index) => (
        <AgentOutputSectionView
          key={`${section.type}-${String(index)}`}
          section={section}
          storageKey={`${storageKeyPrefix}:${section.type}:${String(index)}:${section.type === 'tool' ? section.name : ''}`}
        />
      ))}
    </div>
  )
}

function AgentOutputSectionView({ section, storageKey }: { section: AgentOutputSection; storageKey: string }) {
  switch (section.type) {
    case 'text':
      return <MarkdownBlock content={section.content} />
    case 'thinking':
      return (
        <div className="text-sm italic text-text-secondary">
          {section.content.replace(/^◆\s*/, '')}
        </div>
      )
    case 'tool':
      return <ToolOutputSection section={section} storageKey={storageKey} />
    case 'done':
      return (
        <div className="text-xs font-semibold text-warning">
          {section.content}
        </div>
      )
  }
}

function ToolOutputSection({ section, storageKey }: { section: Extract<AgentOutputSection, { type: 'tool' }>; storageKey: string }) {
  return (
    <ActionDisclosure
      title={section.name}
      detail={section.details.join('\n\n').trim()}
      storageKey={storageKey}
    />
  )
}

function ActionDisclosure({
  title,
  detail,
  storageKey,
  status,
  timestamp,
}: {
  title: string
  detail?: string
  storageKey: string
  status?: 'started' | 'output' | 'completed'
  timestamp?: string
}) {
  const [open, setOpen] = usePersistentDisclosure(storageKey, false)
  const hasDetail = Boolean(detail?.trim())

  return (
    <section className="rounded border border-border-default/70 bg-surface/25">
      <button
        type="button"
        onClick={() => { setOpen(!open) }}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-text-primary/75 hover:bg-surface/40"
        style={{ cursor: 'pointer' }}
      >
        <span className={`text-xs text-running/65 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="font-semibold text-running/70">{title}</span>
        {status && (
          <span className="text-[10px] text-text-secondary/60">
            {status}
          </span>
        )}
        {timestamp && (
          <time className="text-[10px] text-text-secondary/45">
            {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
        )}
        {hasDetail && <span className="ml-auto text-[10px] text-text-secondary">details</span>}
      </button>
      <AnimatePresence>
        {open && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden break-words border-t border-border-default/70 px-3 py-2"
          >
            <MarkdownBlock content={detail ?? ''} muted />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

function parseAgentOutputSections(content: string): AgentOutputSection[] {
  const sections: AgentOutputSection[] = []
  let textBuffer: string[] = []
  let currentTool: Extract<AgentOutputSection, { type: 'tool' }> | null = null

  const flushText = () => {
    const text = textBuffer.join('\n').trim()
    if (text) {
      if (currentTool) {
        currentTool.details.push(text)
      } else {
        sections.push({ type: 'text', content: text })
      }
    }
    textBuffer = []
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (/^([▶▸])\s+/.test(trimmed)) {
      flushText()
      currentTool = { type: 'tool', name: trimmed.replace(/^([▶▸])\s+/, ''), details: [] }
      sections.push(currentTool)
      continue
    }
    if (/^[✓✔]\s*/.test(trimmed)) {
      flushText()
      const detail = trimmed.replace(/^[✓✔]\s*/, '')
      if (currentTool) {
        currentTool.details.push(`✓ ${detail}`)
      } else {
        sections.push({ type: 'text', content: `✓ ${detail}` })
      }
      continue
    }
    if (/^(◆\s*)?thinking[.…]*/i.test(trimmed)) {
      flushText()
      currentTool = null
      sections.push({ type: 'thinking', content: trimmed })
      continue
    }
    if (/^── done\b/.test(trimmed)) {
      flushText()
      currentTool = null
      sections.push({ type: 'done', content: trimmed })
      continue
    }
    textBuffer.push(line)
  }

  flushText()
  return sections
}

function RunningEntry({
  startTime,
  queueCount,
  onCancel,
}: {
  startTime: number
  queueCount: number
  onCancel?: () => void
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    setElapsed(Math.floor((Date.now() - startTime) / 1000))
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => { clearInterval(interval) }
  }, [startTime])

  return (
    <EntryShell isLatest border="border-running/50">
      <div className="flex items-center justify-between gap-3">
        <EntryMeta label="agent" tone="running" detail={`running${elapsed > 0 ? ` · ${String(elapsed)}s` : ''}${queueCount > 0 ? ` · ${String(queueCount)} queued` : ''}`} />
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border-default px-2 py-0.5 text-[10px] text-text-secondary hover:border-error/40 hover:text-error"
            style={{ cursor: 'pointer' }}
          >
            Cancel
          </button>
        )}
      </div>
      <div className="text-sm text-text-secondary">waiting for semantic events...</div>
    </EntryShell>
  )
}

function QueuedEntry({ content }: { content: string }) {
  return (
    <EntryShell isLatest border="border-accent/30">
      <EntryMeta label="> user" tone="queued" detail="queued" />
      <MarkdownBlock content={content} muted />
    </EntryShell>
  )
}

function EntryMeta({
  label,
  tone,
  timestamp,
  detail,
}: {
  label: string
  tone: 'user' | 'agent' | 'running' | 'queued' | 'error'
  timestamp?: string
  detail?: string
}) {
  const toneClass = {
    user: 'text-accent',
    agent: 'text-text-secondary',
    running: 'text-running',
    queued: 'text-accent/70',
    error: 'text-error',
  }[tone]

  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
      <span className={`font-semibold ${toneClass}`}>{label}</span>
      {detail && <span className="min-w-0 break-words text-text-secondary/70">{detail}</span>}
      {timestamp && (
        <time className="text-text-secondary/50">
          {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      )}
    </div>
  )
}

const MarkdownBlock = memo(function MarkdownBlock({
  content,
  muted = false,
}: {
  content: string
  muted?: boolean
}) {
  return (
    <div className={`break-words text-sm leading-relaxed ${muted ? 'text-text-primary/90' : 'text-text-primary'}`}>
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="my-1 whitespace-pre-wrap break-words">{children}</p>,
          h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold text-text-primary">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-text-primary">{children}</h3>,
          ul: ({ children }) => <ul className="my-1 ml-5 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 ml-5 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          code: ({ children }) => (
            <code className="rounded bg-surface px-1 py-0.5 text-[0.9em] text-accent">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-auto whitespace-pre-wrap break-words rounded border border-border-default bg-surface p-3 text-xs leading-relaxed">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l border-border-default pl-3 text-text-secondary">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a href={href} className="text-accent underline underline-offset-2">
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

function parseMetadata(metadataJson: string | null): Record<string, unknown> {
  if (!metadataJson) return {}
  try {
    const parsed = JSON.parse(metadataJson) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

function runKey(metadata: Record<string, unknown>): string {
  return [stringMeta(metadata, 'cli'), stringMeta(metadata, 'workdir')].join('|')
}

function compactRunDetail(metadata: Record<string, unknown>): string | undefined {
  const column = stringMeta(metadata, 'columnName')
  const context = stringMeta(metadata, 'resumeAvailable') === 'true' ? 'resume' : null
  const cli = stringMeta(metadata, 'cli')
  const model = stringMeta(metadata, 'model')
  const workdir = compactPath(stringMeta(metadata, 'workdir'))
  return [column, context, model, cli, workdir].filter(Boolean).join(' · ') || undefined
}

function userInputDetail(metadata: Record<string, unknown>): string | undefined {
  const delivery = stringMeta(metadata, 'delivery')
  if (!delivery || delivery === 'live') return undefined
  if (delivery === 'queued') return 'queued for next turn'
  if (delivery === 'resume_turn') return 'resumes previous session'
  if (delivery === 'new_turn') return 'starts new turn'
  return delivery.replace(/_/g, ' ')
}

function compactPath(path: string | null): string | null {
  if (!path) return null
  const parts = path.split('/').filter(Boolean)
  const last = parts.at(-1)
  if (!last) return path
  return last.length > 32 ? `${last.slice(0, 18)}...${last.slice(-8)}` : last
}

function formatCommandDetail(eventType: AgentTranscriptEvent['eventType'], metadata: Record<string, unknown>): string | undefined {
  if (eventType === 'command_started') return undefined
  const exitCode = stringMeta(metadata, 'exitCode')
  if (eventType === 'command_completed') {
    if (exitCode === '130') return 'cancelled'
    return exitCode ? `exit ${exitCode}` : undefined
  }
  return undefined
}

function commandDisplayName(metadata: Record<string, unknown>): string {
  const command = stringMeta(metadata, 'command') ?? stringMeta(metadata, 'cli')
  if (!command) return 'Command'
  const commandName = command.split(/\s+/)[0]?.split('/').at(-1) ?? command
  if (/claude|codex|bash|zsh|sh\b/i.test(commandName)) {
    return /bash|zsh|sh\b/i.test(commandName) ? 'Bash' : commandName.replace(/[_-]cli$/i, '')
  }
  return commandName || 'Command'
}

function hasCommandIdentity(metadata: Record<string, unknown>): boolean {
  return Boolean(stringMeta(metadata, 'commandId') || stringMeta(metadata, 'command'))
}

function formatEndDetail(metadata: Record<string, unknown>): string | undefined {
  const exitCode = stringMeta(metadata, 'exitCode')
  if (!exitCode || exitCode === '0' || exitCode === '130') return undefined
  const error = stringMeta(metadata, 'error')
  return error ?? `exit ${exitCode}`
}

function endStatus(eventType: AgentTranscriptEvent['eventType'], metadata: Record<string, unknown>): Extract<RenderItem, { kind: 'end' }>['status'] {
  if (eventType === 'agent_completed') return 'completed'
  if (eventType === 'agent_cancelled') return 'cancelled'
  return stringMeta(metadata, 'exitCode') === '130' ? 'cancelled' : 'failed'
}

function transcriptCommandOutput(content: string | null, metadata: Record<string, unknown>): string | null {
  const cleaned = isTmuxTranscriptSource(metadata)
    ? cleanTmuxTailForTranscript(content ?? '')
    : cleanCommandOutput(content ?? '')
  if (cleaned.trim().length === 0 || looksLikeRawTerminal(cleaned)) return null
  return cleaned
}

function isTmuxTranscriptSource(metadata: Record<string, unknown>): boolean {
  const source = stringMeta(metadata, 'source')
  return source === 'tmux_log_tail' || source === 'tmux_live_tail'
}

function cleanCommandOutput(content: string): string {
  return stripTerminalControls(content)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n')
}

function cleanTmuxTailForTranscript(content: string): string {
  return stripTerminalControls(content)
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\t/g, '  ').trimEnd())
    .map(readableToolResultLine)
    .filter((line) => !isTerminalScaffoldLine(line))
    .filter((line) => !isLikelyTruncatedTailFragment(line))
    .reduce<string[]>((lines, line) => {
      const previous = lines.at(-1)
      if (!line.trim() && (!previous || !previous.trim())) return lines
      lines.push(line)
      return lines
    }, [])
    .join('\n')
    .trim()
}

function readableToolResultLine(line: string): string {
  const jsonStart = line.indexOf('[{"type":"text"')
  if (jsonStart === -1) return line

  const prefix = line.slice(0, jsonStart).replace(/^[✓✔]\s*/, '').trim()
  const rawJson = line.slice(jsonStart).trim()
  try {
    const parsed = JSON.parse(rawJson) as unknown
    if (!Array.isArray(parsed)) return line
    const text = parsed
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const value = (part as { text?: unknown }).text
        return typeof value === 'string' ? value : ''
      })
      .filter(Boolean)
      .join('')
      .trim()
    if (!text) return line
    return [prefix, text].filter(Boolean).join(' ')
  } catch {
    return line
  }
}

function isLikelyTruncatedTailFragment(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true
  if (/^-\s+Wo$/.test(trimmed)) return true
  if (/^(cont|conte|contex|context)$/i.test(trimmed)) return true
  if (/^[a-z]$/i.test(trimmed)) return true
  return false
}

function isTerminalScaffoldLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true
  if (trimmed === '^C') return true
  if (trimmed === '%' || trimmed === 'm') return true
  if (trimmed.includes('BENTOYA_CLAUDE_SESSION_ID:')) return true
  if (trimmed.includes('/.bentoya/trigger_logs/run_')) return true
  if (/^[a-f0-9]{6,}\.sh'?$/i.test(trimmed)) return true
  if (/^b?bash\s+'?\/Users\/bento/i.test(trimmed)) return true
  if (/\bbash ['"].*run_[a-z0-9]+\.sh['"]?/i.test(trimmed)) return true
  if (/\w+@[\w.-]+\s+\S+\s+%/.test(trimmed)) return true
  if (/^\[[^\]]+:zsh\*?\]/.test(trimmed)) return true
  if (/^\[[0-9]+,[0-9]+\]/.test(trimmed)) return true
  if (/^\[claude\b.*\]$/i.test(trimmed)) return true
  if (/^BENTOYA_CLAUDE_FILTER=/.test(trimmed)) return true
  if (/^quote>/.test(trimmed)) return true
  return false
}

function looksLikeRawTerminal(content: string): boolean {
  return (
    content.includes('/.bentoya/trigger_logs/run_') ||
    content.includes('BENTOYA_CLAUDE_FILTER=') ||
    content.includes('quote>') ||
    /bentoya-[0-9a-f-]+\s*%/.test(content) ||
    /\[[^\]]+:zsh\*\]/.test(content)
  )
}

function stripTerminalControls(content: string): string {
  return content
    .replace(/�\[[0-9;?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[=>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}
