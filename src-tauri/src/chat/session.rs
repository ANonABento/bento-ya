//! UnifiedChatSession — wraps a ChatTransport with session lifecycle.
//!
//! Each session tracks:
//! - CLI resume ID (for `--resume` conversation continuity)
//! - Session state (Idle/Running/Suspended)
//! - Busy flag (prevents concurrent messages)
//! - Last activity timestamp (for idle timeout)
//!
//! Supports two modes:
//! - **Pipe mode**: `send_message()` spawns a fresh CLI process per message,
//!   returns full response. Used for chat bubbles.
//! - **PTY mode**: `start_pty()` spawns once, `write_pty()` sends input,
//!   events stream continuously. Used for terminal view.

use std::time::Instant;

use tokio::sync::mpsc;

use super::events::ChatEvent;
use super::pipe_transport::PipeTransport;
use super::pty_transport::PtyTransport;
use super::transport::{ChatTransport, SpawnConfig, TransportEvent};

/// Which transport type to use for this session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportType {
    Pipe,
    Pty,
}

/// Session lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    /// No process running, ready to spawn
    Idle,
    /// Process is running (pipe: processing a message, PTY: interactive)
    Running,
    /// Process was killed but resume ID is saved for later
    Suspended,
}

/// Configuration for creating a session (stored, reused across messages).
#[derive(Debug, Clone)]
pub struct SessionConfig {
    pub cli_path: String,
    pub model: String,
    pub system_prompt: String,
    pub working_dir: Option<String>,
    pub effort_level: Option<String>,
}

/// Unified chat session wrapping a transport with lifecycle management.
pub struct UnifiedChatSession {
    /// Session configuration (reused across messages)
    config: SessionConfig,
    /// Transport type (determines pipe vs PTY behavior)
    transport_type: TransportType,
    /// Active transport (None when Idle/Suspended)
    transport: Option<Box<dyn ChatTransport>>,
    /// CLI session ID for --resume (captured from system events)
    resume_id: Option<String>,
    /// Current session state
    state: SessionState,
    /// Whether a message is currently being processed (pipe mode)
    is_busy: bool,
    /// Last activity timestamp for idle timeout
    last_activity: Instant,
}

impl UnifiedChatSession {
    pub fn new(config: SessionConfig, transport_type: TransportType) -> Self {
        Self {
            config,
            transport_type,
            transport: None,
            resume_id: None,
            state: SessionState::Idle,
            is_busy: false,
            last_activity: Instant::now(),
        }
    }

    // -- Accessors --

    pub fn state(&self) -> SessionState {
        self.state
    }

    pub fn is_busy(&self) -> bool {
        self.is_busy
    }

    pub fn resume_id(&self) -> Option<&str> {
        self.resume_id.as_deref()
    }

    pub fn model(&self) -> &str {
        &self.config.model
    }

    pub fn transport_type(&self) -> TransportType {
        self.transport_type
    }

    pub fn last_activity(&self) -> Instant {
        self.last_activity
    }

    pub fn pid(&self) -> Option<u32> {
        self.transport.as_ref().and_then(|t| t.pid())
    }

    /// Update the resume ID (e.g. from DB on session restore).
    pub fn set_resume_id(&mut self, id: Option<String>) {
        self.resume_id = id;
    }

    /// Update the model (triggers resume_id clear since CLI ignores --model on --resume).
    pub fn set_model(&mut self, model: String) {
        if self.config.model != model {
            self.config.model = model;
            self.resume_id = None;
        }
    }

    /// Update the system prompt.
    pub fn set_system_prompt(&mut self, prompt: String) {
        self.config.system_prompt = prompt;
    }

    // -- Pipe mode: request-response --

