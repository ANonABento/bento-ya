//! Whisper model management
//!
//! Downloads and manages whisper.cpp models from Hugging Face.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Available Whisper model sizes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WhisperModel {
    Tiny,
    Base,
    Small,
    Medium,
    Large,
}

impl WhisperModel {
    /// Model filename (ggml format)
    pub fn filename(&self) -> &'static str {
        match self {
            WhisperModel::Tiny => "ggml-tiny.bin",
            WhisperModel::Base => "ggml-base.bin",
            WhisperModel::Small => "ggml-small.bin",
            WhisperModel::Medium => "ggml-medium.bin",
            WhisperModel::Large => "ggml-large-v3.bin",
        }
    }

    /// Hugging Face download URL
    pub fn download_url(&self) -> &'static str {
        match self {
            WhisperModel::Tiny => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
            }
            WhisperModel::Base => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
            }
            WhisperModel::Small => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
            }
            WhisperModel::Medium => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"
            }
            WhisperModel::Large => {
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin"
            }
        }
    }

    /// Approximate download size in bytes
    pub fn size_bytes(&self) -> u64 {
        match self {
            WhisperModel::Tiny => 75_000_000,      // ~75 MB
            WhisperModel::Base => 142_000_000,     // ~142 MB
            WhisperModel::Small => 466_000_000,    // ~466 MB
            WhisperModel::Medium => 1_500_000_000, // ~1.5 GB
            WhisperModel::Large => 3_100_000_000,  // ~3.1 GB
        }
    }

    /// Human-readable size
    pub fn size_display(&self) -> &'static str {
        match self {
            WhisperModel::Tiny => "75 MB",
            WhisperModel::Base => "142 MB",
            WhisperModel::Small => "466 MB",
            WhisperModel::Medium => "1.5 GB",
            WhisperModel::Large => "3.1 GB",
        }
    }

    /// Model description
    pub fn description(&self) -> &'static str {
        match self {
            WhisperModel::Tiny => "Fastest, lower accuracy",
            WhisperModel::Base => "Fast, good accuracy",
            WhisperModel::Small => "Balanced speed/accuracy",
            WhisperModel::Medium => "High accuracy, slower",
            WhisperModel::Large => "Best accuracy, slowest",
        }
    }

    /// Parse from string
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "tiny" => Some(WhisperModel::Tiny),
            "base" => Some(WhisperModel::Base),
            "small" => Some(WhisperModel::Small),
            "medium" => Some(WhisperModel::Medium),
            "large" => Some(WhisperModel::Large),
            _ => None,
        }
    }

    /// Get all available models
    pub fn all() -> Vec<Self> {
        vec![
            WhisperModel::Tiny,
            WhisperModel::Base,
            WhisperModel::Small,
            WhisperModel::Medium,
            WhisperModel::Large,
        ]
    }
}

/// Model download/status info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelInfo {
    pub model: String,
    pub status: WhisperModelStatus,
    pub size_display: String,
    pub size_bytes: u64,
    pub description: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WhisperModelStatus {
    Available,   // Not downloaded
    Downloading, // Currently downloading
    Downloaded,  // Ready to use
    Error,       // Download failed
}

/// Download progress event payload
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub model: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f32,
}

/// Get the whisper models directory
pub fn get_whisper_models_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let models_dir = app_data.join("models").join("whisper");

    // Create directory if it doesn't exist
    if !models_dir.exists() {
        fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
    }

    Ok(models_dir)
}

/// Get the path to a downloaded model
pub fn get_model_path<R: Runtime>(app: &AppHandle<R>, model: WhisperModel) -> Option<PathBuf> {
    let models_dir = get_whisper_models_dir(app).ok()?;
    let model_path = models_dir.join(model.filename());
    if model_path.exists() {
        Some(model_path)
    } else {
        None
    }
}

/// Get info for a specific model
pub fn get_model_info<R: Runtime>(app: &AppHandle<R>, model: WhisperModel) -> WhisperModelInfo {
    let path = get_model_path(app, model);
    let status = if path.is_some() {
        WhisperModelStatus::Downloaded
    } else {
        WhisperModelStatus::Available
    };

    WhisperModelInfo {
        model: format!("{:?}", model).to_lowercase(),
        status,
        size_display: model.size_display().to_string(),
        size_bytes: model.size_bytes(),
        description: model.description().to_string(),
        path: path.map(|p| p.to_string_lossy().to_string()),
    }
}

/// List all models with their status
pub fn list_whisper_models<R: Runtime>(app: &AppHandle<R>) -> Vec<WhisperModelInfo> {
    WhisperModel::all()
        .into_iter()
        .map(|m| get_model_info(app, m))
        .collect()
}

/// Download a whisper model
pub async fn download_whisper_model<R: Runtime>(
    app: AppHandle<R>,
    model: WhisperModel,
) -> Result<PathBuf, String> {
    let models_dir = get_whisper_models_dir(&app)?;
    let model_path = models_dir.join(model.filename());

    // Check if already downloaded
    if model_path.exists() {
        return Ok(model_path);
    }

    let url = model.download_url();
    let model_name = format!("{:?}", model).to_lowercase();

    log::info!("Downloading whisper model: {} from {}", model_name, url);

    // Create a temp file for download
    let temp_path = model_path.with_extension("tmp");

    // Download with progress
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let total_size = response.content_length().unwrap_or(model.size_bytes());

    let mut file =
        fs::File::create(&temp_path).map_err(|e| format!("Failed to create temp file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    use futures::StreamExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write chunk: {}", e))?;

        downloaded += chunk.len() as u64;
        let percent = (downloaded as f32 / total_size as f32) * 100.0;

        // Emit progress event
        let _ = app.emit(
            "whisper:download-progress",
            DownloadProgress {
                model: model_name.clone(),
                downloaded_bytes: downloaded,
                total_bytes: total_size,
                percent,
            },
        );
    }

    // Rename temp file to final path
    fs::rename(&temp_path, &model_path)
        .map_err(|e| format!("Failed to finalize download: {}", e))?;

    // Emit complete event
    let _ = app.emit(
        "whisper:download-complete",
        serde_json::json!({ "model": model_name }),
    );

    log::info!("Whisper model downloaded: {}", model_name);

    Ok(model_path)
}

/// Delete a downloaded model
pub fn delete_whisper_model<R: Runtime>(
    app: &AppHandle<R>,
    model: WhisperModel,
) -> Result<(), String> {
    let models_dir = get_whisper_models_dir(app)?;
    let model_path = models_dir.join(model.filename());

    if model_path.exists() {
        fs::remove_file(&model_path).map_err(|e| format!("Failed to delete model: {}", e))?;
        log::info!("Deleted whisper model: {:?}", model);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_urls() {
        for model in WhisperModel::all() {
            assert!(model.download_url().starts_with("https://"));
            assert!(model.download_url().contains("huggingface"));
        }
    }

    #[test]
    fn test_model_from_str() {
        assert_eq!(WhisperModel::parse("tiny"), Some(WhisperModel::Tiny));
        assert_eq!(WhisperModel::parse("LARGE"), Some(WhisperModel::Large));
        assert_eq!(WhisperModel::parse("invalid"), None);
    }
}
