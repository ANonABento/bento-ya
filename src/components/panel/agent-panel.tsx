/**
 * Agent Panel — per-task agent activity + raw terminal interface.
 * Two tabs:
 *   - "Output" — structured live agent activity (tool calls, thinking, streamed
 *     text) rendered directly from useAgentStreamingStore. Default for any task
 *     that ever ran an agent.
 *   - "Terminal" — raw xterm.js view bound to the per-task PTY. Default when
 *     the task has no agent stream history (manual / shell-only tasks).
 */

import { useEffect, useRef, useState } from 'react'
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
        <div className={tab === 'output' ? 'h-full overflow-auto' : 'hidden'} aria-hidden={tab !== 'output'}>
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

// ─── Output view: direct render from streaming store ────────────────────────

function OutputView({ task }: { task: Task }) {
  const stream = useAgentStreamingStore((s) => s.streams.get(task.id))

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
    <div className="flex flex-col gap-3 px-3 py-3 text-sm">
      {/* Status banner */}
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
        {isCompleted ? (
          <span className="rounded bg-green-500/10 px-2 py-0.5 text-green-400">Completed</span>
        ) : (
          <span className="rounded bg-blue-500/10 px-2 py-0.5 text-blue-400">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400 align-middle" />
            Streaming
          </span>
        )}
        <span className="text-text-secondary/60">{stream.toolCount} tool calls</span>
      </div>

      {/* Tool calls — most recent at bottom */}
      {stream.allToolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stream.allToolCalls.map((tool) => (
            <ToolBadge key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {/* Thinking */}
      {stream.thinkingContent.trim() && (
        <details className="rounded-md border border-purple-500/20 bg-purple-500/5">
          <summary className="cursor-pointer select-none px-3 py-1.5 text-[11px] text-purple-300">
            💭 Thinking ({stream.thinkingContent.split('\n').length} lines)
          </summary>
          <pre className="whitespace-pre-wrap break-words px-3 py-2 text-[11px] font-mono text-purple-200/80">
            {stream.thinkingContent}
          </pre>
        </details>
      )}

      {/* Streamed content (markdown) */}
      {stream.fullContent && (
        <div className="prose prose-invert prose-sm max-w-none text-text-primary [&_code]:text-[12px] [&_pre]:text-[12px]">
          <ReactMarkdown>{stream.fullContent}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

// ─── Components ─────────────────────────────────────────────────────────────

const TOOL_STATUS_PALETTE: Record<LiveToolCall['status'], string> = {
  pending:   'bg-surface-hover text-text-secondary border-border-default',
  running:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
  completed: 'bg-green-500/10 text-green-400 border-green-500/20',
  error:     'bg-red-500/10 text-red-400 border-red-500/20',
}

const TOOL_STATUS_ICON: Record<LiveToolCall['status'], string> = {
  pending: '○',
  running: '⏳',
  completed: '✓',
  error: '✗',
}

function ToolBadge({ tool }: { tool: LiveToolCall }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-mono ${TOOL_STATUS_PALETTE[tool.status]}`}>
      <span>{TOOL_STATUS_ICON[tool.status]}</span>
      <span className="max-w-[200px] truncate">{tool.name}</span>
    </span>
  )
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
