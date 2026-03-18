/**
 * Hook for auto-detecting model capabilities from the CLI backend.
 * Fetches capabilities on mount, falls back to hardcoded defaults.
 * Provides reactive helpers for UI controls.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { getCliCapabilities, type ModelCapability } from '@/lib/ipc'

export type { ModelCapability }

export type ModelId = 'opus' | 'sonnet' | 'haiku'

/** Hardcoded fallback capabilities (used when CLI detection fails) */
const FALLBACK_MODELS: ModelCapability[] = [
  { id: 'opus', name: 'Opus', description: 'Most powerful', supportsExtendedContext: true, contextWindow: '200k', maxEffort: 'high', available: true },
  { id: 'sonnet', name: 'Sonnet', description: 'Fast & capable', supportsExtendedContext: false, contextWindow: '200k', maxEffort: 'high', available: true },
  { id: 'haiku', name: 'Haiku', description: 'Quick & light', supportsExtendedContext: false, contextWindow: '200k', maxEffort: 'low', available: true },
]

type UseModelCapabilitiesResult = {
  /** All available models with their capabilities */
  models: ModelCapability[]
  /** Get capabilities for a specific model */
  getCapabilities: (modelId: string) => ModelCapability
  /** Whether detection is still running */
  isDetecting: boolean
  /** Whether detection succeeded (vs using fallbacks) */
  isDetected: boolean
  /** CLI version string if detected */
  cliVersion: string | null
  /** Re-run detection */
  refresh: () => void
}

export function useModelCapabilities(cliId: string = 'claude'): UseModelCapabilitiesResult {
  const [models, setModels] = useState<ModelCapability[]>(FALLBACK_MODELS)
  const [isDetecting, setIsDetecting] = useState(true)
  const [isDetected, setIsDetected] = useState(false)
  const [cliVersion, setCliVersion] = useState<string | null>(null)
  const hasRun = useRef(false)

  const detect = useCallback(async () => {
    setIsDetecting(true)
    try {
      const caps = await getCliCapabilities(cliId)
      if (caps.detected && caps.models.length > 0) {
        setModels(caps.models)
        setIsDetected(true)
        setCliVersion(caps.cliVersion)
      } else {
        // CLI not found, use fallbacks
        setModels(FALLBACK_MODELS)
        setIsDetected(false)
      }
    } catch {
      setModels(FALLBACK_MODELS)
      setIsDetected(false)
    } finally {
      setIsDetecting(false)
    }
  }, [cliId])

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true
    void detect()
  }, [detect])

  const getCapabilities = useCallback(
    (modelId: string): ModelCapability => {
      const fallback: ModelCapability = { id: 'sonnet', name: 'Sonnet', description: 'Fast & capable', supportsExtendedContext: false, contextWindow: '200k', maxEffort: 'high', available: true }
      return models.find((m) => m.id === modelId) ?? fallback
    },
    [models],
  )

  const refresh = useCallback(() => {
    hasRun.current = false
    void detect()
  }, [detect])

  return useMemo(
    () => ({ models, getCapabilities, isDetecting, isDetected, cliVersion, refresh }),
    [models, getCapabilities, isDetecting, isDetected, cliVersion, refresh],
  )
}
