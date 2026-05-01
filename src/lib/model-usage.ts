import type { UsageRecord } from '@/lib/ipc/usage'

export type ModelUsageStats = {
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
}

export const EMPTY_USAGE_STATS: ModelUsageStats = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
}

export type ComparableUsageModel = {
  providerId: string
  id: string
  alias: string | null
}

export type ModelUsageIndex = {
  exact: Map<string, string>
  alias: Map<string, string>
}

export function modelUsageKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

export function buildModelUsageIndex(models: ComparableUsageModel[]): ModelUsageIndex {
  const exact = new Map<string, string>()
  const alias = new Map<string, string>()

  for (const model of models) {
    const usageKey = modelUsageKey(model.providerId, model.id)
    exact.set(usageKey, usageKey)

    if (model.alias) {
      alias.set(modelUsageKey(model.providerId, model.alias), usageKey)
    }
  }

  return { exact, alias }
}

export function aggregateUsageByModel(
  records: UsageRecord[],
  index: ModelUsageIndex,
): Record<string, ModelUsageStats> {
  return records.reduce<Record<string, ModelUsageStats>>((stats, record) => {
    const recordKey = modelUsageKey(record.provider, record.model)
    const usageKey = index.exact.get(recordKey) ?? index.alias.get(recordKey) ?? recordKey
    const existing = stats[usageKey] ?? { ...EMPTY_USAGE_STATS }
    existing.calls += 1
    existing.inputTokens += record.inputTokens
    existing.outputTokens += record.outputTokens
    existing.totalTokens += record.inputTokens + record.outputTokens
    existing.costUsd += record.costUsd
    stats[usageKey] = existing
    return stats
  }, {})
}
