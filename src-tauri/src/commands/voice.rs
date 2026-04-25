use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, Runtime, State};

use crate::whisper::{self, AudioRecorder, WhisperModel, WhisperModelInfo, WhisperModelStatus};

/// Managed state for the audio recorder
pub struct RecorderState(pub Mutex<AudioRecorder>);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub text: String,
    pub duration_ms: u64,
    pub model_used: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionError {
    pub message: String,
    pub code: String,
}

/// Transcribe an audio file using local Whisper model
#[command]
pub async fn transcribe_audio<R: Runtime>(
    app: AppHandle<R>,
    audio_path: String,
    language: Option<String>,
    model: Option<String>,
) -> Result<TranscriptionResult, String> {
    let path = PathBuf::from(&audio_path);
    if !path.exists() {
        return Err(format!("Audio file not found: {}", audio_path));
    }

    let model_size = model
        .as_deref()
        .and_then(WhisperModel::parse)
        .unwrap_or(WhisperModel::Tiny);

    let model_path = whisper::get_whisper_models_dir(&app)?.join(model_size.filename());

    if !model_path.exists() {
        return Err(format!(
            "Whisper model '{}' not downloaded. Please download it in Settings → Voice.",
            format!("{:?}", model_size).to_lowercase()
        ));
    }

    let start_time = std::time::Instant::now();

    let lang = language.clone();
    let result = tokio::task::spawn_blocking(move || {
        whisper::transcribe_local(&path, &model_path, lang.as_deref())
    })
    .await
    .map_err(|e| format!("Transcription task failed: {}", e))?
    .map_err(|e| format!("Transcription failed: {}", e))?;

    let _ = std::fs::remove_file(&audio_path);

    let duration_ms = start_time.elapsed().as_millis() as u64;

    Ok(TranscriptionResult {
        text: result.text,
        duration_ms,
        model_used: Some(result.model_used),
    })
}

