//! LLM integration module
//!
//! Provides streaming chat completions via various providers (Anthropic, OpenAI, etc.)

pub mod anthropic;
pub mod types;

pub use anthropic::{AnthropicClient, calculate_cost, get_api_key};
pub use types::{LlmRequest, LlmResponse, Message, Provider, StreamChunk, TokenUsage, resolve_model_id, get_model_info, ANTHROPIC_MODELS};
