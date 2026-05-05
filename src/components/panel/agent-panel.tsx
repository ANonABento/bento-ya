/**
 * Agent Panel — single Terminal view backed by a per-task tmux PTY session.
 *
 * Every pipeline trigger now runs inside a tmux session named
 * `bentoya_<task_id>`, so this panel just attaches an xterm.js view to that
 * session via `ensure_pty_session`. The same panel works for:
 *   - Manual / shell-only tasks (no agent yet) → spawns a bare shell on attach
 *   - Running pipeline triggers → reattaches to the existing tmux session and
 *     streams live output
 *   - Completed tasks → replays the cached scrollback (xterm.js renders it
 *     instantly on attach)
 *
 * The "Output" tab from the previous capture-only architecture is gone — the
 * Terminal panel IS the output, and it's interactive: type into it, press
 * Ctrl+C, scroll back, etc.
 */

import { useState } from 'react'
import type { Task } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { signalPtyInterrupt } from '@/lib/ipc/terminal'
import { TerminalView } from './terminal-view'

type AgentPanelProps = {
  task: Task
  onClose?: () => void
}

export function AgentPanel({ task, onClose }: AgentPanelProps) {
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = task.worktreePath ?? workspace?.repoPath ?? ''
  const [stopBusy, setStopBusy] = useState(false)

  const isAgentRunning = task.agentStatus === 'running'

  const handleStop = async () => {
    if (stopBusy) return
    setStopBusy(true)
    try {
      await signalPtyInterrupt(task.id)
    } catch (err) {
      // Most common cause: no tmux session (e.g. manual task with bare shell
      // that was already terminated). The error is informational only.
      console.warn(`[agent-panel] stop failed for ${task.id}:`, err)
    } finally {
      // Brief debounce so the button can't be re-fired before the signal lands.
      setTimeout(() => { setStopBusy(false) }, 300)
    }
  }

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
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M5 3l5 4-5 4" />
              </svg>
            </button>
          )}
          <span className="max-w-[260px] truncate text-[10px] text-text-secondary">
            {task.title}
          </span>
        </div>

        <div className="inline-flex items-center gap-1.5 text-xs">
          <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-secondary">
            Terminal
          </span>
          {isAgentRunning && (
            <span className="inline-flex items-center gap-1 rounded bg-running/10 px-1.5 py-0.5 text-[10px] text-running">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-running" />
              live
            </span>
          )}
          <button
            type="button"
            onClick={() => { void handleStop() }}
            disabled={stopBusy}
            title="Send Ctrl+C to the agent (does not kill the session)"
            className="rounded border border-border-default bg-surface px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            style={{ cursor: stopBusy ? 'wait' : 'pointer' }}
          >
            Stop
          </button>
        </div>
      </div>

      {/* Body — Terminal panel is now the only view */}
      <div className="relative min-h-0 flex-1">
        <TerminalView taskId={task.id} workingDir={workingDir} />
      </div>
    </div>
  )
}
