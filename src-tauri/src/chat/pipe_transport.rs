//! Pipe-based transport for structured CLI sessions.
//!
//! Spawns `claude --print --output-format stream-json --verbose` with the message
//! as a positional argument. Parses JSON events from stdout into `ChatEvent` types.
//!
//! Non-interactive: each message spawns a fresh process. Conversation continuity
//! via `--resume <session_id>`.

use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::time::timeout;

use super::events::{ChatEvent, ToolStatus};
use super::transport::{ChatTransport, SpawnConfig, TransportEvent};

/// Timeout for reading a response from the CLI (5 minutes)
const MESSAGE_TIMEOUT: Duration = Duration::from_secs(300);

/// Pipe transport — structured JSON streaming via CLI.
///
/// Each `spawn()` starts a new CLI process. The message must be included
/// in the args of the SpawnConfig (as the last positional argument).
pub struct PipeTransport {
    /// Handle to the running child process (for kill)
    child: Option<tokio::process::Child>,
    /// Whether the process is still alive
    alive: bool,
}

impl PipeTransport {
    pub fn new() -> Self {
        Self {
            child: None,
            alive: false,
        }
    }
}

impl ChatTransport for PipeTransport {
    fn spawn(&mut self, config: SpawnConfig) -> Result<mpsc::Receiver<TransportEvent>, String> {
        let mut cmd = Command::new(&config.command);

        for arg in &config.args {
            cmd.arg(arg);
        }

        // Set working directory if specified and exists
        if let Some(ref dir) = config.working_dir {
            let path = std::path::Path::new(dir);
            if path.exists() && path.is_dir() {
                cmd.current_dir(dir);
            } else if let Ok(home) = std::env::var("HOME") {
                cmd.current_dir(home);
            }
        }

        if let Some(ref vars) = config.env_vars {
            for (key, value) in vars {
                cmd.env(key, value);
            }
        }

        // No stdin needed - message is in args
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn CLI: {}", e))?;

        self.alive = true;

        // Spawn stderr reader
        if let Some(stderr) = child.stderr.take() {
            let context = config.command.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                while let Ok(n) = reader.read_line(&mut line).await {
                    if n == 0 {
                        break;
                    }
                    if line.contains("error") || line.contains("Error") {
                        eprintln!("CLI stderr [{}]: {}", context, line.trim());
                    }
                    line.clear();
                }
            });
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;

        self.child = Some(child);

        let (event_tx, event_rx) = mpsc::channel::<TransportEvent>(256);

        // Async reader task: parse JSON lines and emit events
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut full_response = String::new();

            loop {
                let mut line = String::new();
                let read_result = timeout(MESSAGE_TIMEOUT, reader.read_line(&mut line)).await;

                match read_result {
                    Err(_) => {
                        let _ = event_tx
                            .send(TransportEvent::Chat(ChatEvent::Error(
                                "CLI response timed out after 5 minutes".to_string(),
                            )))
                            .await;
                        break;
                    }
                    Ok(Err(e)) => {
                        let _ = event_tx
                            .send(TransportEvent::Chat(ChatEvent::Error(format!(
                                "Failed to read stdout: {}",
                                e
                            ))))
                            .await;
                        break;
                    }
                    Ok(Ok(0)) => {
                        // EOF — process ended
                        let _ = event_tx.send(TransportEvent::Exited(None)).await;
                        break;
                    }
                    Ok(Ok(_)) => {
                        // Skip assistant events to avoid double-counting with streaming deltas
                        let is_assistant_event = line.contains("\"type\":\"assistant\"")
                            || line.contains("\"type\": \"assistant\"");

                        if is_assistant_event {
                            let event = parse_cli_event(&line);
                            if let ChatEvent::TextContent(text) = &event {
                                if full_response.is_empty() {
                                    full_response = text.clone();
                                    let _ = event_tx
                                        .send(TransportEvent::Chat(event))
                                        .await;
                                }
                            }
                            continue;
                        }

                        let event = parse_cli_event(&line);

                        match &event {
                            ChatEvent::TextContent(text) => {
                                full_response.push_str(text);
                            }
                            ChatEvent::Complete => {
                                let _ = event_tx
                                    .send(TransportEvent::Chat(event))
                                    .await;
                                let _ = event_tx.send(TransportEvent::Exited(Some(0))).await;
                                break;
                            }
                            _ => {}
                        }

                        let _ = event_tx.send(TransportEvent::Chat(event)).await;
                    }
                }
            }
        });

        Ok(event_rx)
    }

    fn write(&mut self, _data: &[u8]) -> Result<(), String> {
        // Pipe transport is non-interactive — message is passed as CLI arg.
        // Write is a no-op.
        Ok(())
    }

    fn resize(&mut self, _cols: u16, _rows: u16) -> Result<(), String> {
        // No terminal to resize
        Ok(())
    }

    fn kill(&mut self) -> Result<(), String> {
        if let Some(ref mut child) = self.child {
            // Try graceful kill first
            let _ = child.start_kill();
        }
        self.child = None;
        self.alive = false;
        Ok(())
    }

    fn is_alive(&self) -> bool {
        self.alive
    }

    fn pid(&self) -> Option<u32> {
        self.child.as_ref().and_then(|c| c.id())
    }
}

