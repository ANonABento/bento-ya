use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager, Runtime};

use crate::whisper::{
    self, WhisperModel, WhisperModelInfo, WhisperModelStatus,
};

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

    // Determine which model to use
    let model_size = model
        .as_deref()
        .and_then(WhisperModel::from_str)
        .unwrap_or(WhisperModel::Tiny);

    // Check if model is downloaded
    let model_path = whisper::get_whisper_models_dir(&app)?
        .join(model_size.filename());

    if !model_path.exists() {
        return Err(format!(
            "Whisper model '{}' not downloaded. Please download it in Settings → Voice.",
            format!("{:?}", model_size).to_lowercase()
        ));
    }

    let start_time = std::time::Instant::now();

    // Run transcription in blocking task to not block async runtime
    let lang = language.clone();
    let result = tokio::task::spawn_blocking(move || {
        whisper::transcribe_local(&path, &model_path, lang.as_deref())
    })
    .await
    .map_err(|e| format!("Transcription task failed: {}", e))?
    .map_err(|e| format!("Transcription failed: {}", e))?;

    // Clean up temp file
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

    std::fs::write(&path, audio_data)
        .map_err(|e| format!("Failed to write audio file: {}", e))?;

    path.to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

/// Check if voice transcription is available (any model downloaded)
#[command]
pub fn is_voice_available<R: Runtime>(app: AppHandle<R>) -> bool {
    let models = whisper::list_whisper_models(&app);
    models.iter().any(|m| m.status == WhisperModelStatus::Downloaded)
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
    let model_size = WhisperModel::from_str(&model)
        .ok_or_else(|| format!("Invalid model: {}", model))?;

    let path = whisper::download_whisper_model(app, model_size).await?;

    path.to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

/// Delete a downloaded whisper model
#[command]
pub fn delete_whisper_model<R: Runtime>(
    app: AppHandle<R>,
    model: String,
) -> Result<(), String> {
    let model_size = WhisperModel::from_str(&model)
        .ok_or_else(|| format!("Invalid model: {}", model))?;

    whisper::delete_whisper_model(&app, model_size)
}

/// Get info about a specific whisper model
#[command]
pub fn get_whisper_model_info<R: Runtime>(
    app: AppHandle<R>,
    model: String,
) -> Result<WhisperModelInfo, String> {
    let model_size = WhisperModel::from_str(&model)
        .ok_or_else(|| format!("Invalid model: {}", model))?;

    Ok(whisper::get_model_info(&app, model_size))
}
