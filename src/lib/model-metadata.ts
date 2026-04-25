import { formatPricePerMillion, formatTokenLimit } from '@/lib/usage-format'

export type ModelTier = 'fast' | 'balanced' | 'powerful' | 'reasoning'

export type ModelMetadata = {
  id: string
  provider: 'anthropic' | 'openai' | string
  displayName: string
  aliases?: string[]
  tier: ModelTier
  contextWindow: number | null
  maxOutputTokens: number | null
  inputCostPerMillion: number | null
  outputCostPerMillion: number | null
  capabilities: string[]
}

const MODEL_METADATA: ModelMetadata[] = [
  {
    id: 'claude-haiku-4-5-20251115',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    aliases: ['haiku'],
    tier: 'fast',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    inputCostPerMillion: 0.8,
    outputCostPerMillion: 4,
    capabilities: ['code', 'tools', 'vision'],
  },
  {
    id: 'claude-sonnet-4-6-20260217',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    aliases: ['sonnet'],
    tier: 'balanced',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    capabilities: ['code', 'tools', 'vision', 'reasoning'],
  },
  {
    id: 'claude-opus-4-6-20260217',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.6',
    aliases: ['opus'],
    tier: 'powerful',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    inputCostPerMillion: 15,
    outputCostPerMillion: 75,
    capabilities: ['code', 'tools', 'vision', 'reasoning'],
  },
  {
    id: 'codex-5.2',
    provider: 'openai',
    displayName: 'Codex 5.2',
    tier: 'balanced',
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    inputCostPerMillion: null,
    outputCostPerMillion: null,
    capabilities: ['code', 'tools'],
  },
  {
    id: 'codex-5.3',
    provider: 'openai',
    displayName: 'Codex 5.3',
    tier: 'reasoning',
    contextWindow: 256_000,
    maxOutputTokens: 64_000,
    inputCostPerMillion: null,
    outputCostPerMillion: null,
    capabilities: ['code', 'tools', 'reasoning'],
  },
  {
    id: 'codex-5.3-spark',
    provider: 'openai',
    displayName: 'Codex 5.3 Spark',
    tier: 'fast',
    contextWindow: 128_000,
    maxOutputTokens: 32_000,
    inputCostPerMillion: null,
    outputCostPerMillion: null,
    capabilities: ['code', 'tools'],
  },
]

const exactLookup = new Map(MODEL_METADATA.map((metadata) => [metadata.id, metadata]))
const aliasLookup = new Map(
  MODEL_METADATA.flatMap((metadata) =>
    (metadata.aliases ?? []).map((alias) => [`${metadata.provider}:${alias}`, metadata] as const),
  ),
)

export function getKnownModelMetadata(): ModelMetadata[] {
  return MODEL_METADATA
}

export function getModelMetadata(modelId: string, provider = 'unknown'): ModelMetadata {
  return (
    exactLookup.get(modelId) ??
    aliasLookup.get(`${provider}:${modelId}`) ??
    aliasLookup.get(`anthropic:${modelId}`) ??
    createFallbackMetadata(modelId, provider)
  )
}

export function canonicalModelId(modelId: string, provider = 'unknown'): string {
  return getModelMetadata(modelId, provider).id
}

export function formatModelPrice(value: number | null): string {
  return formatPricePerMillion(value)
}

export function formatModelLimit(value: number | null): string {
  return formatTokenLimit(value)
}

function createFallbackMetadata(modelId: string, provider: string): ModelMetadata {
  return {
    id: modelId,
    provider,
    displayName: modelId,
    tier: 'balanced',
    contextWindow: null,
    maxOutputTokens: null,
    inputCostPerMillion: null,
    outputCostPerMillion: null,
    capabilities: [],
  }
}
