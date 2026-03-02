//! Manages persistent Claude CLI sessions for orchestrator conversations.
//!
//! Each chat session can have a running Claude CLI process. Messages are sent
//! via stdin and responses read via stdout. If the process dies, we fall back
//! to --resume with the captured session ID.

use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::commands::orchestrator::{StreamChunkPayload, ThinkingPayload, ToolCallPayload};

/// A running Claude CLI session
struct CliSession {
    /// The running child process
    process: Child,
    /// Stdin handle for sending messages
    stdin: ChildStdin,
    /// Stdout reader for receiving responses
    stdout: BufReader<ChildStdout>,
    /// CLI session ID for resume fallback (captured from first response)
    cli_session_id: Option<String>,
    /// Whether we're currently processing a message
    is_busy: bool,
}

/// Manages persistent Claude CLI sessions
pub struct CliSessionManager {
    /// Map of chat_session_id -> CliSession
    sessions: HashMap<String, CliSession>,
}

impl CliSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Check if a session has a running process
    pub fn has_session(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    /// Check if session is busy processing
    pub fn is_busy(&self, session_id: &str) -> bool {
        self.sessions
            .get(session_id)
            .map(|s| s.is_busy)
            .unwrap_or(false)
    }

    /// Get the CLI session ID for resume fallback
    pub fn get_cli_session_id(&self, session_id: &str) -> Option<String> {
        self.sessions
            .get(session_id)
            .and_then(|s| s.cli_session_id.clone())
    }

    /// Spawn a new Claude CLI process for a session
    pub async fn spawn(
        &mut self,
        session_id: &str,
        cli_path: &str,
        model: &str,
        system_prompt: &str,
        resume_id: Option<&str>,
    ) -> Result<(), String> {
        // Kill existing session if any
        self.kill(session_id).await;

        // Build command
        let mut cmd = Command::new(cli_path);
        cmd.arg("--output-format").arg("stream-json");
        cmd.arg("--model").arg(model);
        cmd.arg("--system-prompt").arg(system_prompt);
        cmd.arg("--verbose");

        // Resume from previous session if available
        if let Some(id) = resume_id {
            cmd.arg("--resume").arg(id);
        }

        // Set up stdio
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::null());

        // Spawn process
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn Claude CLI: {}", e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture stdin".to_string())?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;

        let session = CliSession {
            process: child,
            stdin,
            stdout: BufReader::new(stdout),
            cli_session_id: resume_id.map(|s| s.to_string()),
            is_busy: false,
        };

        self.sessions.insert(session_id.to_string(), session);
        Ok(())
    }

    /// Send a message and stream the response
    pub async fn send_message(
        &mut self,
        session_id: &str,
        message: &str,
        workspace_id: &str,
        app: &AppHandle,
    ) -> Result<(String, Option<String>), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| "Session not found".to_string())?;

        if session.is_busy {
            return Err("Session is busy".to_string());
        }

        session.is_busy = true;

        // Send message to stdin (with newline to submit)
        let msg_with_newline = format!("{}\n", message);
        if let Err(e) = session.stdin.write_all(msg_with_newline.as_bytes()).await {
            session.is_busy = false;
            return Err(format!("Failed to write to stdin: {}", e));
        }

        if let Err(e) = session.stdin.flush().await {
            session.is_busy = false;
            return Err(format!("Failed to flush stdin: {}", e));
        }

        // Read response until we get a result event or the process signals ready for next input
        let mut full_response = String::new();
        let mut captured_session_id: Option<String> = session.cli_session_id.clone();

        loop {
            let mut line = String::new();
            match session.stdout.read_line(&mut line).await {
                Ok(0) => {
                    // EOF - process ended
                    session.is_busy = false;
                    return Err("Process ended unexpectedly".to_string());
                }
                Ok(_) => {
                    // Try to parse as JSON
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(event_type) = json.get("type").and_then(|t| t.as_str()) {
                            match event_type {
                                "system" => {
                                    // Capture session ID from init event
                                    if let Some(sid) = json
                                        .get("session_id")
                                        .or_else(|| json.get("conversation_id"))
                                        .and_then(|s| s.as_str())
                                    {
                                        captured_session_id = Some(sid.to_string());
                                        session.cli_session_id = Some(sid.to_string());
                                    }
                                }
                                "content_block_start" => {
                                    if let Some(content_block) = json.get("content_block") {
                                        if let Some(block_type) =
                                            content_block.get("type").and_then(|t| t.as_str())
                                        {
                                            if block_type == "thinking" {
                                                let _ = app.emit(
                                                    "orchestrator:thinking",
                                                    &ThinkingPayload {
                                                        workspace_id: workspace_id.to_string(),
                                                        content: String::new(),
                                                        is_complete: false,
                                                    },
                                                );
                                            } else if block_type == "tool_use" {
                                                let tool_id = content_block
                                                    .get("id")
                                                    .and_then(|i| i.as_str())
                                                    .unwrap_or("unknown")
                                                    .to_string();
                                                let tool_name = content_block
                                                    .get("name")
                                                    .and_then(|n| n.as_str())
                                                    .unwrap_or("unknown")
                                                    .to_string();
                                                let _ = app.emit(
                                                    "orchestrator:tool_call",
                                                    &ToolCallPayload {
                                                        workspace_id: workspace_id.to_string(),
                                                        tool_id,
                                                        tool_name,
                                                        status: "running".to_string(),
                                                        input: None,
                                                        result: None,
                                                    },
                                                );
                                            }
                                        }
                                    }
                                }
                                "content_block_delta" => {
                                    if let Some(delta) = json.get("delta") {
                                        if let Some(delta_type) =
                                            delta.get("type").and_then(|t| t.as_str())
                                        {
                                            match delta_type {
                                                "thinking_delta" => {
                                                    if let Some(thinking) =
                                                        delta.get("thinking").and_then(|t| t.as_str())
                                                    {
                                                        let _ = app.emit(
                                                            "orchestrator:thinking",
                                                            &ThinkingPayload {
                                                                workspace_id: workspace_id.to_string(),
                                                                content: thinking.to_string(),
                                                                is_complete: false,
                                                            },
                                                        );
                                                    }
                                                }
                                                "text_delta" => {
                                                    if let Some(text) =
                                                        delta.get("text").and_then(|t| t.as_str())
                                                    {
                                                        full_response.push_str(text);
                                                        let _ = app.emit(
                                                            "orchestrator:stream",
                                                            &StreamChunkPayload {
                                                                workspace_id: workspace_id.to_string(),
                                                                delta: text.to_string(),
                                                                finish_reason: None,
                                                                tool_use: None,
                                                            },
                                                        );
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                }
                                "content_block_stop" => {
                                    let _ = app.emit(
                                        "orchestrator:thinking",
                                        &ThinkingPayload {
                                            workspace_id: workspace_id.to_string(),
                                            content: String::new(),
                                            is_complete: true,
                                        },
                                    );
                                }
                                "result" => {
                                    // Final result - response complete
                                    if full_response.is_empty() {
                                        if let Some(result_text) =
                                            json.get("result").and_then(|r| r.as_str())
                                        {
                                            full_response = result_text.to_string();
                                        }
                                    }
                                    // Send finish event
                                    let _ = app.emit(
                                        "orchestrator:stream",
                                        &StreamChunkPayload {
                                            workspace_id: workspace_id.to_string(),
                                            delta: String::new(),
                                            finish_reason: Some("stop".to_string()),
                                            tool_use: None,
                                        },
                                    );
                                    session.is_busy = false;
                                    return Ok((full_response, captured_session_id));
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Err(e) => {
                    session.is_busy = false;
                    return Err(format!("Failed to read stdout: {}", e));
                }
            }
        }
    }

    /// Kill a session's process
    pub async fn kill(&mut self, session_id: &str) {
        if let Some(mut session) = self.sessions.remove(session_id) {
            let _ = session.process.kill().await;
        }
    }

    /// Kill all sessions
    pub async fn kill_all(&mut self) {
        let session_ids: Vec<String> = self.sessions.keys().cloned().collect();
        for session_id in session_ids {
            self.kill(&session_id).await;
        }
    }

    /// Check if process is still alive (removes dead sessions from map)
    pub fn is_alive(&mut self, session_id: &str) -> bool {
        let is_dead = if let Some(session) = self.sessions.get_mut(session_id) {
            // Try to check process status without blocking
            match session.process.try_wait() {
                Ok(None) => None,       // Still running
                Ok(Some(_)) => Some(()), // Exited
                Err(_) => Some(()),      // Error checking - assume dead
            }
        } else {
            return false; // No session
        };

        if is_dead.is_some() {
            // Process exited - remove from map to prevent stale entries
            self.sessions.remove(session_id);
            false
        } else {
            true
        }
    }
}

impl Default for CliSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Thread-safe wrapper for CliSessionManager
pub type SharedCliSessionManager = Arc<Mutex<CliSessionManager>>;

pub fn new_shared_cli_session_manager() -> SharedCliSessionManager {
    Arc::new(Mutex::new(CliSessionManager::new()))
}
