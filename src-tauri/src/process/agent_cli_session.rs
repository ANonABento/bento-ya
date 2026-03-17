//! Manages Claude CLI invocations for per-task agent conversations.
//!
//! Each message spawns a new CLI process with the message as an argument.
//! Conversation continuity is maintained via --resume with the session ID.
//!
//! See [`cli_shared`](super::cli_shared) for documentation on the CLI protocol.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use super::cli_shared::{
    build_cli_command, read_cli_response, spawn_stderr_reader, CliConfig, CliEvent, ToolStatus,
};

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

/// Tracks a conversation session for an agent
struct AgentSession {
    /// CLI configuration
    config: CliConfig,
    /// Whether we're currently processing a message
    is_busy: bool,
}

/// Manages Claude CLI sessions for agents (task-scoped)
pub struct AgentCliSessionManager {
    /// Map of task_id -> AgentSession
    sessions: HashMap<String, AgentSession>,
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

    /// Get the CLI session ID for resume
    pub fn get_cli_session_id(&self, task_id: &str) -> Option<String> {
        self.sessions
            .get(task_id)
            .and_then(|s| s.config.resume_id.clone())
    }

    /// Get the model this session uses
    pub fn get_model(&self, task_id: &str) -> Option<&str> {
        self.sessions.get(task_id).map(|s| s.config.model.as_str())
    }

    /// Get current session count
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Check if at capacity
    pub fn is_at_capacity(&self) -> bool {
        self.sessions.len() >= self.max_sessions
    }

    /// Check if process is still alive (for compatibility - always returns true if session exists)
    pub fn is_alive(&mut self, task_id: &str) -> bool {
        self.sessions.contains_key(task_id)
    }

    /// Initialize or update a session with CLI params (no process spawned yet)
    #[allow(clippy::too_many_arguments)]
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
        // Check capacity
        if self.is_at_capacity() && !self.sessions.contains_key(task_id) {
            return Err(format!(
                "Maximum {} concurrent agents reached. Stop an existing agent to start a new one.",
                self.max_sessions
            ));
        }

        eprintln!(
            "[Rust] AgentCliSession::spawn - initialized session for task_id: {}",
            task_id
        );

        // Create or update session
        self.sessions.insert(
            task_id.to_string(),
            AgentSession {
                config: CliConfig {
                    cli_path: cli_path.to_string(),
                    model: model.to_string(),
                    system_prompt: system_prompt.to_string(),
                    resume_id: resume_id.map(|s| s.to_string()),
                    working_dir: Some(working_dir.to_string()),
                    effort_level: effort_level.map(|s| s.to_string()),
                },
                is_busy: false,
            },
        );

        Ok(())
    }

    /// Send a message using stored session params (spawns a new CLI process per message)
    pub async fn send_message(
        &mut self,
        task_id: &str,
        message: &str,
        app: &AppHandle,
    ) -> Result<(String, Option<String>), String> {
        eprintln!(
            "[Rust] AgentCliSession::send_message - task_id: {}",
            task_id
        );

        // Get session and mark busy
        let session = self
            .sessions
            .get_mut(task_id)
            .ok_or_else(|| format!("No session found for task: {}", task_id))?;

        if session.is_busy {
            return Err("Agent is busy processing. Wait for completion or cancel.".to_string());
        }

        session.is_busy = true;
        let config = session.config.clone();

        // Build and spawn CLI command
        let mut cmd = build_cli_command(&config, message);

        eprintln!(
            "[Rust] AgentCliSession::send_message - spawning CLI: {} --model {} [message len={}]",
            config.cli_path,
            config.model,
            message.len()
        );

        let mut child = cmd.spawn().map_err(|e| {
            eprintln!(
                "[Rust] AgentCliSession::send_message - SPAWN FAILED: {}",
                e
            );
            self.mark_not_busy(task_id);
            format!("Failed to spawn Claude CLI: {}", e)
        })?;

        eprintln!(
            "[Rust] AgentCliSession::send_message - process spawned, pid={:?}",
            child.id()
        );

        // Spawn stderr reader
        spawn_stderr_reader(&mut child, task_id.to_string());

        let stdout = child.stdout.take().ok_or_else(|| {
            self.mark_not_busy(task_id);
            "Failed to capture stdout".to_string()
        })?;

        // Read response with event emission
        let task_id_owned = task_id.to_string();
        let app_clone = app.clone();

        let result = read_cli_response(
            stdout,
            config.resume_id.clone(),
            task_id,
            |event| {
                emit_agent_event(&app_clone, &task_id_owned, event);
            },
        )
        .await;

        // Update session state
        self.mark_not_busy(task_id);

        match result {
            Ok((response, session_id)) => {
                // Update resume ID for next message
                if let Some(session) = self.sessions.get_mut(task_id) {
                    session.config.resume_id = session_id.clone();
                }

                // Emit completion
                let _ = app.emit(
                    "agent:complete",
                    &AgentCompletePayload {
                        task_id: task_id.to_string(),
                        success: true,
                        message: None,
                    },
                );

                Ok((response, session_id))
            }
            Err(e) => {
                let _ = app.emit(
                    "agent:complete",
                    &AgentCompletePayload {
                        task_id: task_id.to_string(),
                        success: false,
                        message: Some(e.clone()),
                    },
                );
                Err(e)
            }
        }
    }

    fn mark_not_busy(&mut self, task_id: &str) {
        if let Some(session) = self.sessions.get_mut(task_id) {
            session.is_busy = false;
        }
    }

    /// Kill a session's process
    pub async fn kill(&mut self, task_id: &str) {
        if let Some(session) = self.sessions.get_mut(task_id) {
            session.is_busy = false;
        }
    }

    /// Remove session entirely
    pub async fn remove(&mut self, task_id: &str) {
        self.kill(task_id).await;
        self.sessions.remove(task_id);
    }

    /// Kill all sessions
    pub async fn kill_all(&mut self) {
        for session in self.sessions.values_mut() {
            session.is_busy = false;
        }
    }
}

/// Emit agent-specific events based on CLI events
fn emit_agent_event(app: &AppHandle, task_id: &str, event: CliEvent) {
    match event {
        CliEvent::TextContent(content) => {
            let _ = app.emit(
                "agent:stream",
                &AgentStreamPayload {
                    task_id: task_id.to_string(),
                    content,
                },
            );
        }
        CliEvent::ThinkingContent { content, is_complete } => {
            let _ = app.emit(
                "agent:thinking",
                &AgentThinkingPayload {
                    task_id: task_id.to_string(),
                    content,
                    is_complete,
                },
            );
        }
        CliEvent::ToolUse {
            id,
            name,
            input,
            status,
        } => {
            let status_str = match status {
                ToolStatus::Running => "running",
                ToolStatus::Complete => "completed",
            };
            let _ = app.emit(
                "agent:tool_call",
                &AgentToolCallPayload {
                    task_id: task_id.to_string(),
                    tool_id: id,
                    tool_name: name,
                    tool_input: input.unwrap_or_default(),
                    status: status_str.to_string(),
                },
            );
        }
        CliEvent::Complete | CliEvent::SessionId(_) | CliEvent::Unknown => {}
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
