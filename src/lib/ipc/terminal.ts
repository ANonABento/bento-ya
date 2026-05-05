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
): Promise<{ taskId: string; pid: number | null; status: string; scrollback?: string }> {
  return invoke('ensure_pty_session', { taskId, workingDir, cols, rows })
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
