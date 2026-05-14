/**
 * IPC wrappers for the Phase 2 interactive runtime mode commands.
 *
 * These are split out of `agent.ts` because they're scoped to a specific
 * runtime mode and have different semantics (commands fail loudly when
 * the task isn't in interactive mode, instead of falling back silently).
 */

import { invoke } from './invoke'

export type ResolvedRuntimeMode = {
  mode: 'headless' | 'interactive'
  render: 'bubbles' | 'terminal' | null
  source: 'trigger' | 'task' | 'column' | 'workspace' | 'global' | 'default'
  interactiveDevFlagRequired: boolean
}

/** Resolve the effective runtime mode for a task. */
export async function resolveRuntimeMode(taskId: string): Promise<ResolvedRuntimeMode> {
  return invoke<ResolvedRuntimeMode>('resolve_runtime_mode', { taskId })
}

/** Inject a literal message into the live interactive agent. */
export async function agentInjectMessage(taskId: string, message: string): Promise<void> {
  return invoke('agent_inject_message', { taskId, message })
}

/**
 * Send Ctrl+C to the live agent. In interactive mode the agent returns
 * to its prompt (alive); in headless mode the underlying `-p` process
 * dies. Works in either mode.
 */
export async function agentInterrupt(taskId: string): Promise<void> {
  return invoke('agent_interrupt', { taskId })
}

/** Send `/model <name>` to the live interactive agent. */
export async function agentSwitchModel(taskId: string, model: string): Promise<void> {
  return invoke('agent_switch_model', { taskId, model })
}

/** Kill the current interactive agent and respawn with the same config. */
export async function agentRestart(taskId: string): Promise<void> {
  return invoke('agent_restart', { taskId })
}

/**
 * Pause an interactive agent via SIGTSTP. The TUI freezes; in-flight
 * network calls keep running (their responses are queued) but the
 * agent doesn't process them until resumed. Errors when the task is
 * already paused or not running in interactive mode.
 */
export async function agentPause(taskId: string): Promise<void> {
  return invoke('agent_pause', { taskId })
}

/** Resume a paused interactive agent. Errors when the task isn't paused. */
export async function agentResume(taskId: string): Promise<void> {
  return invoke('agent_resume', { taskId })
}

/**
 * True when the KAITENCODE_INTERACTIVE_MODE_ENABLED env var is set. Used by
 * the settings modal to grey out the interactive picker option.
 */
export async function interactiveModeDevFlag(): Promise<boolean> {
  return invoke<boolean>('interactive_mode_dev_flag')
}

export type AgentCompletionEvent = {
  id: number
  taskId: string
  workspaceId: string
  cli: string
  mode: 'headless' | 'interactive'
  completionSource: 'sentinel' | 'exit_code' | 'manual' | 'timeout' | 'kill'
  durationMs: number
  sentinelSeenAt: number | null
  createdAt: number
}

/**
 * Recent completion events for a workspace, newest first. Powers the
 * Phase 4 telemetry view. Capped server-side at 200.
 */
export async function listCompletionEvents(
  workspaceId: string,
  limit?: number,
): Promise<AgentCompletionEvent[]> {
  return invoke<AgentCompletionEvent[]>('list_completion_events', { workspaceId, limit })
}
