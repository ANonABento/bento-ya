//! Manages Claude CLI invocations for orchestrator conversations.
//!
//! Each message spawns a new CLI process with the message as an argument.
//! Conversation continuity is maintained via --resume with the session ID.
//!
//! See [`cli_shared`](super::cli_shared) for documentation on the CLI protocol.

use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use super::cli_shared::{
    build_cli_command, read_cli_response, spawn_stderr_reader, CliConfig, CliEvent, ToolStatus,
};
use crate::commands::orchestrator::{StreamChunkPayload, ThinkingPayload, ToolCallPayload};

// ============================================================================
// CLI Session
// ============================================================================

/// Tracks a conversation session for the orchestrator
struct CliSession {
    /// CLI configuration
    config: CliConfig,
    /// Whether we're currently processing a message
    is_busy: bool,
}

/// Manages Claude CLI sessions for orchestrator (workspace-scoped)
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
            .and_then(|s| s.config.resume_id.clone())
    }

    /// Get the model this session was spawned with
    pub fn get_model(&self, session_id: &str) -> Option<&str> {
        self.sessions
            .get(session_id)
            .map(|s| s.config.model.as_str())
    }

    /// Check if process is still alive (for compatibility - always returns true if session exists)
    pub fn is_alive(&mut self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    /// Initialize or update a session with CLI params (no process spawned yet)
    pub async fn spawn(
        &mut self,
        session_id: &str,
        cli_path: &str,
        model: &str,
        system_prompt: &str,
        resume_id: Option<&str>,
    ) -> Result<(), String> {
        eprintln!(
            "[Rust] CliSessionManager::spawn - cli_path: '{}', exists: {}",
            cli_path,
            std::path::Path::new(cli_path).exists()
        );

        // Create or update session
        self.sessions.insert(
            session_id.to_string(),
            CliSession {
                config: CliConfig {
                    cli_path: cli_path.to_string(),
                    model: model.to_string(),
                    system_prompt: system_prompt.to_string(),
                    resume_id: resume_id.map(|s| s.to_string()),
                    working_dir: None, // Orchestrator doesn't set working dir
                },
                is_busy: false,
            },
        );

        eprintln!(
            "[Rust] CliSessionManager::spawn - SUCCESS, session stored for: {}",
            session_id
        );
        Ok(())
    }

    /// Send a message using stored session params (spawns a new CLI process per message)
    pub async fn send_message(
        &mut self,
        session_id: &str,
        message: &str,
        workspace_id: &str,
        app: &AppHandle,
    ) -> Result<(String, Option<String>), String> {
        eprintln!(
            "[Rust] CliSessionManager::send_message - session_id: {}",
            session_id
        );

        // Get session and mark busy
        let session = self.sessions.get_mut(session_id).ok_or_else(|| {
            eprintln!("[Rust] CliSessionManager::send_message - Session not found!");
            "Session not found".to_string()
        })?;

        if session.is_busy {
            return Err("Session is busy".to_string());
        }

        session.is_busy = true;
        let config = session.config.clone();

        // Build and spawn CLI command
        let mut cmd = build_cli_command(&config, message);

        eprintln!(
            "[Rust] CliSessionManager::send_message - spawning CLI: {} --model {} [message len={}]",
            config.cli_path,
            config.model,
            message.len()
        );

        let mut child = cmd.spawn().map_err(|e| {
            eprintln!(
                "[Rust] CliSessionManager::send_message - SPAWN FAILED: {}",
                e
            );
            self.mark_not_busy(session_id);
            format!("Failed to spawn Claude CLI: {}", e)
        })?;

        eprintln!(
            "[Rust] CliSessionManager::send_message - process spawned, pid={:?}",
            child.id()
        );

        // Spawn stderr reader
        spawn_stderr_reader(&mut child, session_id.to_string());

        let stdout = child.stdout.take().ok_or_else(|| {
            self.mark_not_busy(session_id);
            "Failed to capture stdout".to_string()
        })?;

        // Read response with event emission
        let workspace_id_owned = workspace_id.to_string();
        let app_clone = app.clone();

        let result = read_cli_response(stdout, config.resume_id.clone(), session_id, |event| {
            emit_orchestrator_event(&app_clone, &workspace_id_owned, event);
        })
        .await;

        // Update session state
        self.mark_not_busy(session_id);

        match result {
            Ok((response, cli_session_id)) => {
                // Update resume ID for next message
                if let Some(session) = self.sessions.get_mut(session_id) {
                    session.config.resume_id = cli_session_id.clone();
                }

                // Emit finish event
                let _ = app.emit(
                    "orchestrator:stream",
                    &StreamChunkPayload {
                        workspace_id: workspace_id.to_string(),
                        delta: String::new(),
                        finish_reason: Some("stop".to_string()),
                        tool_use: None,
                    },
                );

                Ok((response, cli_session_id))
            }
            Err(e) => Err(e),
        }
    }

    fn mark_not_busy(&mut self, session_id: &str) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_busy = false;
        }
    }

    /// Kill a session's process
    pub async fn kill(&mut self, session_id: &str) {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_busy = false;
        }
        // Also remove from map to allow fresh spawn
        self.sessions.remove(session_id);
    }

    /// Kill all sessions
    pub async fn kill_all(&mut self) {
        for session in self.sessions.values_mut() {
            session.is_busy = false;
        }
        self.sessions.clear();
    }
}

/// Emit orchestrator-specific events based on CLI events
fn emit_orchestrator_event(app: &AppHandle, workspace_id: &str, event: CliEvent) {
    match event {
        CliEvent::TextContent(content) => {
            let _ = app.emit(
                "orchestrator:stream",
                &StreamChunkPayload {
                    workspace_id: workspace_id.to_string(),
                    delta: content,
                    finish_reason: None,
                    tool_use: None,
                },
            );
        }
        CliEvent::ThinkingContent { content, is_complete } => {
            let _ = app.emit(
                "orchestrator:thinking",
                &ThinkingPayload {
                    workspace_id: workspace_id.to_string(),
                    content,
                    is_complete,
                },
            );
        }
        CliEvent::ToolUse {
            id,
            name,
            status,
            ..
        } => {
            let status_str = match status {
                ToolStatus::Running => "running",
                ToolStatus::Complete => "complete",
            };
            let _ = app.emit(
                "orchestrator:tool_call",
                &ToolCallPayload {
                    workspace_id: workspace_id.to_string(),
                    tool_id: id,
                    tool_name: name,
                    status: status_str.to_string(),
                    input: None,
                    result: None,
                },
            );
        }
        CliEvent::Complete | CliEvent::SessionId(_) | CliEvent::Unknown => {}
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