/// Save audio blob to a temporary file and return the path
#[command]
pub async fn save_audio_temp<R: Runtime>(
    app: AppHandle<R>,
    audio_data: Vec<u8>,
) -> Result<String, String> {
    let temp_dir = app
        .path()
        .temp_dir()
        .map_err(|e| format!("Failed to get temp directory: {}", e))?;

    let filename = format!("bento_voice_{}.webm", chrono::Utc::now().timestamp_millis());
    let path = temp_dir.join(filename);

    std::fs::write(&path, audio_data).map_err(|e| format!("Failed to write audio file: {}", e))?;

    path.to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

/// Check if voice transcription is available (any model downloaded)
#[command]
pub fn is_voice_available<R: Runtime>(app: AppHandle<R>) -> bool {
    let models = whisper::list_whisper_models(&app);
    models
        .iter()
        .any(|m| m.status == WhisperModelStatus::Downloaded)
}

/// List all available whisper models and their status
#[command]
pub fn list_whisper_models<R: Runtime>(app: AppHandle<R>) -> Vec<WhisperModelInfo> {
    whisper::list_whisper_models(&app)
}

/// Download a whisper model
#[command]
pub async fn download_whisper_model<R: Runtime>(
    app: AppHandle<R>,
    model: String,
) -> Result<String, String> {
    let model_size =
        WhisperModel::parse(&model).ok_or_else(|| format!("Invalid model: {}", model))?;

    let path = whisper::download_whisper_model(app, model_size).await?;

    path.to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

/// Delete a downloaded whisper model
#[command]
pub fn delete_whisper_model<R: Runtime>(app: AppHandle<R>, model: String) -> Result<(), String> {
    let model_size =
        WhisperModel::parse(&model).ok_or_else(|| format!("Invalid model: {}", model))?;

    whisper::delete_whisper_model(&app, model_size)
}

/// Get info about a specific whisper model
#[command]
pub fn get_whisper_model_info<R: Runtime>(
    app: AppHandle<R>,
    model: String,
) -> Result<WhisperModelInfo, String> {
    let model_size =
        WhisperModel::parse(&model).ok_or_else(|| format!("Invalid model: {}", model))?;

    Ok(whisper::get_model_info(&app, model_size))
}

// ============ Native Audio Recording Commands ============

/// Start native audio recording (bypasses webview limitations)
#[command]
pub fn start_native_recording(recorder_state: State<'_, RecorderState>) -> Result<(), String> {
    log::info!("[Voice] Starting native recording...");
    let recorder = recorder_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    recorder.start()
}

/// Stop native recording
#[command]
pub fn stop_native_recording(recorder_state: State<'_, RecorderState>) -> Result<(), String> {
    log::info!("[Voice] Stopping native recording...");
    let recorder = recorder_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    recorder.stop()
}

/// Cancel native recording without saving
#[command]
pub fn cancel_native_recording(recorder_state: State<'_, RecorderState>) -> Result<(), String> {
    log::info!("[Voice] Cancelling native recording...");
    let recorder = recorder_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    recorder.cancel();
    Ok(())
}

/// Check if currently recording
#[command]
pub fn is_native_recording(recorder_state: State<'_, RecorderState>) -> Result<bool, String> {
    let recorder = recorder_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(recorder.is_recording())
}

// ============ Streaming Transcription Commands ============

/// Get and transcribe the latest audio chunk while still recording
/// Returns the transcribed text for new audio since last call
#[command]
pub async fn transcribe_recording_chunk<R: Runtime>(
    app: AppHandle<R>,
    recorder_state: State<'_, RecorderState>,
    language: Option<String>,
    model: Option<String>,
) -> Result<TranscriptionResult, String> {
    // Get the audio chunk
    let samples = {
        let recorder = recorder_state
            .0
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        recorder.get_new_chunk()
    };

    let samples = match samples {
        Some(s) if !s.is_empty() => s,
        _ => {
            return Ok(TranscriptionResult {
                text: String::new(),
                duration_ms: 0,
                model_used: None,
            });
        }
    };

    // Get model path
    let model_size = model
        .as_deref()
        .and_then(WhisperModel::parse)
        .unwrap_or(WhisperModel::Tiny);

    let model_path = whisper::get_whisper_models_dir(&app)?.join(model_size.filename());

    if !model_path.exists() {
        return Err(format!(
            "Whisper model '{}' not downloaded",
            format!("{:?}", model_size).to_lowercase()
        ));
    }

    // Transcribe in blocking task
    let lang = language.clone();
    let result = tokio::task::spawn_blocking(move || {
        whisper::transcribe_samples(&samples, &model_path, lang.as_deref())
    })
    .await
    .map_err(|e| format!("Transcription task failed: {}", e))?
    .map_err(|e| format!("Transcription failed: {}", e))?;

    Ok(TranscriptionResult {
        text: result.text,
        duration_ms: result.duration_ms,
        model_used: Some(result.model_used),
    })
}

/// Get and transcribe ALL recorded audio (for final transcription when stopping)
#[command]
pub async fn transcribe_all_recording<R: Runtime>(
    app: AppHandle<R>,
    recorder_state: State<'_, RecorderState>,
    language: Option<String>,
    model: Option<String>,
) -> Result<TranscriptionResult, String> {
    // Stop recording and get all samples
    let samples = {
        let recorder = recorder_state
            .0
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        recorder.stop()?;
        recorder.get_all_samples()
    };

    if samples.is_empty() {
        return Ok(TranscriptionResult {
            text: String::new(),
            duration_ms: 0,
            model_used: None,
        });
    }

    // Get model path
    let model_size = model
        .as_deref()
        .and_then(WhisperModel::parse)
        .unwrap_or(WhisperModel::Tiny);

    let model_path = whisper::get_whisper_models_dir(&app)?.join(model_size.filename());

    if !model_path.exists() {
        return Err(format!(
            "Whisper model '{}' not downloaded",
            format!("{:?}", model_size).to_lowercase()
        ));
    }

    // Transcribe in blocking task
    let lang = language.clone();
    let result = tokio::task::spawn_blocking(move || {
        whisper::transcribe_samples(&samples, &model_path, lang.as_deref())
    })
    .await
    .map_err(|e| format!("Transcription task failed: {}", e))?
    .map_err(|e| format!("Transcription failed: {}", e))?;

    Ok(TranscriptionResult {
        text: result.text,
        duration_ms: result.duration_ms,
        model_used: Some(result.model_used),
    })
}
