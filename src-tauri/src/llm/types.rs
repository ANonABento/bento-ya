//! LLM types for chat completions

use serde::{Deserialize, Serialize};

/// A chat message (user, assistant, or system)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

impl Message {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: content.into(),
        }
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: content.into(),
        }
    }
}

/// Request for LLM chat completion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub stream: bool,
}

impl Default for LlmRequest {
    fn default() -> Self {
        Self {
            model: "claude-sonnet-4-6-20260217".to_string(),
            messages: Vec::new(),
            max_tokens: Some(4096),
            temperature: None,
            stream: true,
        }
    }
}

/// A streaming chunk from the LLM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    /// Incremental text content
    pub delta: String,
    /// Set when streaming is complete (e.g., "end_turn", "stop")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

/// Token usage statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
}

impl TokenUsage {
    pub fn total(&self) -> i64 {
        self.input_tokens + self.output_tokens
    }
}

/// Complete LLM response after streaming finishes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    /// Full accumulated content
    pub content: String,
    /// Token usage for cost tracking
    pub usage: TokenUsage,
    /// Model that was used
    pub model: String,
    /// Why generation stopped
    pub finish_reason: String,
}

/// Supported LLM providers
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    OpenAI,
    OpenRouter,
}

impl Provider {
    pub fn env_var_name(&self) -> &'static str {
        match self {
            Provider::Anthropic => "ANTHROPIC_API_KEY",
            Provider::OpenAI => "OPENAI_API_KEY",
            Provider::OpenRouter => "OPENROUTER_API_KEY",
        }
    }

    pub fn default_model(&self) -> &'static str {
        match self {
            Provider::Anthropic => "claude-sonnet-4-6-20260217",
            Provider::OpenAI => "codex-5.3",
            Provider::OpenRouter => "anthropic/claude-sonnet-4-6-20260217",
        }
    }
}
