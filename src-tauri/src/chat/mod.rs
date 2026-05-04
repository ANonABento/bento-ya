//! Unified chat system — transport layer, session management, and event types.
//!
//! Provides a `ChatTransport` trait with two implementations:
//! - `PtyTransport`: Full PTY terminal (interactive, xterm.js rendering)
//! - `PipeTransport`: Piped CLI with `--print --output-format stream-json` (chat bubbles)
//!
//! `UnifiedChatSession` wraps a transport with session lifecycle (spawn, suspend,
//! resume, kill) and resume ID tracking for conversation continuity.
//!
//! `SessionRegistry` manages multiple sessions with concurrency limits.
//!
//! Shared utilities (`parse_json_event`, `base64_encode`, `spawn_stderr_reader`)
//! live in `events`.

pub mod bridge;
pub mod chef;
pub mod events;
pub mod gc;
pub mod log_retention;
pub mod pipe_transport;
pub mod pty_transport;
pub mod registry;
pub mod session;
pub mod tmux_transport;
pub mod transport;

pub use bridge::ManagedBridge;
pub use chef::{ChefMode, ChefSession};
pub use events::{base64_encode, parse_json_event, spawn_stderr_reader, ChatEvent, ToolStatus};
pub use pipe_transport::PipeTransport;
pub use pty_transport::PtyTransport;
pub use registry::{new_shared_session_registry, SessionRegistry, SharedSessionRegistry};
pub use session::{SessionConfig, SessionState, TransportType, UnifiedChatSession};
pub use transport::{
    ChatTransport, SpawnConfig, TransportEvent,
    DEFAULT_SCROLLBACK_BYTES, MESSAGE_TIMEOUT, OUTPUT_BUFFER_INTERVAL_MS,
};
