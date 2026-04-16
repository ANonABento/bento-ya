/**
 * Hook for fetching available models from the dynamic model registry.
 * Replaces hardcoded model lists — models are fetched from provider APIs
 * and cached locally. New models appear automatically.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  getAvailableModels,
  onModelsUpdated,
  refreshModels,
  type ModelEntry,
  type ModelSource,
  type ModelsCache,
} from '@/lib/ipc'

export type { ModelEntry, ModelSource }

export type RefreshResult = {
  success: boolean
  modelCount: number
  newModels: string[]
  error?: string
}

type UseModelsResult = {
  /** All available models (optionally filtered by provider) */
  models: ModelEntry[]
  /** Whether the initial load is in progress */
  isLoading: boolean
  /** ISO timestamp of last successful fetch */
  lastFetched: string | null
  /** How the model list was obtained: 'api', 'cli', or 'built-in' */
  source: ModelSource
  /** Force refresh — returns summary of what changed */
  refresh: () => Promise<RefreshResult>
  /** Get a specific model by alias or full ID */
  getModel: (aliasOrId: string) => ModelEntry | undefined
}

export function useModels(provider?: string): UseModelsResult {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [lastFetched, setLastFetched] = useState<string | null>(null)
  const [source, setSource] = useState<ModelSource>('built-in')
  const hasRun = useRef(false)

  const applyCache = useCallback(
    (cache: ModelsCache) => {
      let filtered = cache.models
      if (provider) {
        filtered = filtered.filter((m) => m.provider === provider)
      }
      setModels(filtered)
      setLastFetched(cache.lastFetched || null)
      setSource(cache.source ?? 'built-in')
    },
    [provider],
  )

  // Initial load
  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    void (async () => {
      try {
        const cache = await getAvailableModels(provider)
        applyCache(cache)
      } catch (err) {
        console.error('Failed to load models:', err)
      } finally {
        setIsLoading(false)
      }
    })()
  }, [provider, applyCache])

  // Listen for background refresh events
  useEffect(() => {
    let unlisten: (() => void) | undefined

    void onModelsUpdated((cache) => {
      applyCache(cache)
    }).then((fn) => {
      unlisten = fn
    })

    return () => unlisten?.()
  }, [applyCache])

  const refresh = useCallback(async (): Promise<RefreshResult> => {
    const previousIds = new Set(models.map((m) => m.id))
    setIsLoading(true)
    try {
      const cache = await refreshModels()
      applyCache(cache)
      const newModels = cache.models
        .filter((m) => !previousIds.has(m.id))
        .map((m) => m.displayName)
      return {
        success: true,
        modelCount: cache.models.length,
        newModels,
      }
    } catch (err) {
      console.error('Failed to refresh models:', err)
      return {
        success: false,
        modelCount: models.length,
        newModels: [],
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    } finally {
      setIsLoading(false)
    }
  }, [applyCache, models])

  const getModel = useCallback(
    (aliasOrId: string) =>
      models.find((m) => m.alias === aliasOrId || m.id === aliasOrId),
    [models],
  )

  return useMemo(
    () => ({ models, isLoading, lastFetched, source, refresh, getModel }),
    [models, isLoading, lastFetched, source, refresh, getModel],
  )
}
