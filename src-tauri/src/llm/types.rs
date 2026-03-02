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
    pub system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub stream: bool,
    /// Tool definitions in Anthropic format
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<serde_json::Value>>,
}

impl Default for LlmRequest {
    fn default() -> Self {
        Self {
            model: "claude-sonnet-4-6-20260217".to_string(),
            messages: Vec::new(),
            system: None,
            max_tokens: Some(4096),
            temperature: None,
            stream: true,
            tools: None,
        }
    }
}

/// A streaming chunk from the LLM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    /// Incremental text content
    pub delta: String,
    /// Set when streaming is complete (e.g., "end_turn", "stop", "tool_use")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    /// Tool use block (when stop_reason is "tool_use")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use: Option<ToolUseBlock>,
}

/// A tool use block from the LLM response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUseBlock {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
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
    /// Why generation stopped (e.g., "end_turn", "tool_use")
    pub finish_reason: String,
    /// Tool use blocks if the model requested tool calls
    #[serde(default)]
    pub tool_uses: Vec<ToolUseBlock>,
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

/// Model definition with aliases and API IDs
#[derive(Debug, Clone)]
pub struct ModelInfo {
    /// User-friendly alias (e.g., "sonnet", "opus")
    pub alias: &'static str,
    /// Full API model ID
    pub api_id: &'static str,
    /// Display name
    pub name: &'static str,
    /// Cost per million input tokens (USD)
    pub input_cost_per_m: f64,
    /// Cost per million output tokens (USD)
    pub output_cost_per_m: f64,
}

/// Available Anthropic models
pub const ANTHROPIC_MODELS: &[ModelInfo] = &[
    ModelInfo {
        alias: "sonnet",
        api_id: "claude-sonnet-4-6-20260217",
        name: "Claude Sonnet 4.6",
        input_cost_per_m: 3.0,
        output_cost_per_m: 15.0,
    },
    ModelInfo {
        alias: "opus",
        api_id: "claude-opus-4-20250514",
        name: "Claude Opus 4",
        input_cost_per_m: 15.0,
        output_cost_per_m: 75.0,
    },
    ModelInfo {
        alias: "haiku",
        api_id: "claude-haiku-3-5-20250615",
        name: "Claude Haiku 3.5",
        input_cost_per_m: 0.25,
        output_cost_per_m: 1.25,
    },
];

/// Resolve a model alias or ID to the full API model ID
pub fn resolve_model_id(alias_or_id: &str) -> &str {
    // Check if it's an alias
    for model in ANTHROPIC_MODELS {
        if model.alias == alias_or_id {
            return model.api_id;
        }
    }
    // Already a full ID, return as-is
    alias_or_id
}

/// Get model info by alias or ID
pub fn get_model_info(alias_or_id: &str) -> Option<&'static ModelInfo> {
    ANTHROPIC_MODELS.iter().find(|m| m.alias == alias_or_id || m.api_id == alias_or_id)
}
