import { invoke, listen, type UnlistenFn } from './invoke'

// ─── Dynamic Model Registry ──────────────────────────────────────────────────

export type ModelTier = 'flagship' | 'standard' | 'fast'

export type ModelEntry = {
  id: string
  displayName: string
  provider: string
  alias: string | null
  tier: ModelTier
  contextWindow: number
  supportsExtendedContext: boolean
  maxOutputTokens: number
  inputCostPerM: number | null
  outputCostPerM: number | null
  capabilities: string[]
  isNew: boolean
  createdAt: string | null
}

export type ModelSource = 'api' | 'cli' | 'built-in'

export type ModelsCache = {
  lastFetched: string
  source: ModelSource
  models: ModelEntry[]
}

export async function getAvailableModels(
  provider?: string,
  forceRefresh = false,
): Promise<ModelsCache> {
  return invoke<ModelsCache>('get_available_models', {
    provider: provider ?? null,
    forceRefresh,
  })
}

export async function refreshModels(): Promise<ModelsCache> {
  return invoke<ModelsCache>('refresh_models')
}

export function onModelsUpdated(
  callback: (cache: ModelsCache) => void,
): Promise<UnlistenFn> {
  return listen<ModelsCache>('models:updated', callback)
}