    /// Send a message in pipe mode. Spawns a fresh CLI process, reads the full
    /// response, and returns (response_text, captured_session_id).
    ///
    /// Events are forwarded to `on_event` for real-time streaming to the frontend.
    pub async fn send_message<F>(
        &mut self,
        message: &str,
        mut on_event: F,
    ) -> Result<(String, Option<String>), String>
    where
        F: FnMut(ChatEvent),
    {
        if self.is_busy {
            return Err("Session is busy processing".to_string());
        }

        self.is_busy = true;
        self.state = SessionState::Running;
        self.last_activity = Instant::now();

        // Build spawn config with message as last arg
        let spawn_config = self.build_pipe_spawn_config(message);

        // Create fresh pipe transport for this message
        let mut transport = PipeTransport::new();
        let mut event_rx = transport.spawn(spawn_config).inspect_err(|_| {
            self.is_busy = false;
            self.state = SessionState::Idle;
        })?;

        // Store transport so kill() can cancel mid-message
        self.transport = Some(Box::new(transport));

        // Consume events — pipe transport already handles assistant-event dedup,
        // so we just accumulate all TextContent events
        let mut full_response = String::new();
        let mut captured_session_id = self.resume_id.clone();

        while let Some(event) = event_rx.recv().await {
            match event {
                TransportEvent::Chat(chat_event) => {
                    match &chat_event {
                        ChatEvent::SessionId(sid) => {
                            captured_session_id = Some(sid.clone());
                        }
                        ChatEvent::TextContent(text) => {
                            full_response.push_str(text);
                        }
                        ChatEvent::Complete => {
                            on_event(chat_event);
                            break;
                        }
                        _ => {}
                    }
                    on_event(chat_event);
                }
                TransportEvent::Exited(_) => {
                    break;
                }
            }
        }

        // Update state — transport is done, clear it
        self.transport = None;
        self.resume_id = captured_session_id.clone();
        self.is_busy = false;
        self.state = SessionState::Idle;
        self.last_activity = Instant::now();

        Ok((full_response, captured_session_id))
    }

    // -- PTY mode: interactive --

    /// Start an interactive PTY session. Returns a receiver for continuous events.
    /// Use `write_pty()` to send input.
    pub fn start_pty(
        &mut self,
        cols: u16,
        rows: u16,
    ) -> Result<mpsc::Receiver<TransportEvent>, String> {
        if self.state == SessionState::Running {
            return Err("Session already running".to_string());
        }

        let spawn_config = SpawnConfig {
            command: self.config.cli_path.clone(),
            args: Vec::new(), // PTY mode: no args, interactive
            working_dir: self.config.working_dir.clone(),
            env_vars: None,
            cols,
            rows,
        };

        let mut transport = PtyTransport::new();
        let event_rx = transport.spawn(spawn_config)?;

        self.transport = Some(Box::new(transport));
        self.state = SessionState::Running;
        self.last_activity = Instant::now();

        Ok(event_rx)
    }

    /// Write data to the PTY stdin.
    pub fn write_pty(&mut self, data: &[u8]) -> Result<(), String> {
        let transport = self.transport.as_mut().ok_or("No active PTY session")?;
        transport.write(data)?;
        self.last_activity = Instant::now();
        Ok(())
    }

    /// Resize the PTY terminal.
    pub fn resize_pty(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        let transport = self.transport.as_mut().ok_or("No active PTY session")?;
        transport.resize(cols, rows)
    }

    // -- Lifecycle --

    /// Suspend the session: save resume ID, kill the transport.
    /// The session can be resumed later with the saved resume ID.
    pub fn suspend(&mut self) -> Result<(), String> {
        if let Some(ref mut transport) = self.transport {
            transport.kill()?;
        }
        self.transport = None;
        self.is_busy = false;
        self.state = SessionState::Suspended;
        Ok(())
    }

    /// Kill the session: destroy everything, clear resume ID.
    pub fn kill(&mut self) -> Result<(), String> {
        if let Some(ref mut transport) = self.transport {
            transport.kill()?;
        }
        self.transport = None;
        self.is_busy = false;
        self.resume_id = None;
        self.state = SessionState::Idle;
        Ok(())
    }

