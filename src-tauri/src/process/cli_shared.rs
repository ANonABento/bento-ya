//! Shared utilities for Claude CLI invocation.
//!
//! This module provides common functionality for spawning and communicating with
//! the Claude CLI subprocess. Both the orchestrator and agent panels use this
//! shared code to ensure consistent behavior.
//!
//! # Architecture
//!
//! The CLI is invoked with the message as a positional argument (not stdin):
//! ```text
//! claude --print --output-format stream-json --verbose \
//!        --model <model> --system-prompt <prompt> \
//!        [--resume <session_id>] "<message>"
//! ```
//!
//! This approach avoids hanging issues that occur with stdin-based input,
//! where the CLI waits for EOF that never comes in a subprocess context.
//!
//! # Event Types
//!
//! The CLI emits JSON events on stdout:
//! - `system`: Contains session_id for conversation continuity
//! - `assistant`: Contains the full response in `message.content[].text`
//! - `content_block_start/delta/stop`: Streaming events (when available)
//! - `result`: Final completion event
//!
//! # Conversation Continuity
//!
//! Each message spawns a fresh CLI process. Conversation history is maintained
//! via the `--resume <session_id>` flag, where session_id is captured from
//! the `system` event of the previous invocation.

use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdout, Command};
use tokio::time::timeout;

/// Timeout for reading a response from the CLI (5 minutes)
pub const MESSAGE_TIMEOUT: Duration = Duration::from_secs(300);

/// Result of parsing a CLI event
#[derive(Debug, Clone)]
pub enum CliEvent {
    /// Session ID captured from system event
    SessionId(String),
    /// Text content from assistant response
    TextContent(String),
    /// Thinking content (extended thinking mode)
    ThinkingContent { content: String, is_complete: bool },
    /// Tool use information
    ToolUse {
        id: String,
        name: String,
        input: Option<String>,
        status: ToolStatus,
    },
    /// Response is complete
    Complete,
    /// Unknown or unhandled event
    Unknown,
}

/// Status of a tool call
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolStatus {
    Running,
    Complete,
}

/// Configuration for spawning a CLI process
#[derive(Debug, Clone)]
pub struct CliConfig {
    pub cli_path: String,
    pub model: String,
    pub system_prompt: String,
    pub resume_id: Option<String>,
    pub working_dir: Option<String>,
    pub effort_level: Option<String>,
}

/// Build a CLI command with the given configuration and message
///
/// Returns a configured `Command` ready to spawn. The message is passed
/// as a positional argument, not via stdin.
pub fn build_cli_command(config: &CliConfig, message: &str) -> Command {
    let mut cmd = Command::new(&config.cli_path);

    cmd.arg("--print");
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");
    cmd.arg("--model").arg(&config.model);
    cmd.arg("--system-prompt").arg(&config.system_prompt);

    // Set effort level if specified (maps to CLI --effort flag)
    if let Some(ref effort) = config.effort_level {
        cmd.arg("--effort").arg(effort);
    }

    // Resume from previous session if available
    if let Some(ref id) = config.resume_id {
        cmd.arg("--resume").arg(id);
    }

    // Add message as positional argument (THE KEY FIX)
    cmd.arg(message);

    // Set working directory if specified and exists
    if let Some(ref dir) = config.working_dir {
        let path = std::path::Path::new(dir);
        if path.exists() && path.is_dir() {
            cmd.current_dir(dir);
        } else if let Ok(home) = std::env::var("HOME") {
            cmd.current_dir(home);
        }
    }

    // No stdin needed - message is in args
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    cmd
}

/// Spawn stderr reader that logs CLI errors
pub fn spawn_stderr_reader(child: &mut Child, context_id: String) {
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            while let Ok(n) = reader.read_line(&mut line).await {
                if n == 0 {
                    break;
                }
                eprintln!("[Rust] CLI stderr [{}]: {}", context_id, line.trim());
                line.clear();
            }
        });
    }
}

