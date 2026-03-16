/**
 * Hook for resolving CLI path with auto-detection.
 * If the configured path is just a binary name (not a full path),
 * attempts to detect the actual path using the backend.
 */

import { useState, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { detectSingleCli } from '@/lib/ipc'

export function useCliPath(): {
  cliPath: string
  isDetecting: boolean
  detectionError: string | null
} {
  const settings = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')
  const configuredPath = anthropicProvider?.cliPath || 'claude'

  const [resolvedPath, setResolvedPath] = useState(configuredPath)
  const [isDetecting, setIsDetecting] = useState(false)
  const [detectionError, setDetectionError] = useState<string | null>(null)

  useEffect(() => {
    // Only auto-detect if path is just a binary name (no slashes)
    if (configuredPath.includes('/')) {
      setResolvedPath(configuredPath)
      return
    }

    // Auto-detect the CLI path
    const detectPath = async () => {
      setIsDetecting(true)
      setDetectionError(null)
      try {
        const detected = await detectSingleCli('claude')
        if (detected.isAvailable && detected.path) {
          setResolvedPath(detected.path)
          // Also update settings so this persists
          const providers = settings.model.providers.map((p) =>
            p.id === 'anthropic' ? { ...p, cliPath: detected.path } : p
          )
          updateGlobal('model', { ...settings.model, providers })
          console.debug('[useCliPath] Auto-detected CLI path:', detected.path)
        } else {
          setDetectionError('Claude CLI not found. Please install it or set the path in Settings > Agent.')
          setResolvedPath(configuredPath) // Fallback to configured
        }
      } catch (err) {
        console.error('[useCliPath] Detection failed:', err)
        setDetectionError('Failed to detect Claude CLI')
        setResolvedPath(configuredPath)
      } finally {
        setIsDetecting(false)
      }
    }

    void detectPath()
  }, [configuredPath]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    cliPath: resolvedPath,
    isDetecting,
    detectionError,
  }
}
