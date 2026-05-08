//! Unified chat event types and CLI JSON parsing.
//!
//! Both PtyTransport and PipeTransport emit these events. The frontend
//! renders them as chat bubbles (pipe) or raw terminal output (pty).
//!
//! JSON parsing is defined here as the single source of truth.

use serde::Serialize;

/// Token usage data extracted from CLI result events.
#[derive(Debug, Clone, Default)]
pub struct TokenUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub model: Option<String>,
}

/// Unified event emitted by both transports.
#[derive(Debug, Clone)]
pub enum ChatEvent {
    /// Session ID captured from CLI system event (pipe transport only)
    SessionId(String),
    /// A structured agent turn has started.
    TurnStarted,
    /// Text content from assistant response
    TextContent(String),
    /// Extended thinking content
    ThinkingContent { content: String, is_complete: bool },
    /// Tool use information
    ToolUse {
        id: String,
        name: String,
        input: Option<String>,
        status: ToolStatus,
    },
    /// Structured command execution started.
    CommandStarted { id: String, command: String },
    /// Structured command execution emitted or completed with output.
    CommandOutput {
        id: String,
        command: Option<String>,
        output: String,
        exit_code: Option<i32>,
    },
    /// Structured command execution completed.
    CommandCompleted {
        id: String,
        command: Option<String>,
        exit_code: Option<i32>,
    },
    /// Response is complete, with optional token usage data
    Complete,
    /// Result event with token usage data
    Result(TokenUsage),
    /// Raw terminal output (PTY transport only, base64-encoded)
    RawOutput(String),
    /// Unknown or unhandled event
    Unknown,
}

/// Status of a tool call
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ToolStatus {
    Running,
    Complete,
}

// ============================================================================
// CLI JSON event parsing (single source of truth)
// ============================================================================

/// Parse a JSON line from CLI stdout into a ChatEvent.
///
/// Handles: system, assistant, content_block_start/delta/stop, result.
/// Used by PipeTransport.
pub fn parse_json_event(line: &str) -> ChatEvent {
    let json: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return ChatEvent::Unknown,
    };

    let event_type = match json.get("type").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => return ChatEvent::Unknown,
    };

    match event_type {
        "thread.started" => json
            .get("thread_id")
            .and_then(|s| s.as_str())
            .map(|sid| ChatEvent::SessionId(sid.to_string()))
            .unwrap_or(ChatEvent::Unknown),
        "turn.started" => ChatEvent::TurnStarted,
        "turn.completed" => parse_codex_turn_completed(&json),
        "turn.failed" => ChatEvent::Complete,
        "item.started" | "item.completed" => parse_codex_item_event(event_type, &json),
        "system" => {
            if let Some(sid) = json
                .get("session_id")
                .or_else(|| json.get("conversation_id"))
                .and_then(|s| s.as_str())
            {
                ChatEvent::SessionId(sid.to_string())
            } else {
                ChatEvent::Unknown
            }
        }
        "stream_event" => json
            .get("event")
            .map(parse_stream_event)
            .unwrap_or(ChatEvent::Unknown),
        "user" => parse_user_event(&json),
        "assistant" => parse_assistant_event(&json),
        "content_block_start" => parse_content_block_start(&json),
        "content_block_delta" => parse_content_block_delta(&json),
        "content_block_stop" => ChatEvent::ThinkingContent {
            content: String::new(),
            is_complete: true,
        },
        "result" => parse_result_event(&json),
        _ => ChatEvent::Unknown,
    }
}

