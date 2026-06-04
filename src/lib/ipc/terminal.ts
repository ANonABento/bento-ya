import { invoke } from './invoke'

// ─── Terminal PTY commands ─────────────────────────────────────────────────

export async function writeToPty(taskId: string, data: string): Promise<void> {
  return invoke('write_to_pty', { taskId, data })
}

export async function resizePty(taskId: string, cols: number, rows: number): Promise<void> {
  return invoke('resize_pty', { taskId, cols, rows })
}

export async function getPtyScrollback(taskId: string): Promise<string> {
  return invoke<string>('get_pty_scrollback', { taskId })
}

/**
 * Send Ctrl+C (SIGINT) to a task's tmux pane. Used by the "Stop agent"
 * button to interrupt a running agent without tearing down the session.
 */
export async function signalPtyInterrupt(taskId: string): Promise<void> {
  return invoke('signal_pty_interrupt', { taskId })
}

export async function ensurePtySession(
  taskId: string,
  workingDir: string,
  cols: number,
  rows: number,
  allowSpawn = true,
): Promise<{ taskId: string; pid: number | null; status: string; scrollback?: string }> {
  return invoke('ensure_pty_session', { taskId, workingDir, cols, rows, allowSpawn })
}

/** AgentInfo shape returned by the PTY-ensure commands. */
export type EnsureSessionInfo = {
  taskId: string
  pid: number | null
  status: string
  scrollback?: string
}

/** Common signature shared by `ensurePtySession` and `ensureChefTerminal`, so a
 *  terminal view can be pointed at either a task or a workspace-level session. */
export type EnsureSessionFn = (
  id: string,
  workingDir: string,
  cols: number,
  rows: number,
  allowSpawn: boolean,
) => Promise<EnsureSessionInfo>

/** Registry key (and `pty:<key>:*` event prefix) for a workspace chef terminal. */
export function chefSessionKey(workspaceId: string): string {
  return `chef_${workspaceId}`
}

/**
 * Ensure the workspace-level chef terminal (a shell rooted at the repo) exists.
 * Mirrors `ensurePtySession` but keyed by workspace; the returned `taskId` is
 * the `chef_<workspaceId>` session key the generic PTY IPC + events use.
 */
export async function ensureChefTerminal(
  workspaceId: string,
  cols: number,
  rows: number,
  allowSpawn = true,
): Promise<EnsureSessionInfo> {
  return invoke('ensure_chef_terminal', { workspaceId, cols, rows, allowSpawn })
}

export type TransportType = 'pipe' | 'pty'

export async function switchAgentTransport(
  taskId: string,
  transportType: TransportType,
  options?: {
    cliPath?: string
    workingDir?: string
    cols?: number
    rows?: number
  },
): Promise<void> {
  return invoke('switch_agent_transport', {
    taskId,
    transportType,
    cliPath: options?.cliPath,
    workingDir: options?.workingDir,
    cols: options?.cols,
    rows: options?.rows,
  })
}
