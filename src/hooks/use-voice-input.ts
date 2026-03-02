import { useState, useRef, useCallback, useEffect } from 'react'
import {
  isVoiceAvailable,
  transcribeAudio,
  onWhisperDownloadComplete,
  startNativeRecording,
  stopNativeRecording,
  cancelNativeRecording,
} from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settings-store'

export type VoiceInputState = 'idle' | 'recording' | 'processing' | 'error'

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceInputState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isAvailable, setIsAvailable] = useState(false)
  const [duration, setDuration] = useState(0)

  const timerRef = useRef<number | null>(null)
  const stateRef = useRef<VoiceInputState>(state)

  const voiceConfig = useSettingsStore((s) => s.global.voice)

  // Use refs to avoid stale closures in callbacks
  const voiceConfigRef = useRef(voiceConfig)
  const onTranscriptRef = useRef(onTranscript)

  // Keep refs updated
  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    voiceConfigRef.current = voiceConfig
    onTranscriptRef.current = onTranscript
  }, [voiceConfig, onTranscript])

  // Check if voice is available
  const checkAvailability = useCallback(() => {
    console.log('[Voice] Checking availability...')
    isVoiceAvailable()
      .then((available) => {
        console.log('[Voice] Backend availability:', available)
        setIsAvailable(available)
      })
      .catch((err) => {
        console.error('[Voice] Availability check failed:', err)
        setIsAvailable(false)
      })
  }, [])

  // Check on mount
  useEffect(() => {
    checkAvailability()
  }, [checkAvailability])

  // Re-check when a model is downloaded
  useEffect(() => {
    const unlisten = onWhisperDownloadComplete(() => {
      checkAvailability()
    })
    return () => {
      void unlisten.then((fn) => { fn() })
    }
  }, [checkAvailability])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [])

  const startRecording = useCallback(async () => {
    console.log('[Voice] Starting native recording...', { enabled: voiceConfig.enabled, available: isAvailable })
    if (!voiceConfig.enabled || !isAvailable) {
      setError('Voice input is not enabled or available')
      setState('error')
      stateRef.current = 'error'
      console.log('[Voice] Not available:', { enabled: voiceConfig.enabled, available: isAvailable })
      return
    }

    try {
      setError(null)
      setDuration(0)

      // Start native recording via Tauri command
      await startNativeRecording()
      console.log('[Voice] Native recording started')

      // Start duration timer
      timerRef.current = window.setInterval(() => {
        setDuration((d) => d + 1)
      }, 1000)

      setState('recording')
      stateRef.current = 'recording'
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[Voice] Failed to start recording:', message)
      setError(message)
      setState('error')
      stateRef.current = 'error'
    }
  }, [voiceConfig.enabled, isAvailable])

  const stopRecording = useCallback(async () => {
    console.log('[Voice] stopRecording called, stateRef:', stateRef.current)
    if (stateRef.current !== 'recording') {
      console.log('[Voice] Not recording, ignoring stop')
      return
    }

    try {
      // Stop the timer
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }

      setState('processing')

      // Stop native recording and get the audio file path
      console.log('[Voice] Stopping native recording...')
      const audioPath = await stopNativeRecording()
      console.log('[Voice] Recording saved to:', audioPath)

      // Use ref to get current config (avoids stale closure)
      const config = voiceConfigRef.current
      if (!config) {
        throw new Error('Voice config not available')
      }

      // Transcribe the audio
      console.log('[Voice] Transcribing with model:', config.model)
      const result = await transcribeAudio(
        audioPath,
        config.language || undefined,
        config.model,
      )
      console.log('[Voice] Transcription result:', result)

      if (result && result.text) {
        onTranscriptRef.current(result.text)
      }

      setState('idle')
      setDuration(0)
    } catch (err) {
      console.error('[Voice] Transcription error:', err)
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setState('error')
    }
  }, [])

  const cancelRecording = useCallback(async () => {
    if (stateRef.current !== 'recording') {
      setState('idle')
      setDuration(0)
      return
    }

    try {
      // Stop the timer
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }

      // Cancel native recording
      await cancelNativeRecording()
      console.log('[Voice] Recording cancelled')

      setState('idle')
      setDuration(0)
    } catch (err) {
      console.error('[Voice] Failed to cancel recording:', err)
      setState('idle')
      setDuration(0)
    }
  }, [])

  return {
    state,
    error,
    duration,
    isAvailable: isAvailable && voiceConfig.enabled,
    isApiAvailable: isAvailable,
    isEnabled: voiceConfig.enabled,
    startRecording,
    stopRecording,
    cancelRecording,
  }
}