/// Parse a JSON line from CLI stdout into a CliEvent
pub fn parse_cli_event(line: &str) -> CliEvent {
    let json: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return CliEvent::Unknown,
    };

    let event_type = match json.get("type").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => return CliEvent::Unknown,
    };

    match event_type {
        "system" => {
            // Capture session ID from init event
            if let Some(sid) = json
                .get("session_id")
                .or_else(|| json.get("conversation_id"))
                .and_then(|s| s.as_str())
            {
                CliEvent::SessionId(sid.to_string())
            } else {
                CliEvent::Unknown
            }
        }
        "assistant" => {
            // Claude CLI sends full response in assistant event
            // Extract text from message.content[].text
            parse_assistant_event(&json)
        }
        "content_block_start" => parse_content_block_start(&json),
        "content_block_delta" => parse_content_block_delta(&json),
        "content_block_stop" => CliEvent::ThinkingContent {
            content: String::new(),
            is_complete: true,
        },
        "result" => {
            // Check if result contains text (fallback)
            if let Some(result_text) = json.get("result").and_then(|r| r.as_str()) {
                if !result_text.is_empty() {
                    return CliEvent::TextContent(result_text.to_string());
                }
            }
            CliEvent::Complete
        }
        _ => CliEvent::Unknown,
    }
}

fn parse_assistant_event(json: &serde_json::Value) -> CliEvent {
    if let Some(message) = json.get("message") {
        if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
            // Collect all text blocks
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
                                // Return thinking as a separate event
                                // (In practice, we prioritize text content)
                                return CliEvent::ThinkingContent {
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
                            return CliEvent::ToolUse {
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
                return CliEvent::TextContent(text_parts.join(""));
            }
        }
    }
    CliEvent::Unknown
}

