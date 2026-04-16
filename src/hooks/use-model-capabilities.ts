/**
 * Hook for model capabilities — wraps useModels to provide the same interface
 * as the old CLI-detection-based hook. Consumers get capabilities from the
 * dynamic model registry now.
 */

import { useCallback, useMemo } from 'react'
import { useModels, type ModelEntry } from './use-models'

export type ModelId = 'opus' | 'sonnet' | 'haiku'

/** Legacy capability shape used by model-selector and chat-input */
export type ModelCapability = {
  id: string
  name: string
  description: string
  supportsExtendedContext: boolean
  contextWindow: string
  maxEffort: string
  available: boolean
}

type UseModelCapabilitiesResult = {
  models: ModelCapability[]
  getCapabilities: (modelId: string) => ModelCapability
  isDetecting: boolean
  isDetected: boolean
  cliVersion: string | null
  refresh: () => void
}

/** Convert a ModelEntry to the legacy ModelCapability shape */
function toCapability(entry: ModelEntry): ModelCapability {
  const effort = entry.tier === 'fast' ? 'low' : 'high'
  const description =
    entry.tier === 'flagship'
      ? 'Most powerful'
      : entry.tier === 'fast'
        ? 'Quick & light'
        : 'Fast & capable'

  return {
    id: entry.alias ?? entry.id,
    name: entry.displayName,
    description,
    supportsExtendedContext: entry.supportsExtendedContext,
    contextWindow: `${Math.round(entry.contextWindow / 1000)}k`,
    maxEffort: effort,
    available: true,
  }
}

const FALLBACK: ModelCapability = {
  id: 'sonnet',
  name: 'Sonnet',
  description: 'Fast & capable',
  supportsExtendedContext: false,
  contextWindow: '200k',
  maxEffort: 'high',
  available: true,
}

export function useModelCapabilities(
  _cliId: string = 'claude',
): UseModelCapabilitiesResult {
  const { models: entries, isLoading, lastFetched, refresh } = useModels('anthropic')

  const models = useMemo(() => entries.map(toCapability), [entries])

  const getCapabilities = useCallback(
    (modelId: string): ModelCapability =>
      models.find((m) => m.id === modelId) ?? FALLBACK,
    [models],
  )

  return useMemo(
    () => ({
      models,
      getCapabilities,
      isDetecting: isLoading,
      isDetected: !!lastFetched,
      cliVersion: null, // No longer relevant
      refresh: () => void refresh(),
    }),
    [models, getCapabilities, isLoading, lastFetched, refresh],
  )
}
