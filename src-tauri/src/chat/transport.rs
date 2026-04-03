//! ChatTransport trait — the abstraction over PTY and pipe-based CLI sessions.

use std::collections::HashMap;
use std::time::Duration;

use tokio::sync::mpsc;

use super::events::ChatEvent;

// ============================================================================
// Shared constants used by both transports
// ============================================================================

/// Timeout for reading a response from the CLI (5 minutes).
/// Used by PipeTransport and legacy cli_shared.
pub const MESSAGE_TIMEOUT: Duration = Duration::from_secs(300);

/// Interval for flushing buffered PTY output to the event channel.
/// Used by PtyTransport and legacy PtyManager.
pub const OUTPUT_BUFFER_INTERVAL_MS: u64 = 16;

/// Maximum scrollback buffer size (5000 lines * 200 bytes estimated).
/// Used by PtyTransport and legacy PtyManager.
pub const DEFAULT_SCROLLBACK_BYTES: usize = 5000 * 200;

/// Configuration for spawning a transport process.
#[derive(Debug, Clone)]
pub struct SpawnConfig {
    /// Path to the CLI binary (e.g. "claude", "/usr/bin/claude")
    pub command: String,
    /// Arguments to pass to the CLI
    pub args: Vec<String>,
    /// Working directory for the process
    pub working_dir: Option<String>,
    /// Environment variables to set
    pub env_vars: Option<HashMap<String, String>>,
    /// Initial terminal size (PTY only, ignored by pipe)
    pub cols: u16,
    /// Initial terminal size (PTY only, ignored by pipe)
    pub rows: u16,
}

/// Events sent from a transport to the session layer.
pub enum TransportEvent {
    /// Chat event (text, thinking, tool use, etc.)
    Chat(ChatEvent),
    /// Transport-specific: process exited
    Exited(Option<i32>),
}

/// Abstraction over PTY and pipe-based CLI transports.
///
/// Both implementations spawn a CLI process and provide a channel of events.
/// The key differences:
/// - PTY: interactive, supports write/resize, emits raw terminal bytes
/// - Pipe: non-interactive, message passed as CLI arg, emits structured JSON events
pub trait ChatTransport: Send {
    /// Spawn the transport process. Returns a receiver for events.
    fn spawn(&mut self, config: SpawnConfig) -> Result<mpsc::Receiver<TransportEvent>, String>;

    /// Write data to the process stdin (PTY: raw bytes, Pipe: no-op or message)
    fn write(&mut self, data: &[u8]) -> Result<(), String>;

    /// Resize the terminal (PTY only, no-op for pipe)
    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String>;

    /// Kill the process
    fn kill(&mut self) -> Result<(), String>;

    /// Check if the process is still running
    fn is_alive(&self) -> bool;

    /// Get the process ID, if available
    fn pid(&self) -> Option<u32>;
}