impl Default for PipeTransport {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// CLI JSON event parsing (extracted from cli_shared.rs)
// ============================================================================

/// Parse a JSON line from CLI stdout into a ChatEvent.
pub fn parse_cli_event(line: &str) -> ChatEvent {
    let json: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return ChatEvent::Unknown,
    };

    let event_type = match json.get("type").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => return ChatEvent::Unknown,
    };

    match event_type {
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
        "assistant" => parse_assistant_event(&json),
        "content_block_start" => parse_content_block_start(&json),
        "content_block_delta" => parse_content_block_delta(&json),
        "content_block_stop" => ChatEvent::ThinkingContent {
            content: String::new(),
            is_complete: true,
        },
        "result" => ChatEvent::Complete,
        _ => ChatEvent::Unknown,
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
                            if let Some(thinking) =
                                block.get("thinking").and_then(|t| t.as_str())
                            {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_system_event() {
        let json = r#"{"type":"system","session_id":"abc123"}"#;
        match parse_cli_event(json) {
            ChatEvent::SessionId(id) => assert_eq!(id, "abc123"),
            _ => panic!("Expected SessionId event"),
        }
    }

    #[test]
    fn test_parse_system_event_conversation_id() {
        let json = r#"{"type":"system","conversation_id":"xyz789"}"#;
        match parse_cli_event(json) {
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
        match parse_cli_event(json) {
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
        match parse_cli_event(json) {
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
        match parse_cli_event(json) {
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
        match parse_cli_event(json) {
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
        match parse_cli_event(json) {
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
        match parse_cli_event(json) {
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
        match parse_cli_event(json) {
            ChatEvent::TextContent(text) => assert_eq!(text, "streaming text"),
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
        match parse_cli_event(json) {
            ChatEvent::ThinkingContent { is_complete, .. } => {
                assert!(is_complete);
            }
            _ => panic!("Expected ThinkingContent event with is_complete=true"),
        }
    }

    #[test]
    fn test_parse_result_event() {
        let json = r#"{"type": "result"}"#;
        match parse_cli_event(json) {
            ChatEvent::Complete => {}
            _ => panic!("Expected Complete event"),
        }
    }

    #[test]
    fn test_parse_result_event_with_text() {
        let json = r#"{"type": "result", "result": "Final answer"}"#;
        match parse_cli_event(json) {
            ChatEvent::Complete => {}
            _ => panic!("Expected Complete event"),
        }
    }

    #[test]
    fn test_parse_invalid_json() {
        let json = "not valid json";
        match parse_cli_event(json) {
            ChatEvent::Unknown => {}
            _ => panic!("Expected Unknown event for invalid JSON"),
        }
    }

    #[test]
    fn test_parse_unknown_event_type() {
        let json = r#"{"type": "some_unknown_type"}"#;
        match parse_cli_event(json) {
            ChatEvent::Unknown => {}
            _ => panic!("Expected Unknown event for unknown type"),
        }
    }

    #[test]
    fn test_pipe_transport_new() {
        let transport = PipeTransport::new();
        assert!(!transport.is_alive());
        assert!(transport.pid().is_none());
    }
}
