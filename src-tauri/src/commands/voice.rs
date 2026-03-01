use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager, Runtime};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionError {
    pub message: String,
    pub code: String,
}

/// Transcribe an audio file using OpenAI's Whisper API
#[command]
pub async fn transcribe_audio<R: Runtime>(
    _app: AppHandle<R>,
    audio_path: String,
    language: Option<String>,
    model: Option<String>,
) -> Result<TranscriptionResult, String> {
    let api_key = env::var("OPENAI_API_KEY")
        .map_err(|_| "OPENAI_API_KEY environment variable not set".to_string())?;

    let path = PathBuf::from(&audio_path);
    if !path.exists() {
        return Err(format!("Audio file not found: {}", audio_path));
    }

    // Read the audio file
    let audio_data = std::fs::read(&path)
        .map_err(|e| format!("Failed to read audio file: {}", e))?;

    // Get filename for the form data
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio.webm")
        .to_string();

    let whisper_model = model.unwrap_or_else(|| "whisper-1".to_string());
    let start_time = std::time::Instant::now();

    // Build the multipart form
    let form = reqwest::multipart::Form::new()
        .part(
            "file",
            reqwest::multipart::Part::bytes(audio_data)
                .file_name(filename)
                .mime_str("audio/webm")
                .map_err(|e| format!("Failed to set MIME type: {}", e))?,
        )
        .text("model", whisper_model);

    let form = if let Some(lang) = language {
        form.text("language", lang)
    } else {
        form
    };

    // Send request to OpenAI
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to OpenAI: {}", e))?;

    let duration_ms = start_time.elapsed().as_millis() as u64;

    if !response.status().is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("OpenAI API error: {}", error_text));
    }

    #[derive(Deserialize)]
    struct WhisperResponse {
        text: String,
    }

    let whisper_response: WhisperResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

    // Clean up the temporary file
    let _ = std::fs::remove_file(&path);

    Ok(TranscriptionResult {
        text: whisper_response.text.trim().to_string(),
        duration_ms,
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
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path".to_string())
}

/// Check if voice transcription is available (API key set)
#[command]
pub fn is_voice_available() -> bool {
    env::var("OPENAI_API_KEY").is_ok()
}
