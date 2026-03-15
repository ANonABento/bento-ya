//! Stub voice commands when the `voice` feature is disabled.
//! All commands return errors indicating voice is not available.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::command;

/// Dummy recorder state when voice is disabled
pub struct RecorderState(pub Mutex<()>);

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelInfo {
    pub name: String,
    pub size_mb: u64,
    pub status: String,
}

const VOICE_DISABLED_MSG: &str = "Voice input is not available. Build with the 'voice' feature to enable.";

#[command]
pub async fn transcribe_audio(
    _audio_path: String,
    _language: Option<String>,
    _model: Option<String>,
) -> Result<TranscriptionResult, String> {
    Err(VOICE_DISABLED_MSG.to_string())
}

#[command]
pub async fn save_audio_temp(_audio_data: Vec<u8>) -> Result<String, String> {
    Err(VOICE_DISABLED_MSG.to_string())
}

#[command]
pub fn is_voice_available() -> bool {
    false
}

#[command]
pub fn list_whisper_models() -> Vec<WhisperModelInfo> {
    vec![]
}

#[command]
pub async fn download_whisper_model(_model: String) -> Result<String, String> {
    Err(VOICE_DISABLED_MSG.to_string())
}

#[command]
pub fn delete_whisper_model(_model: String) -> Result<(), String> {
    Err(VOICE_DISABLED_MSG.to_string())
}

#[command]
pub fn get_whisper_model_info(_model: String) -> Result<WhisperModelInfo, String> {
    Err(VOICE_DISABLED_MSG.to_string())
}

#[command]
pub fn start_native_recording() -> Result<(), String> {
    Err(VOICE_DISABLED_MSG.to_string())
}

#[command]
pub fn stop_native_recording() -> Result<(), String> {
    Err(VOICE_DISABLED_MSG.to_string())
}

#[command]
pub fn cancel_native_recording() -> Result<(), String> {
    Err(VOICE_DISABLED_MSG.to_string())
}

#[command]
pub fn is_native_recording() -> Result<bool, String> {
    Err(VOICE_DISABLED_MSG.to_string())
}

#[command]
pub async fn transcribe_recording_chunk(
    _language: Option<String>,
    _model: Option<String>,
) -> Result<TranscriptionResult, String> {
    Err(VOICE_DISABLED_MSG.to_string())
}

#[command]
pub async fn transcribe_all_recording(
    _language: Option<String>,
    _model: Option<String>,
) -> Result<TranscriptionResult, String> {
    Err(VOICE_DISABLED_MSG.to_string())
}
