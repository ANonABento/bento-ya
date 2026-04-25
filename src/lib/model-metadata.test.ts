import { describe, expect, it } from 'vitest'
import {
  canonicalModelId,
  formatModelLimit,
  formatModelPrice,
  getModelMetadata,
} from './model-metadata'

describe('model metadata', () => {
  it('looks up exact model ids', () => {
    const metadata = getModelMetadata('claude-sonnet-4-6-20260217', 'anthropic')

    expect(metadata.displayName).toBe('Claude Sonnet 4.6')
    expect(metadata.provider).toBe('anthropic')
  })

  it('resolves aliases to canonical model ids', () => {
    expect(canonicalModelId('sonnet', 'anthropic')).toBe('claude-sonnet-4-6-20260217')
    expect(canonicalModelId('opus', 'anthropic')).toBe('claude-opus-4-6-20260217')
    expect(canonicalModelId('haiku', 'anthropic')).toBe('claude-haiku-4-5-20251115')
  })

  it('returns fallback metadata for unknown model ids', () => {
    const metadata = getModelMetadata('custom-model', 'local')

    expect(metadata).toMatchObject({
      id: 'custom-model',
      provider: 'local',
      displayName: 'custom-model',
      contextWindow: null,
      inputCostPerMillion: null,
    })
  })

  it('formats price and limit fields without undefined output', () => {
    expect(formatModelPrice(null)).toBe('--')
    expect(formatModelPrice(0.8)).toBe('$0.80')
    expect(formatModelLimit(null)).toBe('--')
    expect(formatModelLimit(200_000)).toBe('200.0K')
  })
})
