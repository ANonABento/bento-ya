import { useCallback } from 'react'
import { TerminalView } from './terminal-view'
import { ensureChefTerminal, chefSessionKey, type EnsureSessionFn } from '@/lib/ipc/terminal'

/**
 * Workspace-level terminal for the chef/orchestrator panel. Reuses the per-task
 * `TerminalView` but points it at a `chef_<workspaceId>[_n]` session via the
 * `ensureChefTerminal` strategy — a shell rooted at the repo the user can drive
 * `claude`/`codex` from without leaving the app.
 *
 * Supports multiple shells as a sub-tab strip (the panel header's `+` adds one
 * when the Terminal view is active). Only the active shell renders; switching
 * re-attaches its tmux session with restored scrollback, like task terminals.
 */
type OrchestratorTerminalViewProps = {
  workspaceId: string
  /** Shell indices currently open (1-based). At least `[1]`. */
  shells: number[]
  activeShell: number
  onSelectShell: (shell: number) => void
  onCloseShell: (shell: number) => void
}

export function OrchestratorTerminalView({
  workspaceId,
  shells,
  activeShell,
  onSelectShell,
  onCloseShell,
}: OrchestratorTerminalViewProps) {
  const ensure = useCallback<EnsureSessionFn>(
    (_id, _workingDir, cols, rows, allowSpawn) =>
      ensureChefTerminal(workspaceId, cols, rows, allowSpawn, activeShell),
    [workspaceId, activeShell],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {shells.length > 1 && (
        <div
          data-testid="chef-shell-tabs"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-default bg-surface px-2 py-1"
        >
          {shells.map((shell) => {
            const isActive = shell === activeShell
            return (
              <div
                key={shell}
                className={`group flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${
                  isActive
                    ? 'bg-surface-hover text-text-primary'
                    : 'text-text-secondary hover:bg-surface-hover/60'
                }`}
              >
                <button
                  type="button"
                  data-testid={`chef-shell-tab-${String(shell)}`}
                  onClick={() => { onSelectShell(shell) }}
                  className="font-medium"
                  style={{ cursor: isActive ? 'default' : 'pointer' }}
                >
                  Shell {shell}
                </button>
                <button
                  type="button"
                  aria-label={`Close Shell ${String(shell)}`}
                  data-testid={`chef-shell-close-${String(shell)}`}
                  onClick={() => { onCloseShell(shell) }}
                  className="rounded px-0.5 text-text-secondary/60 opacity-0 transition-opacity hover:text-text-primary group-hover:opacity-100"
                  style={{ cursor: 'pointer' }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {/* Keyed by the session id so switching shells remounts the terminal
            against the right `chef_<ws>[_n]` session. */}
        <TerminalView
          key={chefSessionKey(workspaceId, activeShell)}
          taskId={chefSessionKey(workspaceId, activeShell)}
          workingDir=""
          ensure={ensure}
        />
      </div>
    </div>
  )
}
