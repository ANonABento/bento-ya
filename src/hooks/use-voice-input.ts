import { useState, useRef, useCallback, useEffect } from 'react'
import {
  isVoiceAvailable,
  onWhisperDownloadComplete,
  startNativeRecording,
  cancelNativeRecording,
  transcribeRecordingChunk,
  transcribeAllRecording,
} from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settings-store'

export type VoiceInputState = 'idle' | 'recording' | 'processing' | 'error'

const CHUNK_INTERVAL_MS = 1000 // Transcribe every 1 second for snappy feedback

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceInputState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isAvailable, setIsAvailable] = useState(false)
  const [duration, setDuration] = useState(0)
  const [liveText, setLiveText] = useState('') // Accumulated live transcription

  const timerRef = useRef<number | null>(null)
  const chunkIntervalRef = useRef<number | null>(null)
  const stateRef = useRef<VoiceInputState>(state)
  const accumulatedTextRef = useRef<string>('')

  const voiceConfig = useSettingsStore((s) => s.global.voice)
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

  useEffect(() => {
    checkAvailability()
  }, [checkAvailability])

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
      if (timerRef.current) clearInterval(timerRef.current)
      if (chunkIntervalRef.current) clearInterval(chunkIntervalRef.current)
    }
  }, [])

  // Transcribe a chunk while recording
  const transcribeChunk = useCallback(async () => {
    if (stateRef.current !== 'recording') return

    try {
      const config = voiceConfigRef.current
      const result = await transcribeRecordingChunk(
        config.language || undefined,
        config.model,
      )

      if (result.text && result.text.trim()) {
        console.log('[Voice] Chunk transcribed:', result.text)
        // Append to accumulated text
        const newText = accumulatedTextRef.current
          ? accumulatedTextRef.current + ' ' + result.text.trim()
          : result.text.trim()
        accumulatedTextRef.current = newText
        setLiveText(newText)
        // Send to parent immediately for live updates
        onTranscriptRef.current(newText)
      }
    } catch (err) {
      console.error('[Voice] Chunk transcription error:', err)
      // Don't stop on chunk errors, just log
    }
  }, [])

  const startRecording = useCallback(async () => {
    console.log('[Voice] Starting streaming recording...', {
      enabled: voiceConfig.enabled,
      available: isAvailable
    })

    if (!voiceConfig.enabled || !isAvailable) {
      setError('Voice input is not enabled or available')
      setState('error')
      stateRef.current = 'error'
      return
    }

    try {
      setError(null)
      setDuration(0)
      setLiveText('')
      accumulatedTextRef.current = ''

      // Start native recording
      await startNativeRecording()
      console.log('[Voice] Native recording started')

      setState('recording')
      stateRef.current = 'recording'

      // Start duration timer
      timerRef.current = window.setInterval(() => {
        setDuration((d) => d + 1)
      }, 1000)

      // Start chunk transcription interval
      chunkIntervalRef.current = window.setInterval(() => {
        void transcribeChunk()
      }, CHUNK_INTERVAL_MS)

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[Voice] Failed to start recording:', message)
      setError(message)
      setState('error')
      stateRef.current = 'error'
    }
  }, [voiceConfig.enabled, isAvailable, transcribeChunk])

  const stopRecording = useCallback(async () => {
    console.log('[Voice] stopRecording called, stateRef:', stateRef.current)
    if (stateRef.current !== 'recording') {
      return
    }

    // Stop timers immediately
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current)
      chunkIntervalRef.current = null
    }

    setState('processing')
    stateRef.current = 'processing'

    try {
      // Stop and do final transcription of ALL audio
      const config = voiceConfigRef.current
      console.log('[Voice] Stopping and doing final transcription...')

      const result = await transcribeAllRecording(
        config.language || undefined,
        config.model,
      )

      console.log('[Voice] Final transcription:', result.text)

      // Use the final full transcription (more accurate than chunks)
      if (result.text && result.text.trim()) {
        onTranscriptRef.current(result.text.trim())
      }

      setState('idle')
      stateRef.current = 'idle'
      setDuration(0)
      setLiveText('')
      accumulatedTextRef.current = ''

    } catch (err) {
      console.error('[Voice] Stop/transcription error:', err)
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setState('error')
      stateRef.current = 'error'
    }
  }, [])

  const cancelRecording = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current)
      chunkIntervalRef.current = null
    }

    try {
      await cancelNativeRecording()
      console.log('[Voice] Recording cancelled')
    } catch (err) {
      console.error('[Voice] Failed to cancel recording:', err)
    }

    setState('idle')
    stateRef.current = 'idle'
    setDuration(0)
    setLiveText('')
    accumulatedTextRef.current = ''
  }, [])

  return {
    state,
    error,
    duration,
    liveText, // Live transcription text while recording
    isAvailable: isAvailable && voiceConfig.enabled,
    isApiAvailable: isAvailable,
    isEnabled: voiceConfig.enabled,
    startRecording,
    stopRecording,
    cancelRecording,
  }
}
