//! Manages Claude CLI sessions for agent task execution.
//!
//! Similar to cli_session.rs but for agents working on specific tasks.
//! Uses --print mode with JSON streaming, supports --resume for multi-turn.

use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Event payloads for agent streaming
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamPayload {
    pub task_id: String,
    pub delta: String,
    pub finish_reason: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentThinkingPayload {
    pub task_id: String,
    pub content: String,
    pub is_complete: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCallPayload {
    pub task_id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusPayload {
    pub task_id: String,
    pub status: String,
    pub message: Option<String>,
}

/// Stored session state (no running process, just metadata for resume)
struct AgentSessionState {
    /// CLI session ID for --resume (captured from response)
    cli_session_id: Option<String>,
    /// Working directory for the agent
    working_dir: String,
    /// CLI path
    cli_path: String,
    /// Model to use (e.g., "sonnet", "opus", "haiku")
    model: String,
    /// Effort level for adaptive thinking ("default", "low", "medium", "high")
    effort_level: String,
    /// Whether we're currently processing a message
    is_busy: bool,
}

/// Manages Claude CLI sessions for agents
pub struct AgentSessionManager {
    /// Map of task_id -> session state
    sessions: HashMap<String, AgentSessionState>,
}

impl AgentSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Check if a session exists for a task
    pub fn has_session(&self, task_id: &str) -> bool {
        self.sessions.contains_key(task_id)
    }

    /// Check if an agent is currently processing
    pub fn is_busy(&self, task_id: &str) -> bool {
        self.sessions
            .get(task_id)
            .map(|s| s.is_busy)
            .unwrap_or(false)
    }

    /// Get the CLI session ID for resume
    pub fn get_cli_session_id(&self, task_id: &str) -> Option<String> {
        self.sessions
            .get(task_id)
            .and_then(|s| s.cli_session_id.clone())
    }

    /// Initialize or update session state
    pub fn init_session(
        &mut self,
        task_id: &str,
        working_dir: &str,
        cli_path: &str,
        resume_id: Option<&str>,
    ) {
        let existing_cli_id = self
            .sessions
            .get(task_id)
            .and_then(|s| s.cli_session_id.clone());

        self.sessions.insert(
            task_id.to_string(),
            AgentSessionState {
                cli_session_id: resume_id.map(|s| s.to_string()).or(existing_cli_id),
                working_dir: working_dir.to_string(),
                cli_path: cli_path.to_string(),
                model: "sonnet".to_string(),
                effort_level: "default".to_string(),
                is_busy: false,
            },
        );
    }

    /// Send a message to the agent and stream the response
    pub async fn send_message<R: tauri::Runtime>(
        &mut self,
        task_id: &str,
        message: &str,
        model: Option<&str>,
        effort_level: Option<&str>,
        app: &AppHandle<R>,
    ) -> Result<String, String> {
        let state = self
            .sessions
            .get_mut(task_id)
            .ok_or_else(|| format!("No session for task: {}", task_id))?;

        if state.is_busy {
            return Err("Agent is busy processing another message".to_string());
        }

        // Update model and effort level if provided
        if let Some(m) = model {
            state.model = m.to_string();
        }
        if let Some(effort) = effort_level {
            state.effort_level = effort.to_string();
        }

        state.is_busy = true;

        // Emit processing event
        let _ = app.emit(
            "agent:processing",
            AgentStatusPayload {
                task_id: task_id.to_string(),
                status: "processing".to_string(),
                message: None,
            },
        );

        // Build CLI command
        let mut cmd = Command::new(&state.cli_path);
        cmd.arg("--print");
        cmd.arg("--output-format").arg("stream-json");
        cmd.arg("--verbose");
        cmd.arg("--model").arg(&state.model);

        // Set effort level via environment variable (Claude uses CLAUDE_CODE_EFFORT_LEVEL)
        // For non-default effort, set the env var
        if state.effort_level != "default" {
            // Map our effort levels to Claude's supported values (low/medium/high)
            let claude_effort = match state.effort_level.as_str() {
                "minimal" => "low", // Claude doesn't have minimal, use low
                "xhigh" => "high",  // Claude doesn't have xhigh, use high
                other => other,     // low/medium/high pass through
            };
            cmd.env("CLAUDE_CODE_EFFORT_LEVEL", claude_effort);
        }

        // Resume if we have a session ID
        if let Some(ref cli_sid) = state.cli_session_id {
            cmd.arg("--resume").arg(cli_sid);
        }

        // Set working directory
        cmd.current_dir(&state.working_dir);

        // Message as positional argument
        cmd.arg(message);

        // Capture stdout/stderr
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn CLI: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture stderr".to_string())?;

        let mut stdout_reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();

        let mut full_response = String::new();
        let mut captured_session_id: Option<String> = None;
        let task_id_owned = task_id.to_string();

        // Spawn stderr reader task
        let app_clone = app.clone();
        let task_id_clone = task_id_owned.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                // Skip most stderr lines (CLI is verbose) but catch errors

                // Emit debug info for important messages
                if line.contains("error") || line.contains("Error") {
                    let _ = app_clone.emit(
                        "agent:error",
                        AgentStatusPayload {
                            task_id: task_id_clone.clone(),
                            status: "error".to_string(),
                            message: Some(line),
                        },
                    );
                }
            }
        });

        // Process stdout JSON events
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            // Parse JSON event
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");

                match event_type {
                    "system" => {
                        // Capture session ID for resume
                        if let Some(sid) = event.get("session_id").and_then(|s| s.as_str()) {
                            captured_session_id = Some(sid.to_string());
                        }
                    }
                    "content_block_start" => {
                        // Check for thinking or tool use
                        if let Some(cb) = event.get("content_block") {
                            let cb_type = cb.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if cb_type == "thinking" {
                                let _ = app.emit(
                                    "agent:thinking",
                                    AgentThinkingPayload {
                                        task_id: task_id_owned.clone(),
                                        content: String::new(),
                                        is_complete: false,
                                    },
                                );
                            } else if cb_type == "tool_use" {
                                let tool_name = cb.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                                let tool_id = cb.get("id").and_then(|i| i.as_str()).unwrap_or("");
                                let _ = app.emit(
                                    "agent:tool_call",
                                    AgentToolCallPayload {
                                        task_id: task_id_owned.clone(),
                                        tool_id: tool_id.to_string(),
                                        tool_name: tool_name.to_string(),
                                        status: "running".to_string(),
                                    },
                                );
                            }
                        }
                    }
                    "content_block_delta" => {
                        if let Some(delta) = event.get("delta") {
                            let delta_type = delta.get("type").and_then(|t| t.as_str()).unwrap_or("");

                            if delta_type == "text_delta" {
                                if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                    full_response.push_str(text);
                                    let _ = app.emit(
                                        "agent:stream",
                                        AgentStreamPayload {
                                            task_id: task_id_owned.clone(),
                                            delta: text.to_string(),
                                            finish_reason: None,
                                        },
                                    );
                                }
                            } else if delta_type == "thinking_delta" {
                                if let Some(thinking) = delta.get("thinking").and_then(|t| t.as_str()) {
                                    let _ = app.emit(
                                        "agent:thinking",
                                        AgentThinkingPayload {
                                            task_id: task_id_owned.clone(),
                                            content: thinking.to_string(),
                                            is_complete: false,
                                        },
                                    );
                                }
                            }
                        }
                    }
                    "content_block_stop" => {
                        // Mark thinking complete if it was a thinking block
                        let _ = app.emit(
                            "agent:thinking",
                            AgentThinkingPayload {
                                task_id: task_id_owned.clone(),
                                content: String::new(),
                                is_complete: true,
                            },
                        );
                    }
                    "message_stop" | "result" => {
                        // Message complete
                        if let Some(sid) = event.get("session_id").and_then(|s| s.as_str()) {
                            captured_session_id = Some(sid.to_string());
                        }

                        let _ = app.emit(
                            "agent:stream",
                            AgentStreamPayload {
                                task_id: task_id_owned.clone(),
                                delta: String::new(),
                                finish_reason: Some("end_turn".to_string()),
                            },
                        );
                    }
                    _ => {
                        // Other event types (e.g., message_start, ping) - ignore
                    }
                }
            }
        }

        // Wait for process to exit
        let status = child
            .wait()
            .await
            .map_err(|e| format!("Failed to wait for CLI: {}", e))?;

        // Update session state
        if let Some(state) = self.sessions.get_mut(task_id) {
            state.is_busy = false;
            if let Some(sid) = captured_session_id {
                state.cli_session_id = Some(sid);
            }
        }

        // Emit complete event
        let _ = app.emit(
            "agent:complete",
            AgentStatusPayload {
                task_id: task_id.to_string(),
                status: if status.success() { "complete" } else { "error" }.to_string(),
                message: None,
            },
        );

        if status.success() {
            Ok(full_response)
        } else {
            Err(format!("CLI exited with status: {}", status))
        }
    }

    /// Kill the session for a task
    pub fn kill_session(&mut self, task_id: &str) {
        self.sessions.remove(task_id);
    }

    /// Reset session (clear CLI session ID for fresh start)
    pub fn reset_session(&mut self, task_id: &str) {
        if let Some(state) = self.sessions.get_mut(task_id) {
            state.cli_session_id = None;
            state.is_busy = false;
        }
    }
}

impl Default for AgentSessionManager {
    fn default() -> Self {
        Self::new()
    }
}
