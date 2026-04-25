import { canonicalModelUsageKey } from '@/lib/model-metadata'
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

export function aggregateUsageByModel(records: UsageRecord[]): Record<string, ModelUsageStats> {
  return records.reduce<Record<string, ModelUsageStats>>((stats, record) => {
    const usageKey = canonicalModelUsageKey(record.model, record.provider)
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
