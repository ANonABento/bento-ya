import { canonicalModelUsageKey, getModelMetadata } from '@/lib/model-metadata'
import type { ModelUsageSummary } from '@/lib/ipc/usage'

export const USAGE_BUDGET_WARNING_THRESHOLD = 0.8

export type UsageBudgetWarning = {
  key: string
  provider: string
  model: string
  displayName: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  budgetUsd: number
  percentage: number
}

export function todayLocalDateKey(date = new Date()): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function localDayBounds(date = new Date()): { startAt: string; endAt: string } {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  }
}

export function getModelBudgetKey(modelId: string, provider = 'unknown'): string {
  return canonicalModelUsageKey(modelId, provider)
}

export function buildUsageDismissKey(
  workspaceId: string,
  dateKey: string,
  warningKey: string,
): string {
  return `usage-budget-warning-dismissed:${workspaceId}:${dateKey}:${warningKey}`
}

export function findUsageBudgetWarnings(
  usage: ModelUsageSummary[],
  budgetsUsd: Record<string, number> | undefined,
): UsageBudgetWarning[] {
  const enabledBudgets = Object.entries(budgetsUsd ?? {}).filter(
    ([, budget]) => Number.isFinite(budget) && budget > 0,
  )

  if (enabledBudgets.length === 0) return []

  const budgetByKey = Object.fromEntries(enabledBudgets)
  const statsByKey = new Map<string, UsageBudgetWarning>()

  for (const entry of usage) {
    const key = getModelBudgetKey(entry.model, entry.provider)
    const budgetUsd = budgetByKey[key]
    if (!budgetUsd) continue

    const metadata = getModelMetadata(entry.model, entry.provider)
    const existing = statsByKey.get(key) ?? {
      key,
      provider: metadata.provider,
      model: metadata.id,
      displayName: metadata.displayName,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      budgetUsd,
      percentage: 0,
    }

    existing.inputTokens += entry.inputTokens
    existing.outputTokens += entry.outputTokens
    existing.totalTokens += entry.inputTokens + entry.outputTokens
    existing.costUsd += entry.costUsd
    existing.percentage = existing.costUsd / budgetUsd
    statsByKey.set(key, existing)
  }

  return Array.from(statsByKey.values())
    .filter((warning) => warning.percentage >= USAGE_BUDGET_WARNING_THRESHOLD)
    .sort((a, b) => b.percentage - a.percentage)
}
