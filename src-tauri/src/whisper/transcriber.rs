//! Local whisper transcription using whisper-rs

use serde::{Deserialize, Serialize};
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Result of local transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTranscriptionResult {
    pub text: String,
    pub duration_ms: u64,
    pub model_used: String,
}

/// Convert audio file to 16kHz mono PCM samples
fn convert_to_pcm(audio_path: &Path) -> Result<Vec<f32>, String> {
    let file = std::fs::File::open(audio_path)
        .map_err(|e| format!("Failed to open audio file: {}", e))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Probe the format
    let mut hint = Hint::new();
    if let Some(ext) = audio_path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| format!("Failed to probe audio format: {}", e))?;

    let mut format = probed.format;

    // Find the first audio track
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or("No audio track found")?;

    let decoder_opts = DecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &decoder_opts)
        .map_err(|e| format!("Failed to create decoder: {}", e))?;

    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(48000);

    let mut samples: Vec<f32> = Vec::new();

    // Decode all packets
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => {
                log::warn!("Error reading packet: {}", e);
                break;
            }
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                let spec = *audio_buf.spec();
                let num_channels = spec.channels.count();

                // Convert to interleaved samples
                let mut sample_buf =
                    SampleBuffer::<f32>::new(audio_buf.capacity() as u64, *audio_buf.spec());
                sample_buf.copy_interleaved_ref(audio_buf);

                let interleaved = sample_buf.samples();

                // Convert to mono by averaging channels
                for chunk in interleaved.chunks(num_channels) {
                    let mono: f32 = chunk.iter().sum::<f32>() / num_channels as f32;
                    samples.push(mono);
                }
            }
            Err(e) => {
                log::warn!("Decode error: {}", e);
            }
        }
    }

    // Resample to 16kHz if needed (whisper requires 16kHz)
    if sample_rate != 16000 {
        samples = resample(&samples, sample_rate, 16000);
    }

    Ok(samples)
}

/// Simple linear interpolation resampling
fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let new_len = (samples.len() as f64 / ratio).ceil() as usize;
    let mut resampled = Vec::with_capacity(new_len);

    for i in 0..new_len {
        let pos = i as f64 * ratio;
        let idx = pos.floor() as usize;
        let frac = pos - pos.floor();

        let sample = if idx + 1 < samples.len() {
            samples[idx] * (1.0 - frac as f32) + samples[idx + 1] * frac as f32
        } else if idx < samples.len() {
            samples[idx]
        } else {
            0.0
        };

        resampled.push(sample);
    }

    resampled
}

/// Transcribe audio using local whisper model
pub fn transcribe_local(
    audio_path: &Path,
    model_path: &Path,
    language: Option<&str>,
) -> Result<LocalTranscriptionResult, String> {
    let start_time = std::time::Instant::now();

    // Convert audio to PCM
    log::info!("Converting audio to PCM: {:?}", audio_path);
    let samples = convert_to_pcm(audio_path)?;

    if samples.is_empty() {
        return Err("No audio samples found".to_string());
    }

    log::info!("Got {} samples, loading whisper model", samples.len());

    // Load whisper context
    let ctx = WhisperContext::new_with_params(
        model_path.to_str().ok_or("Invalid model path")?,
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("Failed to load whisper model: {}", e))?;

    // Create state
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create whisper state: {}", e))?;

    // Set up parameters
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

    // Configure language
    if let Some(lang) = language {
        params.set_language(Some(lang));
    } else {
        // Auto-detect language
        params.set_language(None);
    }

    // Performance settings
    params.set_n_threads(4);
    params.set_translate(false);
    params.set_no_context(true);
    params.set_single_segment(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    log::info!("Running whisper inference...");

    // Run inference
    state
        .full(params, &samples)
        .map_err(|e| format!("Whisper inference failed: {}", e))?;

    // Collect segments using iterator
    let mut text = String::new();
    for segment in state.as_iter() {
        if let Ok(segment_text) = segment.to_str_lossy() {
            text.push_str(&segment_text);
            text.push(' ');
        }
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;
    let model_name = model_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    log::info!(
        "Transcription complete in {}ms: {} chars",
        duration_ms,
        text.len()
    );

    Ok(LocalTranscriptionResult {
        text: text.trim().to_string(),
        duration_ms,
        model_used: model_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample() {
        let input = vec![0.0, 1.0, 0.0, -1.0];
        let output = resample(&input, 48000, 16000);
        // 48000/16000 = 3, so output should be ~1/3 the size
        assert!(output.len() < input.len());
    }
}
