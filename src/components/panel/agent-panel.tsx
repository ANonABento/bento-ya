/**
 * Agent Panel - Per-task terminal interface.
 * Renders an embedded terminal (xterm.js) for each task.
 * Bubble chat view is hidden — can be re-enabled later.
 */

import type { Task } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { TerminalView } from './terminal-view'

type AgentPanelProps = {
  task: Task
  onClose?: () => void
  onSwitchToDetail?: () => void
}

export function AgentPanel({ task, onClose, onSwitchToDetail }: AgentPanelProps) {
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = task.worktreePath ?? workspace?.repoPath ?? ''

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2">
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              title="Close terminal (Esc)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 3l5 4-5 4" />
              </svg>
            </button>
          )}
          <span className="text-xs font-medium text-text-primary">
            Terminal
          </span>
          <span className="text-[10px] text-text-secondary truncate max-w-[120px]">
            {task.title}
          </span>
        </div>
        {onSwitchToDetail && (
          <button
            type="button"
            onClick={onSwitchToDetail}
            className="rounded border border-border-default px-2 py-1 text-[10px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            title="Switch to task detail (⌘I)"
          >
            Detail
          </button>
        )}
      </div>

      {/* Terminal */}
      <TerminalView taskId={task.id} workingDir={workingDir} />
    </div>
  )
}
