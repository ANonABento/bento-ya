//! Native audio recording using cpal (bypasses webview limitations)

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

/// Audio recorder state
pub struct AudioRecorder {
    samples: Arc<Mutex<Vec<f32>>>,
    is_recording: Arc<AtomicBool>,
    input_sample_rate: Arc<AtomicU32>,
    target_sample_rate: u32,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            samples: Arc::new(Mutex::new(Vec::new())),
            is_recording: Arc::new(AtomicBool::new(false)),
            input_sample_rate: Arc::new(AtomicU32::new(48000)), // Default, will be updated
            target_sample_rate: 16000, // Whisper requires 16kHz
        }
    }

    /// Start recording from the default input device
    pub fn start(&self) -> Result<(), String> {
        if self.is_recording.load(Ordering::SeqCst) {
            return Err("Already recording".to_string());
        }

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No input device available")?;

        log::info!("Using input device: {}", device.name().unwrap_or_default());

        // Get supported config
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

        // Store the actual sample rate
        self.input_sample_rate.store(actual_sample_rate, Ordering::SeqCst);

        let samples = Arc::clone(&self.samples);
        let is_recording = Arc::clone(&self.is_recording);

        // Clear previous samples
        samples.lock().unwrap().clear();
        is_recording.store(true, Ordering::SeqCst);

        // Build the input stream
        let err_fn = |err| log::error!("Audio stream error: {}", err);

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device
                .build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if is_recording.load(Ordering::SeqCst) {
                            let mut samples = samples.lock().unwrap();
                            // Convert to mono by averaging channels
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

        // Keep stream alive in a thread
        let is_rec = Arc::clone(&self.is_recording);
        std::thread::spawn(move || {
            while is_rec.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            // Stream drops here, stopping recording
            log::info!("Recording stream stopped");
        });

        Ok(())
    }

    /// Stop recording and save to WAV file
    pub fn stop(&self) -> Result<PathBuf, String> {
        if !self.is_recording.load(Ordering::SeqCst) {
            return Err("Not recording".to_string());
        }

        self.is_recording.store(false, Ordering::SeqCst);

        // Give the stream time to stop
        std::thread::sleep(std::time::Duration::from_millis(200));

        let samples = self.samples.lock().unwrap();
        if samples.is_empty() {
            return Err("No audio recorded".to_string());
        }

        let input_rate = self.input_sample_rate.load(Ordering::SeqCst);
        log::info!("Recorded {} samples at {} Hz", samples.len(), input_rate);

        // Resample to 16kHz for whisper
        let resampled = resample(&samples, input_rate, self.target_sample_rate);
        log::info!("Resampled to {} samples at {} Hz", resampled.len(), self.target_sample_rate);

        // Save to temp WAV file
        let temp_dir = std::env::temp_dir();
        let filename = format!("bento_voice_{}.wav", uuid::Uuid::new_v4());
        let wav_path = temp_dir.join(filename);

        save_wav(&resampled, self.target_sample_rate, &wav_path)?;

        log::info!("Saved recording to {:?}", wav_path);

        Ok(wav_path)
    }

    /// Check if currently recording
    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }

    /// Cancel recording without saving
    pub fn cancel(&self) {
        self.is_recording.store(false, Ordering::SeqCst);
        self.samples.lock().unwrap().clear();
    }
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

/// Save samples to WAV file
fn save_wav(samples: &[f32], sample_rate: u32, path: &PathBuf) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| format!("Failed to create WAV file: {}", e))?;

    for &sample in samples {
        let amplitude = (sample * i16::MAX as f32) as i16;
        writer
            .write_sample(amplitude)
            .map_err(|e| format!("Failed to write sample: {}", e))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample() {
        let input = vec![0.0, 1.0, 0.0, -1.0, 0.0, 1.0];
        let output = resample(&input, 48000, 16000);
        // 48000/16000 = 3, so output should be ~1/3 the size
        assert!(output.len() < input.len());
    }
}
