import { invoke, listen, type EventCallback, type UnlistenFn } from './invoke'
import type { Task } from '@/types'

// ─── Pipeline commands ─────────────────────────────────────────────────────

export type PipelineEvent = {
  taskId: string
  columnId: string
  eventType: string
  state: string
  message: string | null
}

export async function markPipelineComplete(
  taskId: string,
  success: boolean,
): Promise<Task> {
  return invoke<Task>('mark_pipeline_complete', { taskId, success })
}

export async function getPipelineState(taskId: string): Promise<string> {
  return invoke<string>('get_pipeline_state', { taskId })
}

export async function tryAdvanceTask(taskId: string): Promise<Task | null> {
  return invoke<Task | null>('try_advance_task', { taskId })
}

export async function setPipelineError(
  taskId: string,
  errorMessage: string,
): Promise<Task> {
  return invoke<Task>('set_pipeline_error', { taskId, errorMessage })
}

export async function retryPipeline(taskId: string): Promise<Task> {
  return invoke<Task>('retry_pipeline', { taskId })
}

// ─── Batch Queue ────────────────────────────────────────────────────────────

export async function queueBacklog(taskIds: string[]): Promise<Task[]> {
  return invoke<Task[]>('queue_agent_tasks', { taskIds })
}

export async function cancelBacklogQueue(taskIds: string[]): Promise<void> {
  await Promise.all(
    taskIds.map((taskId) =>
      invoke('update_task_agent_status', { taskId, agentStatus: null, queuedAt: null })
    )
  )
}

// ─── Pipeline event listeners ───────────────────────────────────────────────

export const onPipelineTriggered = (cb: EventCallback<PipelineEvent>): Promise<UnlistenFn> =>
  listen<PipelineEvent>('pipeline:triggered', cb)
export const onPipelineRunning = (cb: EventCallback<PipelineEvent>): Promise<UnlistenFn> =>
  listen<PipelineEvent>('pipeline:running', cb)
export const onPipelineAdvanced = (cb: EventCallback<PipelineEvent>): Promise<UnlistenFn> =>
  listen<PipelineEvent>('pipeline:advanced', cb)
export const onPipelineComplete = (cb: EventCallback<PipelineEvent>): Promise<UnlistenFn> =>
  listen<PipelineEvent>('pipeline:complete', cb)
export const onPipelineError = (cb: EventCallback<PipelineEvent>): Promise<UnlistenFn> =>
  listen<PipelineEvent>('pipeline:error', cb)