fn parse_codex_turn_completed(json: &serde_json::Value) -> ChatEvent {
    let mut usage = TokenUsage::default();
    if let Some(usage_obj) = json.get("usage") {
        usage.input_tokens = usage_obj
            .get("input_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        usage.output_tokens = usage_obj
            .get("output_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
    }

    if usage.input_tokens > 0 || usage.output_tokens > 0 {
        ChatEvent::Result(usage)
    } else {
        ChatEvent::Complete
    }
}

fn parse_codex_item_event(event_type: &str, json: &serde_json::Value) -> ChatEvent {
    let Some(item) = json.get("item") else {
        return ChatEvent::Unknown;
    };
    let item_id = item
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    match item.get("type").and_then(|v| v.as_str()) {
        Some("agent_message") if event_type == "item.completed" => item
            .get("text")
            .and_then(|v| v.as_str())
            .map(|text| ChatEvent::TextContent(text.to_string()))
            .unwrap_or(ChatEvent::Unknown),
        Some("command_execution") if event_type == "item.started" => {
            let command = item
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            ChatEvent::CommandStarted {
                id: item_id,
                command,
            }
        }
        Some("command_execution") if event_type == "item.completed" => {
            let output = item
                .get("aggregated_output")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            ChatEvent::CommandOutput {
                id: item_id,
                command: item
                    .get("command")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                output,
                exit_code: item
                    .get("exit_code")
                    .and_then(|v| v.as_i64())
                    .and_then(|v| i32::try_from(v).ok()),
            }
        }
        _ => ChatEvent::Unknown,
    }
}

fn parse_stream_event(event: &serde_json::Value) -> ChatEvent {
    match event.get("type").and_then(|t| t.as_str()) {
        Some("content_block_start") => parse_content_block_start(event),
        Some("content_block_delta") => parse_content_block_delta(event),
        Some("content_block_stop") => ChatEvent::ThinkingContent {
            content: String::new(),
            is_complete: true,
        },
        Some("message_stop") => ChatEvent::Complete,
        _ => ChatEvent::Unknown,
    }
}

fn parse_user_event(json: &serde_json::Value) -> ChatEvent {
    let Some(content) = json
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_array())
    else {
        return ChatEvent::Unknown;
    };

    for block in content {
        if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
            continue;
        }
        let id = block
            .get("tool_use_id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let content = block
            .get("content")
            .map(|v| {
                v.as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| v.to_string())
            })
            .unwrap_or_default();
        return ChatEvent::ToolUse {
            id,
            name: "tool_result".to_string(),
            input: Some(content),
            status: ToolStatus::Complete,
        };
    }

    ChatEvent::Unknown
}

