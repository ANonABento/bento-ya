import { describe, expect, it } from 'vitest'
import type { UsageRecord } from '@/lib/ipc/usage'
import { aggregateUsageByModel, buildModelUsageIndex } from './model-usage'

const record = (overrides: Partial<UsageRecord>): UsageRecord => ({
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
  it('aggregates exact model IDs under provider-scoped canonical keys', () => {
    const index = buildModelUsageIndex([
      { providerId: 'anthropic', id: 'claude-sonnet-4-6-20260217', alias: 'sonnet' },
    ])

    const usage = aggregateUsageByModel([
      record({ inputTokens: 100, outputTokens: 50, costUsd: 0.03 }),
    ], index)

    expect(usage['anthropic:claude-sonnet-4-6-20260217']).toMatchObject({
      calls: 1,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      costUsd: 0.03,
    })
  })

  it('maps provider-scoped aliases to the canonical model row', () => {
    const index = buildModelUsageIndex([
      { providerId: 'anthropic', id: 'claude-sonnet-4-6-20260217', alias: 'sonnet' },
    ])

    const usage = aggregateUsageByModel([
      record({ model: 'sonnet' }),
    ], index)

    expect(usage['anthropic:claude-sonnet-4-6-20260217']?.calls).toBe(1)
  })

  it('prefers exact IDs over aliases when both could match', () => {
    const index = buildModelUsageIndex([
      { providerId: 'anthropic', id: 'shared-name', alias: null },
      { providerId: 'anthropic', id: 'canonical-other', alias: 'shared-name' },
    ])

    const usage = aggregateUsageByModel([
      record({ model: 'shared-name' }),
    ], index)

    expect(usage['anthropic:shared-name']?.calls).toBe(1)
    expect(usage['anthropic:canonical-other']).toBeUndefined()
  })

  it('does not resolve aliases across provider boundaries', () => {
    const index = buildModelUsageIndex([
      { providerId: 'anthropic', id: 'claude-sonnet-4-6-20260217', alias: 'sonnet' },
    ])

    const usage = aggregateUsageByModel([
      record({ provider: 'openai', model: 'sonnet' }),
    ], index)

    expect(usage['openai:sonnet']?.calls).toBe(1)
    expect(usage['anthropic:claude-sonnet-4-6-20260217']).toBeUndefined()
  })

  it('keeps identical unknown model IDs separate by provider', () => {
    const index = buildModelUsageIndex([])

    const usage = aggregateUsageByModel([
      record({ id: 'usage-1', provider: 'openai', model: 'shared-model', inputTokens: 10, outputTokens: 5 }),
      record({ id: 'usage-2', provider: 'anthropic', model: 'shared-model', inputTokens: 20, outputTokens: 10 }),
    ], index)

    expect(usage['openai:shared-model']?.totalTokens).toBe(15)
    expect(usage['anthropic:shared-model']?.totalTokens).toBe(30)
  })

  it('sums multiple records for calls, tokens, and cost', () => {
    const index = buildModelUsageIndex([
      { providerId: 'anthropic', id: 'claude-sonnet-4-6-20260217', alias: 'sonnet' },
    ])

    const usage = aggregateUsageByModel([
      record({ id: 'usage-1', model: 'sonnet', inputTokens: 100, outputTokens: 50, costUsd: 0.01 }),
      record({
        id: 'usage-2',
        model: 'claude-sonnet-4-6-20260217',
        inputTokens: 25,
        outputTokens: 75,
        costUsd: 0.02,
      }),
    ], index)

    expect(usage['anthropic:claude-sonnet-4-6-20260217']).toMatchObject({
      calls: 2,
      inputTokens: 125,
      outputTokens: 125,
      totalTokens: 250,
      costUsd: 0.03,
    })
  })

  it('returns an empty aggregation for empty records', () => {
    expect(aggregateUsageByModel([], buildModelUsageIndex([]))).toEqual({})
  })

  it('aggregates unknown records with an empty model index', () => {
    const usage = aggregateUsageByModel([
      record({ provider: 'openai', model: 'codex-latest' }),
    ], buildModelUsageIndex([]))

    expect(usage['openai:codex-latest']?.calls).toBe(1)
  })
})
