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

export type WorkspaceCostSummary = {
  workspaceId: string
  workspaceName: string
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  recordCount: number
}

export type ColumnCostSummary = {
  workspaceId: string
  workspaceName: string
  columnName: string
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  recordCount: number
}

export type TaskCostSummary = {
  taskId: string | null
  taskTitle: string
  workspaceId: string
  workspaceName: string
  columnName: string
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  recordCount: number
}

export type DailyCostSummary = {
  date: string
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  recordCount: number
}

export type CostDashboard = {
  total: UsageSummary
  workspaces: WorkspaceCostSummary[]
  columns: ColumnCostSummary[]
  topTasks: TaskCostSummary[]
  daily: DailyCostSummary[]
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

export async function getCostDashboard(): Promise<CostDashboard> {
  return invoke<CostDashboard>('get_cost_dashboard')
}
