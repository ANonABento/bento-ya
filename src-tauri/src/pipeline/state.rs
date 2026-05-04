use serde::{Deserialize, Serialize};

/// Pipeline execution states for a task
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PipelineState {
    /// Task is idle, no trigger running
    #[default]
    Idle,
    /// Trigger has been fired, waiting for execution
    Triggered,
    /// Trigger is actively running (agent/script)
    Running,
    /// Evaluating exit criteria
    Evaluating,
    /// Task is advancing to the next column
    Advancing,
    /// Provider rate limit hit. Re-fire is scheduled; not a real failure.
    RateLimited,
}

impl PipelineState {
    pub fn as_str(&self) -> &'static str {
        match self {
            PipelineState::Idle => "idle",
            PipelineState::Triggered => "triggered",
            PipelineState::Running => "running",
            PipelineState::Evaluating => "evaluating",
            PipelineState::Advancing => "advancing",
            PipelineState::RateLimited => "rate_limited",
        }
    }

    pub fn from_storage(s: &str) -> Self {
        match s {
            "triggered" => PipelineState::Triggered,
            "running" => PipelineState::Running,
            "evaluating" => PipelineState::Evaluating,
            "advancing" => PipelineState::Advancing,
            "rate_limited" => PipelineState::RateLimited,
            _ => PipelineState::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::PipelineState;

    #[test]
    fn test_pipeline_state_roundtrip() {
        for state in [
            PipelineState::Idle,
            PipelineState::Triggered,
            PipelineState::Running,
            PipelineState::Evaluating,
            PipelineState::Advancing,
        ] {
            assert_eq!(PipelineState::from_storage(state.as_str()), state);
        }
    }

    #[test]
    fn test_pipeline_state_unknown_defaults_idle() {
        assert_eq!(PipelineState::from_storage("garbage"), PipelineState::Idle);
        assert_eq!(PipelineState::from_storage(""), PipelineState::Idle);
    }
}
