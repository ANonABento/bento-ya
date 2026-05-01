import { describe, expect, it } from 'vitest'
import type { UsageRecord } from '@/lib/ipc/usage'
import { aggregateUsageByModel, buildModelUsageIndex } from './model-usage'

const usageRecord = (overrides: Partial<UsageRecord>): UsageRecord => ({
  id: 'usage-1',
  workspaceId: 'ws-1',
  taskId: null,
  sessionId: null,
  provider: 'anthropic',
  model: 'claude-sonnet-4-6-20260217',
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.01,
  columnName: null,
  durationSeconds: 0,
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
})

describe('model usage aggregation', () => {
  it('aggregates exact model ids to provider-scoped model keys', () => {
    const index = buildModelUsageIndex([
      { providerId: 'anthropic', id: 'claude-sonnet-4-6-20260217', alias: 'sonnet' },
    ])

    const usage = aggregateUsageByModel(
      [usageRecord({ model: 'claude-sonnet-4-6-20260217' })],
      index,
    )

    expect(usage['anthropic:claude-sonnet-4-6-20260217']).toMatchObject({
      calls: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      costUsd: 0.01,
    })
  })

  it('aggregates provider-scoped aliases to the canonical model row', () => {
    const index = buildModelUsageIndex([
      { providerId: 'anthropic', id: 'claude-sonnet-4-6-20260217', alias: 'sonnet' },
    ])

    const usage = aggregateUsageByModel([usageRecord({ model: 'sonnet' })], index)

    expect(usage['anthropic:claude-sonnet-4-6-20260217']?.calls).toBe(1)
  })

  it('does not resolve aliases across provider boundaries', () => {
    const index = buildModelUsageIndex([
      { providerId: 'anthropic', id: 'claude-sonnet-4-6-20260217', alias: 'sonnet' },
    ])

    const usage = aggregateUsageByModel(
      [usageRecord({ provider: 'openai', model: 'sonnet' })],
      index,
    )

    expect(usage['openai:sonnet']?.calls).toBe(1)
    expect(usage['anthropic:claude-sonnet-4-6-20260217']).toBeUndefined()
  })

  it('keeps unknown model ids provider-scoped', () => {
    const index = buildModelUsageIndex([])

    const usage = aggregateUsageByModel(
      [
        usageRecord({
          provider: 'openai',
          model: 'shared-model',
          inputTokens: 10,
          outputTokens: 5,
        }),
        usageRecord({
          provider: 'anthropic',
          model: 'shared-model',
          inputTokens: 20,
          outputTokens: 10,
        }),
      ],
      index,
    )

    expect(usage['openai:shared-model']?.totalTokens).toBe(15)
    expect(usage['anthropic:shared-model']?.totalTokens).toBe(30)
  })

  it('sums multiple records', () => {
    const index = buildModelUsageIndex([
      { providerId: 'anthropic', id: 'claude-sonnet-4-6-20260217', alias: 'sonnet' },
    ])

    const usage = aggregateUsageByModel(
      [
        usageRecord({
          id: 'usage-1',
          model: 'sonnet',
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.02,
        }),
        usageRecord({
          id: 'usage-2',
          model: 'claude-sonnet-4-6-20260217',
          inputTokens: 200,
          outputTokens: 150,
          costUsd: 0.03,
        }),
      ],
      index,
    )

    expect(usage['anthropic:claude-sonnet-4-6-20260217']).toEqual({
      calls: 2,
      inputTokens: 300,
      outputTokens: 200,
      totalTokens: 500,
      costUsd: 0.05,
    })
  })

  it('returns empty aggregation for empty records', () => {
    const index = buildModelUsageIndex([
      { providerId: 'anthropic', id: 'claude-sonnet-4-6-20260217', alias: 'sonnet' },
    ])

    expect(aggregateUsageByModel([], index)).toEqual({})
  })

  it('aggregates unknown records when the index is empty', () => {
    const usage = aggregateUsageByModel(
      [usageRecord({ provider: 'local', model: 'custom-model' })],
      buildModelUsageIndex([]),
    )

    expect(usage['local:custom-model']?.totalTokens).toBe(15)
  })
})