    /// Check if the underlying transport process is still alive.
    pub fn is_alive(&self) -> bool {
        self.transport
            .as_ref()
            .map(|t| t.is_alive())
            .unwrap_or(false)
    }

    // -- Internal helpers --

    fn build_pipe_spawn_config(&self, message: &str) -> SpawnConfig {
        let mut args = vec![
            "--print".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--model".to_string(),
            self.config.model.clone(),
            "--system-prompt".to_string(),
            self.config.system_prompt.clone(),
        ];

        if let Some(ref effort) = self.config.effort_level {
            args.push("--effort".to_string());
            args.push(effort.clone());
        }

        if let Some(ref id) = self.resume_id {
            args.push("--resume".to_string());
            args.push(id.clone());
        }

        // Message as last positional argument
        args.push(message.to_string());

        SpawnConfig {
            command: self.config.cli_path.clone(),
            args,
            working_dir: self.config.working_dir.clone(),
            env_vars: None,
            cols: 80,
            rows: 24,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> SessionConfig {
        SessionConfig {
            cli_path: "/usr/bin/claude".to_string(),
            model: "sonnet".to_string(),
            system_prompt: "You are helpful".to_string(),
            working_dir: None,
            effort_level: None,
        }
    }

    #[test]
    fn test_new_session() {
        let session = UnifiedChatSession::new(test_config(), TransportType::Pipe);
        assert_eq!(session.state(), SessionState::Idle);
        assert!(!session.is_busy());
        assert!(session.resume_id().is_none());
        assert_eq!(session.model(), "sonnet");
        assert_eq!(session.transport_type(), TransportType::Pipe);
        assert!(session.pid().is_none());
        assert!(!session.is_alive());
    }

    #[test]
    fn test_set_model_clears_resume() {
        let mut session = UnifiedChatSession::new(test_config(), TransportType::Pipe);
        session.set_resume_id(Some("session-123".to_string()));
        assert_eq!(session.resume_id(), Some("session-123"));

        // Same model — resume preserved
        session.set_model("sonnet".to_string());
        assert_eq!(session.resume_id(), Some("session-123"));

        // Different model — resume cleared
        session.set_model("opus".to_string());
        assert!(session.resume_id().is_none());
        assert_eq!(session.model(), "opus");
    }

    #[test]
    fn test_build_pipe_spawn_config() {
        let mut session = UnifiedChatSession::new(test_config(), TransportType::Pipe);
        session.set_resume_id(Some("resume-abc".to_string()));

        let config = session.build_pipe_spawn_config("Hello world");
        assert_eq!(config.command, "/usr/bin/claude");
        assert!(config.args.contains(&"--print".to_string()));
        assert!(config.args.contains(&"--resume".to_string()));
        assert!(config.args.contains(&"resume-abc".to_string()));
        assert_eq!(config.args.last().unwrap(), "Hello world");
    }

    #[test]
    fn test_build_pipe_spawn_config_with_effort() {
        let mut cfg = test_config();
        cfg.effort_level = Some("high".to_string());
        let session = UnifiedChatSession::new(cfg, TransportType::Pipe);

        let config = session.build_pipe_spawn_config("test");
        assert!(config.args.contains(&"--effort".to_string()));
        assert!(config.args.contains(&"high".to_string()));
    }

    #[test]
    fn test_suspend_and_kill() {
        let mut session = UnifiedChatSession::new(test_config(), TransportType::Pipe);
        session.set_resume_id(Some("session-123".to_string()));

        // Suspend preserves resume ID
        session.suspend().unwrap();
        assert_eq!(session.state(), SessionState::Suspended);
        assert_eq!(session.resume_id(), Some("session-123"));
        assert!(!session.is_busy());

        // Kill clears everything
        session.kill().unwrap();
        assert_eq!(session.state(), SessionState::Idle);
        assert!(session.resume_id().is_none());
    }
}
