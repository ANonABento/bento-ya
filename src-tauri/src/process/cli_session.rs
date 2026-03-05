//! Manages Claude CLI sessions for orchestrator conversations.
//!
//! With --print mode, each message spawns a new CLI process that exits after
//! responding. Multi-turn conversations use --resume with captured session IDs.

use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::commands::orchestrator::{StreamChunkPayload, ThinkingPayload, ToolCallPayload};

/// Stored session state (no running process, just metadata for resume)
struct CliSessionState {
    /// CLI session ID for --resume (captured from response)
    cli_session_id: Option<String>,
    /// Model to use for this session
    model: String,
    /// System prompt for this session
    system_prompt: String,
    /// CLI path
    cli_path: String,
    /// Whether we're currently processing a message
    is_busy: bool,
}

/// Manages Claude CLI sessions
pub struct CliSessionManager {
    /// Map of chat_session_id -> session state
    sessions: HashMap<String, CliSessionState>,
}

impl CliSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Check if a session exists
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

    /// Get the CLI session ID for resume
    pub fn get_cli_session_id(&self, session_id: &str) -> Option<String> {
        self.sessions
            .get(session_id)
            .and_then(|s| s.cli_session_id.clone())
    }

    /// Get the model for this session
    pub fn get_model(&self, session_id: &str) -> Option<&str> {
        self.sessions.get(session_id).map(|s| s.model.as_str())
    }

    /// Initialize or update session state (no process spawned yet)
    pub async fn spawn(
        &mut self,
        session_id: &str,
        cli_path: &str,
        model: &str,
        system_prompt: &str,
        resume_id: Option<&str>,
    ) -> Result<(), String> {
        // Store session state for future send_message calls
        let state = CliSessionState {
            cli_session_id: resume_id.map(|s| s.to_string()),
            model: model.to_string(),
            system_prompt: system_prompt.to_string(),
            cli_path: cli_path.to_string(),
            is_busy: false,
        };

        self.sessions.insert(session_id.to_string(), state);
        Ok(())
    }

    /// Send a message and stream the response
    /// With --print mode, this spawns a new CLI process for each message
    pub async fn send_message(
        &mut self,
        session_id: &str,
        message: &str,
        workspace_id: &str,
        app: &AppHandle,
    ) -> Result<(String, Option<String>), String> {
        let state = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| "Session not found".to_string())?;

        if state.is_busy {
            return Err("Session is busy".to_string());
        }

        state.is_busy = true;

        // Build command with --print mode (process handles one request and exits)
        let mut cmd = Command::new(&state.cli_path);
        cmd.arg("--print");
        cmd.arg("--output-format").arg("stream-json");
        cmd.arg("--verbose");
        cmd.arg("--model").arg(&state.model);
        cmd.arg("--system-prompt").arg(&state.system_prompt);

        // Resume from previous session if we have a CLI session ID
        if let Some(ref cli_sid) = state.cli_session_id {
            cmd.arg("--resume").arg(cli_sid);
        }

        // The message is passed as the positional prompt argument
        cmd.arg(message);

        // Set up stdio
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        // Spawn process
        let mut child = cmd
            .spawn()
            .map_err(|e| {
                state.is_busy = false;
                format!("Failed to spawn Claude CLI: {}", e)
            })?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| {
                state.is_busy = false;
                "Failed to capture stdout".to_string()
            })?;

        let stderr = child.stderr.take();

        // Read and process stdout
        let mut reader = BufReader::new(stdout);
        let mut full_response = String::new();
        let mut captured_session_id: Option<String> = state.cli_session_id.clone();

        loop {
            let mut line = String::new();
            match reader.read_line(&mut line).await {
                Err(e) => {
                    state.is_busy = false;
                    // Read stderr for more context
                    let stderr_msg = if let Some(mut se) = stderr {
                        let mut stderr_reader = BufReader::new(&mut se);
                        let mut stderr_content = String::new();
                        let _ = stderr_reader.read_line(&mut stderr_content).await;
                        stderr_content
                    } else {
                        String::new()
                    };
                    return Err(format!("Failed to read stdout: {}. Stderr: {}", e, stderr_msg));
                }
                Ok(0) => {
                    // EOF - process finished
                    // Wait for process to fully exit
                    let _ = child.wait().await;

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

                    // Update stored CLI session ID
                    if captured_session_id.is_some() {
                        state.cli_session_id = captured_session_id.clone();
                    }

                    state.is_busy = false;
                    return Ok((full_response, captured_session_id));
                }
                Ok(_) => {
                    // Successfully read a line - parse JSON
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
                                    // Final result event - capture full response if not already built
                                    if full_response.is_empty() {
                                        if let Some(result_text) =
                                            json.get("result").and_then(|r| r.as_str())
                                        {
                                            full_response = result_text.to_string();
                                        }
                                    }
                                    // Capture session_id if present in result
                                    if let Some(sid) = json
                                        .get("session_id")
                                        .and_then(|s| s.as_str())
                                    {
                                        captured_session_id = Some(sid.to_string());
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
    }

    /// Remove session state (no running process to kill with --print mode)
    pub async fn kill(&mut self, session_id: &str) {
        self.sessions.remove(session_id);
    }

    /// Remove all session states
    pub async fn kill_all(&mut self) {
        self.sessions.clear();
    }

    /// Check if session state exists (always "alive" with --print mode since no persistent process)
    pub fn is_alive(&mut self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
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
