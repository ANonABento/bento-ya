import { useCallback } from 'react'
import { TerminalView } from './terminal-view'
import { ensureChefTerminal, chefSessionKey, type EnsureSessionFn } from '@/lib/ipc/terminal'

/**
 * Workspace-level terminal for the chef/orchestrator panel. Reuses the per-task
 * `TerminalView` but points it at a `chef_<workspaceId>` session via the
 * `ensureChefTerminal` strategy — a shell rooted at the repo the user can drive
 * `claude`/`codex` from without leaving the app.
 */
export function OrchestratorTerminalView({ workspaceId }: { workspaceId: string }) {
  const ensure = useCallback<EnsureSessionFn>(
    (_id, _workingDir, cols, rows, allowSpawn) =>
      ensureChefTerminal(workspaceId, cols, rows, allowSpawn),
    [workspaceId],
  )

  return (
    <TerminalView
      taskId={chefSessionKey(workspaceId)}
      workingDir=""
      ensure={ensure}
    />
  )
}
