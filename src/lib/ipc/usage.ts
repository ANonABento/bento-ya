import { invoke } from './invoke'

// ─── Usage tracking commands ─────────────────────────────────────────────────

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
  columnName: string | null
  durationSeconds: number
  createdAt: string
}

export type UsageSummary = {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  recordCount: number
}

export async function recordUsage(
  workspaceId: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  taskId?: string,
  sessionId?: string,
  columnName?: string,
  durationSeconds?: number,
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
    columnName,
    durationSeconds,
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
  return invoke('clear_workspace_usage', { workspaceId })
}

export type DailyCost = {
  date: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  recordCount: number
}

export type ColumnCost = {
  columnName: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  recordCount: number
}

export type TaskCost = {
  taskId: string
  taskTitle: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  recordCount: number
}

export async function getWorkspaceDailyCosts(
  workspaceId: string,
  days?: number,
): Promise<DailyCost[]> {
  return invoke<DailyCost[]>('get_workspace_daily_costs', { workspaceId, days })
}

export async function getWorkspaceColumnCosts(workspaceId: string): Promise<ColumnCost[]> {
  return invoke<ColumnCost[]>('get_workspace_column_costs', { workspaceId })
}

export async function getWorkspaceTaskCosts(
  workspaceId: string,
  limit?: number,
): Promise<TaskCost[]> {
  return invoke<TaskCost[]>('get_workspace_task_costs', { workspaceId, limit })
}
