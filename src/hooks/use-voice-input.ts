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

  // Check if voice is available
  const checkAvailability = useCallback(() => {
    isVoiceAvailable()
      .then((available) => { setIsAvailable(available) })
      .catch(() => { setIsAvailable(false) })
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
    if (!voiceConfig.enabled || !isAvailable) {
      setError('Voice input is not enabled or available')
      setState('error')
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

      const recorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      })

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
      const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' })
      const arrayBuffer = await audioBlob.arrayBuffer()
      const audioData = Array.from(new Uint8Array(arrayBuffer))

      // Save to temp file
      const audioPath = await saveAudioTemp(audioData)

      // Transcribe using selected model
      const result = await transcribeAudio(
        audioPath,
        voiceConfig.language || undefined,
        voiceConfig.model,
      )

      if (result.text) {
        onTranscript(result.text)
      }

      setState('idle')
      setDuration(0)
    } catch (err) {
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
