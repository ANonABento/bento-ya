import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { resolveKaitenCodeTaskPolicy } from './ai-task-router'

describe('resolveKaitenCodeTaskPolicy', () => {
  it('maps column trigger generation to its task-specific model and fallback', () => {
    const policy = resolveKaitenCodeTaskPolicy(DEFAULT_SETTINGS, 'kaitencode.column_trigger_generation')

    expect(policy.taskId).toBe('kaitencode.column_trigger_generation')
    expect(policy.providerId).toBe('anthropic')
    expect(policy.model).toBe('claude-haiku-4-5-20251115')
    expect(policy.fallbackModels).toEqual(['claude-sonnet-4-6-20260217'])
    expect(policy.timeoutMs).toBe(DEFAULT_SETTINGS.advanced.messageTimeoutSeconds * 1000)
  })

  it('honors an explicit requested model for chat-like tasks', () => {
    const policy = resolveKaitenCodeTaskPolicy(DEFAULT_SETTINGS, 'kaitencode.orchestrator_chat', 'opus')

    expect(policy.model).toBe('claude-opus-4-6-20260217')
    expect(policy.fallbackModels).toEqual(['claude-haiku-4-5-20251115'])
  })

  it('carries through budget keys from existing model settings', () => {
    const budgetKey = 'anthropic:claude-haiku-4-5-20251115'
    const settings = {
      ...DEFAULT_SETTINGS,
      model: {
        ...DEFAULT_SETTINGS.model,
        dailyBudgetsUsd: { [budgetKey]: 3 },
      },
    }

    const policy = resolveKaitenCodeTaskPolicy(settings, 'kaitencode.column_trigger_generation')

    expect(policy.budgetKey).toBe(budgetKey)
    expect(policy.maxRequestCostUsd).toBe(3)
  })
})
