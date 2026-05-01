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

/// Resolve a model alias or ID to the full API model ID.
/// Uses the dynamic metadata registry.
pub fn resolve_model_id(alias_or_id: &str) -> String {
    // Check if it's an alias in the metadata registry
    if let Some(full_id) = crate::models::metadata::resolve_alias(alias_or_id) {
        return full_id.to_string();
    }
    // Already a full ID, return as-is
    alias_or_id.to_string()
}

/// Get pricing for a model by alias or full ID.
/// Returns (input_cost_per_m, output_cost_per_m) or None.
pub fn get_model_pricing(alias_or_id: &str) -> Option<(f64, f64)> {
    let full_id = resolve_model_id(alias_or_id);
    crate::models::metadata::get_pricing(&full_id)
}

/// Infer a stable provider id for usage records from the CLI path and model id.
pub fn infer_provider_id(cli_path: &str, model: &str) -> &'static str {
    let cli_and_model = format!("{cli_path} {model}").to_lowercase();
    if cli_and_model.contains("codex")
        || cli_and_model.contains("openai")
        || cli_and_model.contains("gpt")
    {
        "openai"
    } else {
        "anthropic"
    }
}
