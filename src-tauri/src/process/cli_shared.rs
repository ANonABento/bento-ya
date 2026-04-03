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
//!
//! # Migration Note
//!
//! JSON parsing and stderr reading are delegated to `chat::events` (the single
//! source of truth). `CliEvent` wraps `ChatEvent` via `From` conversion.
//! This module will be removed in Phase 6 of the unified chat migration.

use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdout, Command};
use tokio::time::timeout;

use crate::chat::events::{
    self,
    ChatEvent,
    ToolStatus as ChatToolStatus,
};

/// Timeout for reading a response from the CLI (5 minutes)
pub const MESSAGE_TIMEOUT: Duration = Duration::from_secs(300);

/// Result of parsing a CLI event.
///
/// Legacy type — wraps `ChatEvent` from the unified chat module.
/// Kept for backward compatibility with `cli_session.rs` and `agent_cli_session.rs`.
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

/// Convert from unified ChatEvent to legacy CliEvent
impl From<ChatEvent> for CliEvent {
    fn from(event: ChatEvent) -> Self {
        match event {
            ChatEvent::SessionId(s) => CliEvent::SessionId(s),
            ChatEvent::TextContent(s) => CliEvent::TextContent(s),
            ChatEvent::ThinkingContent { content, is_complete } => {
                CliEvent::ThinkingContent { content, is_complete }
            }
            ChatEvent::ToolUse { id, name, input, status } => CliEvent::ToolUse {
                id,
                name,
                input,
                status: match status {
                    ChatToolStatus::Running => ToolStatus::Running,
                    ChatToolStatus::Complete => ToolStatus::Complete,
                },
            },
            ChatEvent::Complete => CliEvent::Complete,
            ChatEvent::RawOutput(_) | ChatEvent::Unknown => CliEvent::Unknown,
        }
    }
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

/// Spawn stderr reader that logs CLI errors.
///
/// Delegates to `chat::events::spawn_stderr_reader`.
pub fn spawn_stderr_reader(child: &mut Child, context_id: String) {
    if let Some(stderr) = child.stderr.take() {
        events::spawn_stderr_reader(stderr, context_id);
    }
}

/// Parse a JSON line from CLI stdout into a CliEvent.
///
/// Delegates to `chat::events::parse_json_event` and converts to legacy type.
pub fn parse_cli_event(line: &str) -> CliEvent {
    events::parse_json_event(line).into()
}

/// Read CLI response with timeout, yielding events via callback
///
/// Returns (full_response, captured_session_id) on success.
pub async fn read_cli_response<F>(
    stdout: ChildStdout,
    initial_session_id: Option<String>,
    _context_id: &str,
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
                return Ok((full_response, captured_session_id));
            }
            Ok(Ok(_)) => {
                // The CLI emits text in two ways:
                //   1. "content_block_delta" with text_delta — streaming chunks (for UI)
                //   2. "assistant" with full message.content — complete response (for DB)
                // We use streaming deltas for both UI (on_event) and full_response
                // accumulation. The "assistant" event is skipped entirely to avoid
                // double-counting.
                let is_assistant_event = line.contains("\"type\":\"assistant\"")
                    || line.contains("\"type\": \"assistant\"");

                if is_assistant_event {
                    // Parse only to extract session_id or other metadata, but don't
                    // emit text to frontend — streaming deltas already covered it.
                    // If full_response is empty (no streaming deltas were received),
                    // use the assistant event as fallback.
                    let event = parse_cli_event(&line);
                    if let CliEvent::TextContent(text) = &event {
                        if full_response.is_empty() {
                            full_response = text.clone();
                            // Emit to frontend as fallback (non-streaming CLI)
                            on_event(event);
                        }
                        // Otherwise skip — streaming deltas already sent to frontend
                    }
                    continue;
                }

                let event = parse_cli_event(&line);

                match &event {
                    CliEvent::SessionId(sid) => {
                        captured_session_id = Some(sid.clone());
                    }
                    CliEvent::TextContent(text) => {
                        // Streaming delta — accumulate for DB storage
                        full_response.push_str(text);
                    }
                    CliEvent::Complete => {
                        on_event(event);
                        return Ok((full_response, captured_session_id));
                    }
                    _ => {}
                }

                // Forward to frontend for streaming UI
                on_event(event);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Parsing tests live in chat::events::tests (single source of truth).
    // These tests verify the CliEvent conversion layer and command building.

    #[test]
    fn test_cli_event_from_chat_event() {
        // Verify From<ChatEvent> conversion works for each variant
        let session = ChatEvent::SessionId("abc".to_string());
        assert!(matches!(CliEvent::from(session), CliEvent::SessionId(s) if s == "abc"));

        let text = ChatEvent::TextContent("hello".to_string());
        assert!(matches!(CliEvent::from(text), CliEvent::TextContent(s) if s == "hello"));

        let complete = ChatEvent::Complete;
        assert!(matches!(CliEvent::from(complete), CliEvent::Complete));

        let unknown = ChatEvent::Unknown;
        assert!(matches!(CliEvent::from(unknown), CliEvent::Unknown));

        // RawOutput (PTY-only) maps to Unknown
        let raw = ChatEvent::RawOutput("base64data".to_string());
        assert!(matches!(CliEvent::from(raw), CliEvent::Unknown));
    }

    #[test]
    fn test_parse_cli_event_delegates_to_chat() {
        // Verify that cli_shared::parse_cli_event produces the same results
        // as chat::events::parse_json_event (just wrapped in CliEvent)
        let json = r#"{"type":"system","session_id":"abc123"}"#;
        match parse_cli_event(json) {
            CliEvent::SessionId(id) => assert_eq!(id, "abc123"),
            _ => panic!("Expected SessionId event"),
        }

        let json = r#"{"type": "result"}"#;
        assert!(matches!(parse_cli_event(json), CliEvent::Complete));

        let json = "not valid json";
        assert!(matches!(parse_cli_event(json), CliEvent::Unknown));
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
