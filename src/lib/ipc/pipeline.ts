// Pipeline IPC commands

import { invoke, listen, type EventCallback, type UnlistenFn } from './core'
import type { Task } from '@/types'

// ─── Types ─────────────────────────────────────────────────────────────────

export type PipelineEvent = {
  taskId: string
  columnId: string
  eventType: string
  state: string
  message: string | null
}

export type SpawnAgentEvent = {
  taskId: string
  columnId: string
  workspaceId: string
  agentType: string
  flags?: string[]
}

export type SpawnScriptEvent = {
  taskId: string
  columnId: string
  workspaceId: string
  scriptPath: string
  taskTitle: string
}

export type SpawnSkillEvent = {
  taskId: string
  columnId: string
  workspaceId: string
  skillName: string
  flags?: string[]
}

// ─── Pipeline commands ─────────────────────────────────────────────────────

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

export async function fireAgentTrigger(
  taskId: string,
  agentType: string,
  envVars?: Record<string, string>,
  cliPath?: string,
): Promise<Task> {
  return invoke<Task>('fire_agent_trigger', { taskId, agentType, envVars, cliPath })
}

export async function fireScriptTrigger(
  taskId: string,
  scriptPath: string,
): Promise<Task> {
  return invoke<Task>('fire_script_trigger', { taskId, scriptPath })
}

export async function fireSkillTrigger(
  taskId: string,
  skillName: string,
  envVars?: Record<string, string>,
  cliPath?: string,
): Promise<Task> {
  return invoke<Task>('fire_skill_trigger', { taskId, skillName, envVars, cliPath })
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

// ─── Pipeline spawn event listeners ─────────────────────────────────────────

export const onPipelineSpawnAgent = (
  cb: EventCallback<SpawnAgentEvent>,
): Promise<UnlistenFn> => listen<SpawnAgentEvent>('pipeline:spawn_agent', cb)

export const onPipelineSpawnScript = (
  cb: EventCallback<SpawnScriptEvent>,
): Promise<UnlistenFn> => listen<SpawnScriptEvent>('pipeline:spawn_script', cb)

export const onPipelineSpawnSkill = (
  cb: EventCallback<SpawnSkillEvent>,
): Promise<UnlistenFn> => listen<SpawnSkillEvent>('pipeline:spawn_skill', cb)
