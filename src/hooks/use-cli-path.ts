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

export function useCliPath(providerId: string = 'anthropic'): CliPathResult {
  const settings = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)

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
    // Reset detection state when provider changes
    hasDetected.current = false
  }, [providerId])

  // Sync resolvedPath when configuredPath changes (e.g., after detection updates settings)
  useEffect(() => {
    if (configuredPath.includes('/')) {
      setResolvedPath(configuredPath)
      setDetectionError(null)
      setIsDetecting(false)
    }
  }, [configuredPath])

  useEffect(() => {
    // Only auto-detect if path is just a binary name (no slashes)
    if (configuredPath.includes('/')) {
      return
    }

    // Don't re-detect if we already tried
    if (hasDetected.current) return
    hasDetected.current = true

    // Auto-detect the CLI path
    const detectPath = async () => {
      setIsDetecting(true)
      setDetectionError(null)
      try {
        const detected = await detectSingleCli(cliId)
        if (detected.isAvailable && detected.path) {
          setResolvedPath(detected.path)
          // Also update settings so this persists
          const providers = settings.model.providers.map((p) =>
            p.id === providerId ? { ...p, cliPath: detected.path } : p
          )
          updateGlobal('model', { ...settings.model, providers })
        } else {
          const cliName = cliId === 'claude' ? 'Claude' : cliId === 'codex' ? 'Codex' : cliId
          setDetectionError(`${cliName} CLI not found. Please install it or set the path in Settings > Agent.`)
          setResolvedPath(configuredPath) // Fallback to configured
        }
      } catch {
        setDetectionError(`Failed to detect ${cliId} CLI`)
        setResolvedPath(configuredPath)
      } finally {
        setIsDetecting(false)
      }
    }

    void detectPath()
  }, [configuredPath, cliId, providerId]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const settings = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)
  const [isDetecting, setIsDetecting] = useState(false)
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    const detectAll = async () => {
      setIsDetecting(true)
      const updates: Array<{ providerId: string; path: string }> = []

      for (const provider of settings.model.providers) {
        const cliId = PROVIDER_CLI_MAP[provider.id]
        if (!cliId) continue

        // Skip if already has a full path
        if (provider.cliPath?.includes('/')) continue

        try {
          const detected = await detectSingleCli(cliId)
          if (detected.isAvailable && detected.path) {
            updates.push({ providerId: provider.id, path: detected.path })
          }
        } catch {
          // Detection failure is non-critical - CLI may not be installed
        }
      }

      // Batch update all detected paths
      if (updates.length > 0) {
        const providers = settings.model.providers.map((p) => {
          const update = updates.find((u) => u.providerId === p.id)
          return update ? { ...p, cliPath: update.path } : p
        })
        updateGlobal('model', { ...settings.model, providers })
      }

      setIsDetecting(false)
    }

    void detectAll()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { isDetecting }
}
