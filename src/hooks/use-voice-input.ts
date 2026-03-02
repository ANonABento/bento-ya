import { useState, useRef, useCallback, useEffect } from 'react'
import { isVoiceAvailable, saveAudioTemp, transcribeAudio, onWhisperDownloadComplete } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settings-store'

export type VoiceInputState = 'idle' | 'recording' | 'processing' | 'error'

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceInputState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isAvailable, setIsAvailable] = useState(false)
  const [duration, setDuration] = useState(0)

  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const audioChunks = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const voiceConfig = useSettingsStore((s) => s.global.voice)

  // Use refs to avoid stale closures in callbacks
  const voiceConfigRef = useRef(voiceConfig)
  const onTranscriptRef = useRef(onTranscript)

  // Keep refs updated
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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => { track.stop() })
      }
    }
  }, [])

  const startRecording = useCallback(async () => {
    console.log('[Voice] Starting recording...', { enabled: voiceConfig.enabled, available: isAvailable })
    if (!voiceConfig.enabled || !isAvailable) {
      setError('Voice input is not enabled or available')
      setState('error')
      console.log('[Voice] Not available:', { enabled: voiceConfig.enabled, available: isAvailable })
      return
    }

    try {
      setError(null)
      audioChunks.current = []
      setDuration(0)

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      })

      streamRef.current = stream

      // Try to use webm/opus, fallback to default if not supported
      let mimeType = 'audio/webm;codecs=opus'
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        console.log('[Voice] webm/opus not supported, trying webm')
        mimeType = 'audio/webm'
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          console.log('[Voice] webm not supported, using default')
          mimeType = ''
        }
      }
      console.log('[Voice] Using mimeType:', mimeType || 'default')

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.current.push(e.data)
        }
      }

      recorder.onstop = async () => {
        // Stop the timer
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }

        // Stop the stream
        stream.getTracks().forEach((track) => { track.stop() })
        streamRef.current = null

        // Process the audio
        if (audioChunks.current.length > 0) {
          setState('processing')
          await processAudio()
        } else {
          setState('idle')
        }
      }

      mediaRecorder.current = recorder
      recorder.start(100) // Collect data every 100ms

      // Start duration timer
      timerRef.current = window.setInterval(() => {
        setDuration((d) => d + 1)
      }, 1000)

      setState('recording')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start recording'
      setError(message)
      setState('error')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceConfig.enabled, isAvailable])

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current && state === 'recording') {
      mediaRecorder.current.stop()
    }
  }, [state])

  const cancelRecording = useCallback(() => {
    if (mediaRecorder.current && state === 'recording') {
      // Clear chunks before stopping to prevent processing
      audioChunks.current = []
      mediaRecorder.current.stop()
    }
    setState('idle')
    setDuration(0)
  }, [state])

  const processAudio = async () => {
    try {
      console.log('[Voice] Processing audio...')
      const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' })
      const arrayBuffer = await audioBlob.arrayBuffer()
      const audioData = Array.from(new Uint8Array(arrayBuffer))
      console.log('[Voice] Audio size:', audioData.length, 'bytes')

      // Save to temp file
      const audioPath = await saveAudioTemp(audioData)
      console.log('[Voice] Saved to:', audioPath)

      // Use ref to get current config (avoids stale closure)
      const config = voiceConfigRef.current
      console.log('[Voice] Transcribing with model:', config.model)
      const result = await transcribeAudio(
        audioPath,
        config.language || undefined,
        config.model,
      )
      console.log('[Voice] Transcription result:', result)

      if (result.text) {
        onTranscriptRef.current(result.text)
      }

      setState('idle')
      setDuration(0)
    } catch (err) {
      console.error('[Voice] Transcription error:', err)
      const message = err instanceof Error ? err.message : 'Transcription failed'
      setError(message)
      setState('error')
    }
  }

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
