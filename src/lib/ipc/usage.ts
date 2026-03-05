// Usage tracking IPC commands

import { invoke } from './core'

// ─── Types ─────────────────────────────────────────────────────────────────

export type UsageRecord = {
  id: string
  workspaceId: string
  taskId: string | null
  sessionId: string | null
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  createdAt: string
}

export type UsageSummary = {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  recordCount: number
}

// ─── Usage tracking commands ─────────────────────────────────────────────────

export async function recordUsage(
  workspaceId: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  taskId?: string,
  sessionId?: string,
): Promise<UsageRecord> {
  return invoke<UsageRecord>('record_usage', {
    workspaceId,
    taskId,
    sessionId,
    provider,
    model,
    inputTokens,
    outputTokens,
    costUsd,
  })
}

export async function getWorkspaceUsage(
  workspaceId: string,
  limit?: number,
): Promise<UsageRecord[]> {
  return invoke<UsageRecord[]>('get_workspace_usage', { workspaceId, limit })
}

export async function getTaskUsage(taskId: string): Promise<UsageRecord[]> {
  return invoke<UsageRecord[]>('get_task_usage', { taskId })
}

export async function getWorkspaceUsageSummary(
  workspaceId: string,
): Promise<UsageSummary> {
  return invoke<UsageSummary>('get_workspace_usage_summary', { workspaceId })
}

export async function getTaskUsageSummary(taskId: string): Promise<UsageSummary> {
  return invoke<UsageSummary>('get_task_usage_summary', { taskId })
}

export async function clearWorkspaceUsage(workspaceId: string): Promise<void> {
  return invoke<void>('clear_workspace_usage', { workspaceId })
}
