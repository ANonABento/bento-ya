//! Manages persistent Claude CLI sessions for per-task agent conversations.
//!
//! Each task can have a running Claude CLI process. Messages are sent via stdin
//! and responses read via stdout. If the process dies, we fall back to --resume
//! with the captured session ID.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

/// Timeout for reading a response from the CLI (5 minutes)
const MESSAGE_TIMEOUT: Duration = Duration::from_secs(300);

/// Maximum concurrent agent sessions
const MAX_AGENT_SESSIONS: usize = 5;

// ============================================================================
// Event Payloads (agent-specific)
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamPayload {
    pub task_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentThinkingPayload {
    pub task_id: String,
    pub content: String,
    pub is_complete: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolCallPayload {
    pub task_id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub tool_input: String,
    pub status: String, // "pending" | "running" | "completed" | "error"
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompletePayload {
    pub task_id: String,
    pub success: bool,
    pub message: Option<String>,
}

// ============================================================================
// Agent CLI Session
// ============================================================================

/// A running Claude CLI session for an agent
struct AgentCliSession {
    /// The running child process
    process: Child,
    /// Stdin handle for sending messages
    stdin: ChildStdin,
    /// Stdout reader for receiving responses
    stdout: BufReader<ChildStdout>,
    /// CLI session ID for resume fallback (captured from first response)
    cli_session_id: Option<String>,
    /// Model this session was spawned with
    model: String,
    /// Effort level (if specified)
    effort_level: Option<String>,
    /// Whether we're currently processing a message
    is_busy: bool,
}

/// Manages persistent Claude CLI sessions for agents (task-scoped)
pub struct AgentCliSessionManager {
    /// Map of task_id -> AgentCliSession
    sessions: HashMap<String, AgentCliSession>,
    /// Maximum concurrent sessions
    max_sessions: usize,
}

impl AgentCliSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            max_sessions: MAX_AGENT_SESSIONS,
        }
    }

    /// Check if a session exists for a task
    pub fn has_session(&self, task_id: &str) -> bool {
        self.sessions.contains_key(task_id)
    }

    /// Check if session is busy processing
    pub fn is_busy(&self, task_id: &str) -> bool {
        self.sessions
            .get(task_id)
            .map(|s| s.is_busy)
            .unwrap_or(false)
    }

    /// Get the CLI session ID for resume fallback
    pub fn get_cli_session_id(&self, task_id: &str) -> Option<String> {
        self.sessions
            .get(task_id)
            .and_then(|s| s.cli_session_id.clone())
    }

    /// Get the model this session was spawned with
    pub fn get_model(&self, task_id: &str) -> Option<&str> {
        self.sessions.get(task_id).map(|s| s.model.as_str())
    }

    /// Get current session count
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Check if at capacity
    pub fn is_at_capacity(&self) -> bool {
        self.sessions.len() >= self.max_sessions
    }

    /// Spawn a new Claude CLI process for a task
    pub async fn spawn(
        &mut self,
        task_id: &str,
        cli_path: &str,
        working_dir: &str,
        model: &str,
        effort_level: Option<&str>,
        system_prompt: &str,
        resume_id: Option<&str>,
    ) -> Result<(), String> {
        // Check capacity first
        if self.is_at_capacity() && !self.sessions.contains_key(task_id) {
            return Err(format!(
                "Maximum {} concurrent agents reached. Stop an existing agent to start a new one.",
                self.max_sessions
            ));
        }

        // Kill existing session if any
        self.kill(task_id).await;

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

        // Set working directory
        cmd.current_dir(working_dir);

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

        let session = AgentCliSession {
            process: child,
            stdin,
            stdout: BufReader::new(stdout),
            cli_session_id: resume_id.map(|s| s.to_string()),
            model: model.to_string(),
            effort_level: effort_level.map(|s| s.to_string()),
            is_busy: false,
        };

        self.sessions.insert(task_id.to_string(), session);
        Ok(())
    }

    /// Send a message and stream the response
    pub async fn send_message(
        &mut self,
        task_id: &str,
        message: &str,
        app: &AppHandle,
    ) -> Result<(String, Option<String>), String> {
        let session = self
            .sessions
            .get_mut(task_id)
            .ok_or_else(|| "Session not found".to_string())?;

        if session.is_busy {
            return Err("Agent is busy processing. Wait for completion or cancel.".to_string());
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

        // Read response until we get a result event
        let mut full_response = String::new();
        let mut captured_session_id: Option<String> = session.cli_session_id.clone();

        loop {
            let mut line = String::new();
            let read_result = timeout(MESSAGE_TIMEOUT, session.stdout.read_line(&mut line)).await;

            match read_result {
                Err(_) => {
                    session.is_busy = false;
                    return Err("Agent response timed out after 5 minutes".to_string());
                }
                Ok(Err(e)) => {
                    session.is_busy = false;
                    return Err(format!("Failed to read stdout: {}", e));
                }
                Ok(Ok(0)) => {
                    session.is_busy = false;
                    return Err("Process ended unexpectedly".to_string());
                }
                Ok(Ok(_)) => {
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
                                                    "agent:thinking",
                                                    &AgentThinkingPayload {
                                                        task_id: task_id.to_string(),
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
                                                    "agent:tool_call",
                                                    &AgentToolCallPayload {
                                                        task_id: task_id.to_string(),
                                                        tool_id,
                                                        tool_name,
                                                        tool_input: String::new(),
                                                        status: "running".to_string(),
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
                                                            "agent:thinking",
                                                            &AgentThinkingPayload {
                                                                task_id: task_id.to_string(),
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
                                                            "agent:stream",
                                                            &AgentStreamPayload {
                                                                task_id: task_id.to_string(),
                                                                content: text.to_string(),
                                                            },
                                                        );
                                                    }
                                                }
                                                "input_json_delta" => {
                                                    // Tool input being streamed - could emit if needed
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                }
                                "content_block_stop" => {
                                    let _ = app.emit(
                                        "agent:thinking",
                                        &AgentThinkingPayload {
                                            task_id: task_id.to_string(),
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
                                    session.is_busy = false;
                                    return Ok((full_response, captured_session_id));
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
    }

    /// Kill a session's process
    pub async fn kill(&mut self, task_id: &str) {
        if let Some(mut session) = self.sessions.remove(task_id) {
            let _ = session.process.kill().await;
        }
    }

    /// Kill all sessions
    pub async fn kill_all(&mut self) {
        let task_ids: Vec<String> = self.sessions.keys().cloned().collect();
        for task_id in task_ids {
            self.kill(&task_id).await;
        }
    }

    /// Check if process is still alive
    pub fn is_alive(&mut self, task_id: &str) -> bool {
        let is_dead = if let Some(session) = self.sessions.get_mut(task_id) {
            match session.process.try_wait() {
                Ok(None) => None,        // Still running
                Ok(Some(_)) => Some(()), // Exited
                Err(_) => Some(()),      // Error checking - assume dead
            }
        } else {
            return false;
        };

        if is_dead.is_some() {
            self.sessions.remove(task_id);
            false
        } else {
            true
        }
    }
}

impl Default for AgentCliSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Thread-safe wrapper for AgentCliSessionManager
pub type SharedAgentCliSessionManager = Arc<Mutex<AgentCliSessionManager>>;

pub fn new_shared_agent_cli_session_manager() -> SharedAgentCliSessionManager {
    Arc::new(Mutex::new(AgentCliSessionManager::new()))
}
