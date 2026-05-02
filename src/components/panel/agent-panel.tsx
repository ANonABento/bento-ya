/**
 * Agent Panel - Per-task agent activity + terminal interface.
 * Two tabs:
 *   - "Output" — structured AgentOutput rendered from the live agent stream
 *     (tool calls, thinking, streamed Claude text). Default when the task has
 *     active or recent agent streaming activity.
 *   - "Terminal" — raw xterm.js view bound to the per-task PTY. Default when
 *     no streaming activity has been observed for this task.
 */

import { useMemo, useState } from 'react'
import type { Task } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useAgentStreamingStore, type AgentStream } from '@/stores/agent-streaming-store'
import { TerminalView } from './terminal-view'
import { AgentOutput } from './agent-output'

type AgentPanelProps = {
  task: Task
  onClose?: () => void
}

type AgentPanelTab = 'output' | 'terminal'

/**
 * Convert the structured streaming state into a raw-text representation
 * that AgentOutput's parser can render as tool-call badges, thinking
 * blocks, and markdown text.
 */
function streamToRawOutput(stream: AgentStream | undefined): string {
  if (!stream) return ''
  const parts: string[] = []

  if (stream.thinkingContent.trim()) {
    parts.push('thinking...')
    for (const line of stream.thinkingContent.split('\n')) {
      parts.push(`  ${line}`)
    }
    parts.push('')
  }

  for (const tool of stream.allToolCalls) {
    const marker = tool.status === 'completed' ? '✓' : '⚙'
    parts.push(`${marker} ${tool.name}`)
    if (tool.status === 'error') {
      parts.push(`Error: ${tool.name} failed`)
    }
  }

  if (stream.allToolCalls.length > 0 && stream.fullContent.trim()) {
    parts.push('')
  }

  if (stream.fullContent) {
    parts.push(stream.fullContent)
  }

  return parts.join('\n')
}

export function AgentPanel({ task, onClose }: AgentPanelProps) {
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = task.worktreePath ?? workspace?.repoPath ?? ''

  // Subscribe to the streaming store for this task
  const stream = useAgentStreamingStore((s) => s.streams.get(task.id))
  const hasStreamActivity = useMemo(
    () => Boolean(stream && (stream.fullContent || stream.allToolCalls.length > 0 || stream.thinkingContent)),
    [stream]
  )

  // Default to "output" when there's agent activity, otherwise terminal
  const [tab, setTab] = useState<AgentPanelTab>(hasStreamActivity ? 'output' : 'terminal')

  const rawOutput = useMemo(() => streamToRawOutput(stream), [stream])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
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
          <span className="text-[10px] text-text-secondary truncate max-w-[180px]">
            {task.title}
          </span>
        </div>

        {/* Tab toggle */}
        <div className="inline-flex rounded-md border border-border-default bg-surface p-0.5 text-xs">
          <TabButton
            label="Output"
            active={tab === 'output'}
            onClick={() => { setTab('output') }}
            indicator={hasStreamActivity}
          />
          <TabButton
            label="Terminal"
            active={tab === 'terminal'}
            onClick={() => { setTab('terminal') }}
          />
        </div>
      </div>

      {/* Body — keep TerminalView mounted (PTY state is fragile) but hide it when not active */}
      <div className="relative min-h-0 flex-1">
        <div
          className={tab === 'output' ? 'h-full overflow-auto' : 'hidden'}
          aria-hidden={tab !== 'output'}
        >
          <AgentOutput rawOutput={rawOutput} />
        </div>
        <div
          className={tab === 'terminal' ? 'h-full' : 'h-full invisible absolute inset-0'}
          aria-hidden={tab !== 'terminal'}
        >
          <TerminalView taskId={task.id} workingDir={workingDir} />
        </div>
      </div>
    </div>
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
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
      }`}
    >
      {label}
      {indicator && !active && (
        <span className="absolute -right-0.5 -top-0.5 flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-running opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
        </span>
      )}
    </button>
  )
}
