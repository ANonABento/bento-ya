// Siege loop IPC commands

import { invoke, listen, type EventCallback, type UnlistenFn } from './core'
import type { Task } from '@/types'
import type {
  PrStatus,
  StartSiegeResult,
  CheckSiegeResult,
  SiegeEvent,
} from '@/types/task'

// ─── Siege loop commands ─────────────────────────────────────────────────────

export async function startSiege(
  taskId: string,
  maxIterations?: number,
  envVars?: Record<string, string>,
  cliPath?: string,
): Promise<StartSiegeResult> {
  return invoke<StartSiegeResult>('start_siege', { taskId, maxIterations, envVars, cliPath })
}

export async function stopSiege(taskId: string): Promise<Task> {
  return invoke<Task>('stop_siege', { taskId })
}

export async function checkSiegeStatus(taskId: string): Promise<CheckSiegeResult> {
  return invoke<CheckSiegeResult>('check_siege_status', { taskId })
}

export async function continueSiege(
  taskId: string,
  envVars?: Record<string, string>,
  cliPath?: string,
): Promise<StartSiegeResult> {
  return invoke<StartSiegeResult>('continue_siege', { taskId, envVars, cliPath })
}

export async function getPrStatus(taskId: string): Promise<PrStatus> {
  return invoke<PrStatus>('get_pr_status', { taskId })
}

// ─── Siege event listeners ───────────────────────────────────────────────────

export const onSiegeStarted = (cb: EventCallback<SiegeEvent>): Promise<UnlistenFn> =>
  listen<SiegeEvent>('siege:started', cb)

export const onSiegeIteration = (cb: EventCallback<SiegeEvent>): Promise<UnlistenFn> =>
  listen<SiegeEvent>('siege:iteration', cb)

export const onSiegeStopped = (cb: EventCallback<SiegeEvent>): Promise<UnlistenFn> =>
  listen<SiegeEvent>('siege:stopped', cb)

export const onSiegeComplete = (cb: EventCallback<SiegeEvent>): Promise<UnlistenFn> =>
  listen<SiegeEvent>('siege:complete', cb)
