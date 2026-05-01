import { describe, expect, it } from 'vitest'
import type { ModelUsageSummary } from '@/lib/ipc/usage'
import {
  buildUsageDismissKey,
  findUsageBudgetWarnings,
  getModelBudgetKey,
  localDayBounds,
  todayLocalDateKey,
} from './usage-budget'

function modelUsage(overrides: Partial<ModelUsageSummary>): ModelUsageSummary {
  return {
    provider: 'anthropic',
    model: 'sonnet',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.8,
    recordCount: 1,
    ...overrides,
  }
}

describe('usage-budget', () => {
  it('uses a stable local date key', () => {
    expect(todayLocalDateKey(new Date(2026, 4, 1, 9))).toBe('2026-05-01')
  })

  it('builds local day UTC bounds for IPC aggregation', () => {
    const bounds = localDayBounds(new Date(2026, 4, 1, 9))

    expect(new Date(bounds.startAt).getHours()).toBe(0)
    expect(new Date(bounds.endAt).getHours()).toBe(0)
    expect(new Date(bounds.endAt).getTime() - new Date(bounds.startAt).getTime()).toBe(86_400_000)
  })

  it('builds a workspace and model scoped dismiss key', () => {
    expect(buildUsageDismissKey('ws-1', '2026-05-01', 'anthropic:sonnet')).toBe(
      'usage-budget-warning-dismissed:ws-1:2026-05-01:anthropic:sonnet',
    )
  })

  it('aggregates aliases and returns warnings at the 80 percent threshold', () => {
    const key = getModelBudgetKey('claude-sonnet-4-6-20260217', 'anthropic')
    const warnings = findUsageBudgetWarnings(
      [
        modelUsage({ model: 'sonnet', costUsd: 0.35 }),
        modelUsage({
          model: 'claude-sonnet-4-6-20260217',
          costUsd: 0.45,
          inputTokens: 200,
        }),
      ],
      { [key]: 1 },
    )

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      key,
      displayName: 'Claude Sonnet 4.6',
      costUsd: 0.8,
      budgetUsd: 1,
      inputTokens: 300,
      outputTokens: 100,
      totalTokens: 400,
    })
  })

  it('ignores models without positive budgets', () => {
    const key = getModelBudgetKey('sonnet', 'anthropic')
    const warnings = findUsageBudgetWarnings(
      [
        modelUsage({ costUsd: 10 }),
        modelUsage({ model: 'haiku', costUsd: 10 }),
      ],
      { [key]: 0, [getModelBudgetKey('haiku', 'anthropic')]: 0 },
    )

    expect(warnings).toEqual([])
  })

  it('uses pre-aggregated model summaries without a row limit', () => {
    const key = getModelBudgetKey('sonnet', 'anthropic')
    const warnings = findUsageBudgetWarnings(
      [
        modelUsage({
          costUsd: 8,
          inputTokens: 1000,
          outputTokens: 2000,
          recordCount: 2500,
        }),
      ],
      { [key]: 10 },
    )

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      key,
      costUsd: 8,
      budgetUsd: 10,
      percentage: 0.8,
    })
  })
})