fn parse_result_event(json: &serde_json::Value) -> ChatEvent {
    let mut usage = TokenUsage::default();

    if let Some(usage_obj) = json.get("usage") {
        usage.input_tokens = usage_obj
            .get("input_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        usage.output_tokens = usage_obj
            .get("output_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
    }

    usage.model = json
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if usage.input_tokens > 0 || usage.output_tokens > 0 {
        ChatEvent::Result(usage)
    } else {
        ChatEvent::Complete
    }
}

fn parse_assistant_event(json: &serde_json::Value) -> ChatEvent {
    if let Some(message) = json.get("message") {
        if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
            let mut text_parts = Vec::new();
            for block in content {
                if let Some(block_type) = block.get("type").and_then(|t| t.as_str()) {
                    match block_type {
                        "text" => {
                            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                text_parts.push(text.to_string());
                            }
                        }
                        "thinking" => {
                            if let Some(thinking) = block.get("thinking").and_then(|t| t.as_str()) {
                                return ChatEvent::ThinkingContent {
                                    content: thinking.to_string(),
                                    is_complete: false,
                                };
                            }
                        }
                        "tool_use" => {
                            let id = block
                                .get("id")
                                .and_then(|i| i.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let name = block
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let input = block.get("input").map(|i| i.to_string());
                            return ChatEvent::ToolUse {
                                id,
                                name,
                                input,
                                status: ToolStatus::Complete,
                            };
                        }
                        _ => {}
                    }
                }
            }
            if !text_parts.is_empty() {
                return ChatEvent::TextContent(text_parts.join(""));
            }
        }
    }
    ChatEvent::Unknown
}

fn parse_content_block_start(json: &serde_json::Value) -> ChatEvent {
    if let Some(content_block) = json.get("content_block") {
        if let Some(block_type) = content_block.get("type").and_then(|t| t.as_str()) {
            match block_type {
                "thinking" => {
                    return ChatEvent::ThinkingContent {
                        content: String::new(),
                        is_complete: false,
                    };
                }
                "tool_use" => {
                    let id = content_block
                        .get("id")
                        .and_then(|i| i.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let name = content_block
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    return ChatEvent::ToolUse {
                        id,
                        name,
                        input: None,
                        status: ToolStatus::Running,
                    };
                }
                _ => {}
            }
        }
    }
    ChatEvent::Unknown
}

fn parse_content_block_delta(json: &serde_json::Value) -> ChatEvent {
    if let Some(delta) = json.get("delta") {
        if let Some(delta_type) = delta.get("type").and_then(|t| t.as_str()) {
            match delta_type {
                "thinking_delta" => {
                    if let Some(thinking) = delta.get("thinking").and_then(|t| t.as_str()) {
                        return ChatEvent::ThinkingContent {
                            content: thinking.to_string(),
                            is_complete: false,
                        };
                    }
                }
                "text_delta" => {
                    if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                        return ChatEvent::TextContent(text.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    ChatEvent::Unknown
}

/// Spawn a stderr reader task that logs CLI errors.
///
/// Shared by PipeTransport and PtyTransport.
pub fn spawn_stderr_reader(stderr: tokio::process::ChildStderr, context_id: String) {
    use tokio::io::{AsyncBufReadExt, BufReader};

    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        while let Ok(n) = reader.read_line(&mut line).await {
            if n == 0 {
                break;
            }
            if line.contains("error") || line.contains("Error") {
                eprintln!("CLI stderr [{}]: {}", context_id, line.trim());
            }
            line.clear();
        }
    });
}

/// Encode bytes as base64 string.
///
/// Used by PtyTransport for terminal output encoding.
pub fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- base64 --

    #[test]
    fn test_base64_encode() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"a"), "YQ==");
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(b"abc"), "YWJj");
    }

    // -- JSON parsing --

    #[test]
    fn test_parse_system_event() {
        let json = r#"{"type":"system","session_id":"abc123"}"#;
        match parse_json_event(json) {
            ChatEvent::SessionId(id) => assert_eq!(id, "abc123"),
            _ => panic!("Expected SessionId event"),
        }
    }

    #[test]
    fn test_parse_system_event_conversation_id() {
        let json = r#"{"type":"system","conversation_id":"xyz789"}"#;
        match parse_json_event(json) {
            ChatEvent::SessionId(id) => assert_eq!(id, "xyz789"),
            _ => panic!("Expected SessionId event"),
        }
    }

    #[test]
    fn test_parse_assistant_event_text() {
        let json = r#"{
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "Hello, world!"}
                ]
            }
        }"#;
        match parse_json_event(json) {
            ChatEvent::TextContent(text) => assert_eq!(text, "Hello, world!"),
            _ => panic!("Expected TextContent event"),
        }
    }

    #[test]
    fn test_parse_assistant_event_multiple_text_blocks() {
        let json = r#"{
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "Part 1 "},
                    {"type": "text", "text": "Part 2"}
                ]
            }
        }"#;
        match parse_json_event(json) {
            ChatEvent::TextContent(text) => assert_eq!(text, "Part 1 Part 2"),
            _ => panic!("Expected TextContent event"),
        }
    }

    #[test]
    fn test_parse_assistant_event_thinking() {
        let json = r#"{
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "thinking", "thinking": "Let me think..."}
                ]
            }
        }"#;
        match parse_json_event(json) {
            ChatEvent::ThinkingContent {
                content,
                is_complete,
            } => {
                assert_eq!(content, "Let me think...");
                assert!(!is_complete);
            }
            _ => panic!("Expected ThinkingContent event"),
        }
    }

    #[test]
    fn test_parse_assistant_event_tool_use() {
        let json = r#"{
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "tool_use", "id": "tool_1", "name": "read_file", "input": {"path": "/test.txt"}}
                ]
            }
        }"#;
        match parse_json_event(json) {
            ChatEvent::ToolUse {
                id,
                name,
                input,
                status,
            } => {
                assert_eq!(id, "tool_1");
                assert_eq!(name, "read_file");
                assert!(input.is_some());
                assert_eq!(status, ToolStatus::Complete);
            }
            _ => panic!("Expected ToolUse event"),
        }
    }

    #[test]
    fn test_parse_content_block_start_thinking() {
        let json = r#"{
            "type": "content_block_start",
            "content_block": {"type": "thinking"}
        }"#;
        match parse_json_event(json) {
            ChatEvent::ThinkingContent {
                content,
                is_complete,
            } => {
                assert!(content.is_empty());
                assert!(!is_complete);
            }
            _ => panic!("Expected ThinkingContent event"),
        }
    }

    #[test]
    fn test_parse_content_block_start_tool_use() {
        let json = r#"{
            "type": "content_block_start",
            "content_block": {"type": "tool_use", "id": "tool_2", "name": "bash"}
        }"#;
        match parse_json_event(json) {
            ChatEvent::ToolUse {
                id, name, status, ..
            } => {
                assert_eq!(id, "tool_2");
                assert_eq!(name, "bash");
                assert_eq!(status, ToolStatus::Running);
            }
            _ => panic!("Expected ToolUse event"),
        }
    }

    #[test]
    fn test_parse_content_block_delta_text() {
        let json = r#"{
            "type": "content_block_delta",
            "delta": {"type": "text_delta", "text": "streaming text"}
        }"#;
        match parse_json_event(json) {
            ChatEvent::TextContent(text) => assert_eq!(text, "streaming text"),
            _ => panic!("Expected TextContent event"),
        }
    }

    #[test]
    fn test_parse_claude_stream_json_text_delta() {
        let json = r#"{
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": "semantic text"}
            }
        }"#;
        match parse_json_event(json) {
            ChatEvent::TextContent(text) => assert_eq!(text, "semantic text"),
            _ => panic!("Expected TextContent event from stream_event wrapper"),
        }
    }

    #[test]
    fn test_parse_claude_stream_json_thinking_and_tool_events() {
        let thinking = r#"{
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": {"type": "thinking_delta", "thinking": "plan"}
            }
        }"#;
        match parse_json_event(thinking) {
            ChatEvent::ThinkingContent {
                content,
                is_complete,
            } => {
                assert_eq!(content, "plan");
                assert!(!is_complete);
            }
            _ => panic!("Expected ThinkingContent event from stream_event wrapper"),
        }

        let tool = r#"{
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "content_block": {"type": "tool_use", "id": "toolu_1", "name": "Bash"}
            }
        }"#;
        match parse_json_event(tool) {
            ChatEvent::ToolUse {
                id, name, status, ..
            } => {
                assert_eq!(id, "toolu_1");
                assert_eq!(name, "Bash");
                assert_eq!(status, ToolStatus::Running);
            }
            _ => panic!("Expected ToolUse event from stream_event wrapper"),
        }
    }

    #[test]
    fn test_parse_codex_thread_and_turn_events() {
        let thread = r#"{"type":"thread.started","thread_id":"019e0622-647e"}"#;
        match parse_json_event(thread) {
            ChatEvent::SessionId(id) => assert_eq!(id, "019e0622-647e"),
            _ => panic!("Expected Codex thread id as SessionId"),
        }

        let turn = r#"{"type":"turn.started"}"#;
        match parse_json_event(turn) {
            ChatEvent::TurnStarted => {}
            _ => panic!("Expected TurnStarted"),
        }
    }

    #[test]
    fn test_parse_codex_agent_message() {
        let json = r#"{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"hello"}} "#;
        match parse_json_event(json) {
            ChatEvent::TextContent(text) => assert_eq!(text, "hello"),
            _ => panic!("Expected Codex agent_message as TextContent"),
        }
    }

    #[test]
    fn test_parse_codex_command_events() {
        let started = r#"{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"","exit_code":null,"status":"in_progress"}}"#;
        match parse_json_event(started) {
            ChatEvent::CommandStarted { id, command } => {
                assert_eq!(id, "item_0");
                assert_eq!(command, "/bin/zsh -lc pwd");
            }
            _ => panic!("Expected CommandStarted"),
        }

        let completed = r#"{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"/tmp/ws\n","exit_code":0,"status":"completed"}}"#;
        match parse_json_event(completed) {
            ChatEvent::CommandOutput {
                id,
                command,
                output,
                exit_code,
            } => {
                assert_eq!(id, "item_0");
                assert_eq!(command.as_deref(), Some("/bin/zsh -lc pwd"));
                assert_eq!(output, "/tmp/ws\n");
                assert_eq!(exit_code, Some(0));
            }
            _ => panic!("Expected CommandOutput"),
        }
    }

    #[test]
    fn test_parse_content_block_delta_thinking() {
        let json = r#"{
            "type": "content_block_delta",
            "delta": {"type": "thinking_delta", "thinking": "still thinking..."}
        }"#;
        match parse_json_event(json) {
            ChatEvent::ThinkingContent {
                content,
                is_complete,
            } => {
                assert_eq!(content, "still thinking...");
                assert!(!is_complete);
            }
            _ => panic!("Expected ThinkingContent event"),
        }
    }

    #[test]
    fn test_parse_content_block_stop() {
        let json = r#"{"type": "content_block_stop"}"#;
        match parse_json_event(json) {
            ChatEvent::ThinkingContent { is_complete, .. } => {
                assert!(is_complete);
            }
            _ => panic!("Expected ThinkingContent event with is_complete=true"),
        }
    }

    #[test]
    fn test_parse_result_event_no_usage() {
        let json = r#"{"type": "result"}"#;
        match parse_json_event(json) {
            ChatEvent::Complete => {}
            _ => panic!("Expected Complete event"),
        }
    }

    #[test]
    fn test_parse_result_event_with_usage() {
        let json = r#"{"type": "result", "model": "claude-sonnet-4-20250514", "usage": {"input_tokens": 1500, "output_tokens": 300}}"#;
        match parse_json_event(json) {
            ChatEvent::Result(usage) => {
                assert_eq!(usage.input_tokens, 1500);
                assert_eq!(usage.output_tokens, 300);
                assert_eq!(usage.model.as_deref(), Some("claude-sonnet-4-20250514"));
            }
            _ => panic!("Expected Result event with usage"),
        }
    }

    #[test]
    fn test_parse_result_event_with_zero_usage() {
        let json = r#"{"type": "result", "usage": {"input_tokens": 0, "output_tokens": 0}}"#;
        match parse_json_event(json) {
            ChatEvent::Complete => {}
            _ => panic!("Expected Complete event for zero usage"),
        }
    }

    #[test]
    fn test_parse_invalid_json() {
        let json = "not valid json";
        match parse_json_event(json) {
            ChatEvent::Unknown => {}
            _ => panic!("Expected Unknown event for invalid JSON"),
        }
    }

    #[test]
    fn test_parse_unknown_event_type() {
        let json = r#"{"type": "some_unknown_type"}"#;
        match parse_json_event(json) {
            ChatEvent::Unknown => {}
            _ => panic!("Expected Unknown event for unknown type"),
        }
    }
}