fn parse_content_block_start(json: &serde_json::Value) -> CliEvent {
    if let Some(content_block) = json.get("content_block") {
        if let Some(block_type) = content_block.get("type").and_then(|t| t.as_str()) {
            match block_type {
                "thinking" => {
                    return CliEvent::ThinkingContent {
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
                    return CliEvent::ToolUse {
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
    CliEvent::Unknown
}

fn parse_content_block_delta(json: &serde_json::Value) -> CliEvent {
    if let Some(delta) = json.get("delta") {
        if let Some(delta_type) = delta.get("type").and_then(|t| t.as_str()) {
            match delta_type {
                "thinking_delta" => {
                    if let Some(thinking) = delta.get("thinking").and_then(|t| t.as_str()) {
                        return CliEvent::ThinkingContent {
                            content: thinking.to_string(),
                            is_complete: false,
                        };
                    }
                }
                "text_delta" => {
                    if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                        return CliEvent::TextContent(text.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    CliEvent::Unknown
}

/// Read CLI response with timeout, yielding events via callback
///
/// Returns (full_response, captured_session_id) on success.
pub async fn read_cli_response<F>(
    stdout: ChildStdout,
    initial_session_id: Option<String>,
    context_id: &str,
    mut on_event: F,
) -> Result<(String, Option<String>), String>
where
    F: FnMut(CliEvent),
{
    let mut reader = BufReader::new(stdout);
    let mut full_response = String::new();
    let mut captured_session_id = initial_session_id;

    loop {
        let mut line = String::new();
        let read_result = timeout(MESSAGE_TIMEOUT, reader.read_line(&mut line)).await;

        match read_result {
            Err(_) => {
                return Err("CLI response timed out after 5 minutes".to_string());
            }
            Ok(Err(e)) => {
                return Err(format!("Failed to read stdout: {}", e));
            }
            Ok(Ok(0)) => {
                // EOF - process ended
                eprintln!("[Rust] CLI [{}] - EOF reached", context_id);
                return Ok((full_response, captured_session_id));
            }
            Ok(Ok(_)) => {
                let event = parse_cli_event(&line);
                eprintln!("[Rust] CLI [{}] - event: {:?}", context_id, event_type_str(&event));

                match &event {
                    CliEvent::SessionId(sid) => {
                        captured_session_id = Some(sid.clone());
                    }
                    CliEvent::TextContent(text) => {
                        full_response.push_str(text);
                    }
                    CliEvent::Complete => {
                        on_event(event);
                        return Ok((full_response, captured_session_id));
                    }
                    _ => {}
                }

                on_event(event);
            }
        }
    }
}

fn event_type_str(event: &CliEvent) -> &'static str {
    match event {
        CliEvent::SessionId(_) => "session_id",
        CliEvent::TextContent(_) => "text_content",
        CliEvent::ThinkingContent { .. } => "thinking",
        CliEvent::ToolUse { .. } => "tool_use",
        CliEvent::Complete => "complete",
        CliEvent::Unknown => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_system_event() {
        let json = r#"{"type":"system","session_id":"abc123"}"#;
        match parse_cli_event(json) {
            CliEvent::SessionId(id) => assert_eq!(id, "abc123"),
            _ => panic!("Expected SessionId event"),
        }
    }

    #[test]
    fn test_parse_system_event_conversation_id() {
        let json = r#"{"type":"system","conversation_id":"xyz789"}"#;
        match parse_cli_event(json) {
            CliEvent::SessionId(id) => assert_eq!(id, "xyz789"),
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
        match parse_cli_event(json) {
            CliEvent::TextContent(text) => assert_eq!(text, "Hello, world!"),
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
        match parse_cli_event(json) {
            CliEvent::TextContent(text) => assert_eq!(text, "Part 1 Part 2"),
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
        match parse_cli_event(json) {
            CliEvent::ThinkingContent { content, is_complete } => {
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
        match parse_cli_event(json) {
            CliEvent::ToolUse { id, name, input, status } => {
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
        match parse_cli_event(json) {
            CliEvent::ThinkingContent { content, is_complete } => {
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
        match parse_cli_event(json) {
            CliEvent::ToolUse { id, name, status, .. } => {
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
        match parse_cli_event(json) {
            CliEvent::TextContent(text) => assert_eq!(text, "streaming text"),
            _ => panic!("Expected TextContent event"),
        }
    }

    #[test]
    fn test_parse_content_block_delta_thinking() {
        let json = r#"{
            "type": "content_block_delta",
            "delta": {"type": "thinking_delta", "thinking": "still thinking..."}
        }"#;
        match parse_cli_event(json) {
            CliEvent::ThinkingContent { content, is_complete } => {
                assert_eq!(content, "still thinking...");
                assert!(!is_complete);
            }
            _ => panic!("Expected ThinkingContent event"),
        }
    }

    #[test]
    fn test_parse_content_block_stop() {
        let json = r#"{"type": "content_block_stop"}"#;
        match parse_cli_event(json) {
            CliEvent::ThinkingContent { is_complete, .. } => {
                assert!(is_complete);
            }
            _ => panic!("Expected ThinkingContent event with is_complete=true"),
        }
    }

    #[test]
    fn test_parse_result_event() {
        let json = r#"{"type": "result"}"#;
        match parse_cli_event(json) {
            CliEvent::Complete => {}
            _ => panic!("Expected Complete event"),
        }
    }

    #[test]
    fn test_parse_result_event_with_text() {
        let json = r#"{"type": "result", "result": "Final answer"}"#;
        match parse_cli_event(json) {
            CliEvent::TextContent(text) => assert_eq!(text, "Final answer"),
            _ => panic!("Expected TextContent event"),
        }
    }

    #[test]
    fn test_parse_invalid_json() {
        let json = "not valid json";
        match parse_cli_event(json) {
            CliEvent::Unknown => {}
            _ => panic!("Expected Unknown event for invalid JSON"),
        }
    }

    #[test]
    fn test_parse_unknown_event_type() {
        let json = r#"{"type": "some_unknown_type"}"#;
        match parse_cli_event(json) {
            CliEvent::Unknown => {}
            _ => panic!("Expected Unknown event for unknown type"),
        }
    }

    #[test]
    fn test_build_cli_command_basic() {
        let config = CliConfig {
            cli_path: "/usr/bin/claude".to_string(),
            model: "sonnet".to_string(),
            system_prompt: "You are helpful".to_string(),
            resume_id: None,
            working_dir: None,
            effort_level: None,
        };

        // Just verify it doesn't panic
        let _cmd = build_cli_command(&config, "Hello");
    }

    #[test]
    fn test_build_cli_command_with_resume() {
        let config = CliConfig {
            cli_path: "/usr/bin/claude".to_string(),
            model: "opus".to_string(),
            system_prompt: "System prompt".to_string(),
            resume_id: Some("session-123".to_string()),
            working_dir: Some("/tmp".to_string()),
            effort_level: Some("high".to_string()),
        };

        // Just verify it doesn't panic
        let _cmd = build_cli_command(&config, "Test message");
    }
}
