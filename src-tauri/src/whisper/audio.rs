/// Simple linear interpolation resampling.
pub(super) fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
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
    fn resample_downsamples_with_linear_interpolation() {
        let input = vec![0.0, 1.0, 0.0, -1.0, 0.0, 1.0];
        let output = resample(&input, 48000, 16000);

        assert!(output.len() < input.len());
    }

    #[test]
    fn resample_preserves_samples_when_rate_matches() {
        let input = vec![0.0, 0.5, -0.5];

        assert_eq!(resample(&input, 16000, 16000), input);
    }

    #[test]
    fn resample_preserves_empty_input() {
        assert!(resample(&[], 48000, 16000).is_empty());
    }
}
