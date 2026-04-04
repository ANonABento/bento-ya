import { invoke, listen, type EventCallback, type UnlistenFn } from './invoke'

// ─── Voice commands ─────────────────────────────────────────────────────────

export type TranscriptionResult = {
  text: string
  durationMs: number
  modelUsed?: string
}

export type WhisperModelStatus = 'available' | 'downloading' | 'downloaded' | 'error'

export type WhisperModelInfo = {
  model: string
  status: WhisperModelStatus
  sizeDisplay: string
  sizeBytes: number
  description: string
  path: string | null
}

export type WhisperDownloadProgress = {
  model: string
  downloadedBytes: number
  totalBytes: number
  percent: number
}

export async function isVoiceAvailable(): Promise<boolean> {
  return invoke<boolean>('is_voice_available')
}

export async function saveAudioTemp(audioData: number[]): Promise<string> {
  return invoke<string>('save_audio_temp', { audioData })
}

export async function transcribeAudio(
  audioPath: string,
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>('transcribe_audio', { audioPath, language, model })
}

export async function listWhisperModels(): Promise<WhisperModelInfo[]> {
  return invoke<WhisperModelInfo[]>('list_whisper_models')
}

export async function downloadWhisperModel(model: string): Promise<string> {
  return invoke<string>('download_whisper_model', { model })
}

export async function deleteWhisperModel(model: string): Promise<void> {
  return invoke('delete_whisper_model', { model })
}

export async function getWhisperModelInfo(model: string): Promise<WhisperModelInfo> {
  return invoke<WhisperModelInfo>('get_whisper_model_info', { model })
}

export function onWhisperDownloadProgress(
  cb: EventCallback<WhisperDownloadProgress>
): Promise<UnlistenFn> {
  return listen<WhisperDownloadProgress>('whisper:download-progress', cb)
}

export function onWhisperDownloadComplete(
  cb: EventCallback<{ model: string }>
): Promise<UnlistenFn> {
  return listen<{ model: string }>('whisper:download-complete', cb)
}

// ─── Native Audio Recording (bypasses webview limitations) ──────────────────

export async function startNativeRecording(): Promise<void> {
  return invoke('start_native_recording')
}

export async function stopNativeRecording(): Promise<void> {
  return invoke('stop_native_recording')
}

export async function cancelNativeRecording(): Promise<void> {
  return invoke('cancel_native_recording')
}

export async function isNativeRecording(): Promise<boolean> {
  return invoke<boolean>('is_native_recording')
}

// ─── Streaming Transcription ─────────────────────────────────────────────────

/** Transcribe new audio chunk while still recording (for live streaming) */
export async function transcribeRecordingChunk(
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>('transcribe_recording_chunk', { language, model })
}

/** Stop recording and transcribe ALL audio (final transcription) */
export async function transcribeAllRecording(
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>('transcribe_all_recording', { language, model })
}
