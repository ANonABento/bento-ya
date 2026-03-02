//! Native audio recording with streaming support using cpal

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Stream;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

/// Wrapper to make Stream Send+Sync (safe because we only access from Tauri's async runtime)
#[allow(dead_code)]
struct StreamHandle(Stream);
unsafe impl Send for StreamHandle {}
unsafe impl Sync for StreamHandle {}

/// Audio recorder with streaming transcription support
pub struct AudioRecorder {
    samples: Arc<Mutex<Vec<f32>>>,
    is_recording: Arc<AtomicBool>,
    input_sample_rate: Arc<AtomicU32>,
    target_sample_rate: u32,
    /// Track how many samples have been transcribed (for incremental chunks)
    transcribed_offset: Arc<AtomicUsize>,
    /// Keep the stream alive while recording
    stream: Mutex<Option<StreamHandle>>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            samples: Arc::new(Mutex::new(Vec::new())),
            is_recording: Arc::new(AtomicBool::new(false)),
            input_sample_rate: Arc::new(AtomicU32::new(48000)),
            target_sample_rate: 16000, // Whisper requires 16kHz
            transcribed_offset: Arc::new(AtomicUsize::new(0)),
            stream: Mutex::new(None),
        }
    }

    /// Start recording from the default input device
    pub fn start(&self) -> Result<(), String> {
        // If already recording, stop first (handles stuck state)
        if self.is_recording.load(Ordering::SeqCst) {
            log::warn!("[Recorder] Was already recording, stopping first...");
            self.is_recording.store(false, Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(300));
            self.samples.lock().unwrap().clear();
        }

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No input device available")?;

        log::info!("Using input device: {}", device.name().unwrap_or_default());

        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        let actual_sample_rate = config.sample_rate().0;
        let channels = config.channels() as usize;

        log::info!(
            "Input config: {} channels, {} Hz, {:?}",
            channels,
            actual_sample_rate,
            config.sample_format()
        );

        self.input_sample_rate.store(actual_sample_rate, Ordering::SeqCst);
        self.transcribed_offset.store(0, Ordering::SeqCst);

        let samples = Arc::clone(&self.samples);
        let is_recording = Arc::clone(&self.is_recording);

        samples.lock().unwrap().clear();
        is_recording.store(true, Ordering::SeqCst);

        let err_fn = |err| log::error!("Audio stream error: {}", err);

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device
                .build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if is_recording.load(Ordering::SeqCst) {
                            let mut samples = samples.lock().unwrap();
                            for chunk in data.chunks(channels) {
                                let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
                                samples.push(mono);
                            }
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build input stream: {}", e))?,
            cpal::SampleFormat::I16 => device
                .build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if is_recording.load(Ordering::SeqCst) {
                            let mut samples = samples.lock().unwrap();
                            for chunk in data.chunks(channels) {
                                let mono: f32 = chunk.iter().map(|&s| s as f32 / i16::MAX as f32).sum::<f32>() / channels as f32;
                                samples.push(mono);
                            }
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build input stream: {}", e))?,
            cpal::SampleFormat::U16 => device
                .build_input_stream(
                    &config.into(),
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        if is_recording.load(Ordering::SeqCst) {
                            let mut samples = samples.lock().unwrap();
                            for chunk in data.chunks(channels) {
                                let mono: f32 = chunk.iter().map(|&s| (s as f32 - 32768.0) / 32768.0).sum::<f32>() / channels as f32;
                                samples.push(mono);
                            }
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build input stream: {}", e))?,
            _ => return Err("Unsupported sample format".to_string()),
        };

        stream.play().map_err(|e| format!("Failed to start recording: {}", e))?;

        // Store stream in struct to keep it alive while recording
        *self.stream.lock().unwrap() = Some(StreamHandle(stream));

        log::info!("[Recorder] Recording started successfully");
        Ok(())
    }

    /// Get new audio samples since last chunk (for streaming transcription)
    /// Returns the samples and updates the offset
    pub fn get_new_chunk(&self) -> Option<Vec<f32>> {
        if !self.is_recording.load(Ordering::SeqCst) {
            return None;
        }

        let samples = self.samples.lock().unwrap();
        let offset = self.transcribed_offset.load(Ordering::SeqCst);

        // Need at least 1.5 seconds of new audio for Whisper to work properly
        let input_rate = self.input_sample_rate.load(Ordering::SeqCst) as usize;
        let min_new_samples = input_rate * 3 / 2; // 1.5 seconds

        if samples.len() <= offset + min_new_samples {
            return None;
        }

        // Get new samples
        let new_samples: Vec<f32> = samples[offset..].to_vec();

        // Update offset - no overlap, each chunk is independent
        self.transcribed_offset.store(samples.len(), Ordering::SeqCst);

        // Resample to 16kHz
        let input_rate = self.input_sample_rate.load(Ordering::SeqCst);
        let resampled = resample(&new_samples, input_rate, self.target_sample_rate);

        log::info!("[Recorder] Got chunk: {} samples -> {} resampled", new_samples.len(), resampled.len());

        Some(resampled)
    }

    /// Get ALL audio samples (for final transcription when stopping)
    pub fn get_all_samples(&self) -> Vec<f32> {
        let samples = self.samples.lock().unwrap();
        let input_rate = self.input_sample_rate.load(Ordering::SeqCst);
        resample(&samples, input_rate, self.target_sample_rate)
    }

    /// Stop recording (doesn't save - caller handles transcription)
    pub fn stop(&self) -> Result<(), String> {
        if !self.is_recording.load(Ordering::SeqCst) {
            return Ok(()); // Already stopped
        }

        self.is_recording.store(false, Ordering::SeqCst);

        // Drop the stream to stop recording
        *self.stream.lock().unwrap() = None;

        log::info!("[Recorder] Stopped, total samples: {}", self.samples.lock().unwrap().len());
        Ok(())
    }

    /// Check if currently recording
    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }

    /// Cancel recording without saving
    pub fn cancel(&self) {
        self.is_recording.store(false, Ordering::SeqCst);
        *self.stream.lock().unwrap() = None;
        self.samples.lock().unwrap().clear();
        self.transcribed_offset.store(0, Ordering::SeqCst);
    }

    /// Get duration in seconds
    pub fn get_duration_secs(&self) -> f32 {
        let samples = self.samples.lock().unwrap();
        let input_rate = self.input_sample_rate.load(Ordering::SeqCst);
        if input_rate == 0 {
            return 0.0;
        }
        samples.len() as f32 / input_rate as f32
    }
}

/// Simple linear interpolation resampling
fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample() {
        let input = vec![0.0, 1.0, 0.0, -1.0, 0.0, 1.0];
        let output = resample(&input, 48000, 16000);
        assert!(output.len() < input.len());
    }
}
