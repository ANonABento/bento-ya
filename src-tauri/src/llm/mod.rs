//! LLM integration module
//!
//! Provides streaming chat completions via various providers (Anthropic, OpenAI, etc.)

pub mod anthropic;
pub mod context;
pub mod executor;
pub mod tools;
pub mod types;

pub use anthropic::{calculate_cost, get_api_key, AnthropicClient};
pub use context::{
    build_board_context, build_cli_system_prompt, build_system_prompt, format_board_context_message,
};
pub use executor::{execute_tools, ExecutionResult};
pub use tools::{
    extract_text_content, normalize_tool_name, orchestrator_tools, parse_cli_action_blocks,
    parse_tool_uses, tools_to_api_format, ToolDefinition, ToolResult, ToolUse,
};
pub use types::{
    get_model_pricing, infer_provider_id, resolve_model_id, LlmRequest, LlmResponse, Message,
    Provider, StreamChunk, TokenUsage, ToolUseBlock,
};
