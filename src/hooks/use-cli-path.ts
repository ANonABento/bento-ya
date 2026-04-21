/**
 * Hook for resolving CLI paths with auto-detection.
 * If configured paths are just binary names (not full paths),
 * attempts to detect the actual paths using the backend.
 */

import { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { detectSingleCli } from '@/lib/ipc'

type CliPathResult = {
  cliPath: string
  isDetecting: boolean
  detectionError: string | null
}

// Map provider IDs to CLI detection IDs
const PROVIDER_CLI_MAP: Record<string, string> = {
  anthropic: 'claude',
  openai: 'codex',
}

function persistDetectedCliPath(providerId: string, cliPath: string) {
  const { global, updateGlobal } = useSettingsStore.getState()
  const providers = global.model.providers.map((provider) =>
    provider.id === providerId ? { ...provider, cliPath } : provider
  )
  updateGlobal('model', { ...global.model, providers })
}

export function useCliPath(providerId: string = 'anthropic'): CliPathResult {
  const settings = useSettingsStore((s) => s.global)

  const provider = settings.model.providers.find((p) => p.id === providerId)
  const cliId = PROVIDER_CLI_MAP[providerId] || providerId
  const defaultBinary = cliId // e.g., 'claude' or 'codex'
  const configuredPath = provider?.cliPath || defaultBinary

  // Initialize with configured path, but track if we need detection
  const needsDetection = !configuredPath.includes('/')
  const [resolvedPath, setResolvedPath] = useState(configuredPath)
  const [isDetecting, setIsDetecting] = useState(needsDetection)
  const [detectionError, setDetectionError] = useState<string | null>(null)

  // Track if we've already detected to avoid re-running
  const hasDetected = useRef(false)

  useEffect(() => {
    setResolvedPath(configuredPath)
    setDetectionError(null)
    setIsDetecting(needsDetection)
  }, [configuredPath, needsDetection])

  useEffect(() => {
    // Reset detection state when provider changes
    hasDetected.current = false
  }, [providerId])

  useEffect(() => {
    // Only auto-detect if path is just a binary name (no slashes)
    if (configuredPath.includes('/')) {
      return
    }

    // Don't re-detect if we already tried
    if (hasDetected.current) return
    hasDetected.current = true
    let cancelled = false

    // Auto-detect the CLI path
    const detectPath = async () => {
      try {
        const detected = await detectSingleCli(cliId)
        if (detected.isAvailable && detected.path) {
          if (cancelled) return
          setResolvedPath(detected.path)
          persistDetectedCliPath(providerId, detected.path)
        } else {
          if (cancelled) return
          const cliName = cliId === 'claude' ? 'Claude' : cliId === 'codex' ? 'Codex' : cliId
          setDetectionError(`${cliName} CLI not found. Please install it or set the path in Settings > Agent.`)
          setResolvedPath(configuredPath) // Fallback to configured
        }
      } catch {
        if (cancelled) return
        setDetectionError(`Failed to detect ${cliId} CLI`)
        setResolvedPath(configuredPath)
      } finally {
        if (!cancelled) {
          setIsDetecting(false)
        }
      }
    }

    void detectPath()

    return () => {
      cancelled = true
    }
  }, [configuredPath, cliId, providerId])

  return {
    cliPath: resolvedPath,
    isDetecting,
    detectionError,
  }
}

/**
 * Hook to auto-detect all CLI paths on app startup.
 * Call this once at the app root to populate settings.
 */
export function useAutoDetectClis(): { isDetecting: boolean } {
  const providers = useSettingsStore((s) => s.global.model.providers)
  const [isDetecting, setIsDetecting] = useState(false)
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    const detectAll = async () => {
      setIsDetecting(true)

      for (const provider of providers) {
        const cliId = PROVIDER_CLI_MAP[provider.id]
        if (!cliId) continue

        // Skip if already has a full path
        if (provider.cliPath?.includes('/')) continue

        try {
          const detected = await detectSingleCli(cliId)
          if (detected.isAvailable && detected.path) {
            persistDetectedCliPath(provider.id, detected.path)
          }
        } catch {
          // Detection failure is non-critical - CLI may not be installed
        }
      }

      setIsDetecting(false)
    }

    void detectAll()
  }, [providers])

  return { isDetecting }
}
