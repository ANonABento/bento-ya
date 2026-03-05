// Voice/Whisper IPC commands

import { invoke, listen, type EventCallback, type UnlistenFn } from './core'

// ─── Types ─────────────────────────────────────────────────────────────────

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

// ─── Voice commands ─────────────────────────────────────────────────────────

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
  return invoke<void>('delete_whisper_model', { model })
}

export async function getWhisperModelInfo(model: string): Promise<WhisperModelInfo> {
  return invoke<WhisperModelInfo>('get_whisper_model_info', { model })
}

// ─── Native Audio Recording ──────────────────────────────────────────────────

export async function startNativeRecording(): Promise<void> {
  return invoke<void>('start_native_recording')
}

export async function stopNativeRecording(): Promise<void> {
  return invoke<void>('stop_native_recording')
}

export async function cancelNativeRecording(): Promise<void> {
  return invoke<void>('cancel_native_recording')
}

export async function isNativeRecording(): Promise<boolean> {
  return invoke<boolean>('is_native_recording')
}

// ─── Streaming Transcription ─────────────────────────────────────────────────

export async function transcribeRecordingChunk(
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>('transcribe_recording_chunk', { language, model })
}

export async function transcribeAllRecording(
  language?: string,
  model?: string,
): Promise<TranscriptionResult> {
  return invoke<TranscriptionResult>('transcribe_all_recording', { language, model })
}

// ─── Event listeners ───────────────────────────────────────────────────────

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
