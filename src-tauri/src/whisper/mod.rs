//! Local Whisper transcription module
//!
//! Provides on-device speech-to-text using whisper.cpp via whisper-rs.
//! Models are downloaded on-demand and stored in the app data directory.

mod manager;
mod transcriber;

pub use manager::{
    delete_whisper_model, download_whisper_model, get_model_info, get_whisper_models_dir,
    list_whisper_models, WhisperModel, WhisperModelInfo, WhisperModelStatus,
};
pub use transcriber::{transcribe_local, LocalTranscriptionResult};
