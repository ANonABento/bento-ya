//! Unified chat system — transport layer, session management, and event types.
//!
//! Provides a `ChatTransport` trait with two implementations:
//! - `PtyTransport`: Full PTY terminal (interactive, xterm.js rendering)
//! - `PipeTransport`: Piped CLI with `--print --output-format stream-json` (chat bubbles)
//!
//! Both transports emit unified `ChatEvent` types to the frontend.
//!
//! Shared utilities (`parse_json_event`, `base64_encode`, `spawn_stderr_reader`)
//! live in `events` and are reused by the legacy `process::cli_shared` module
//! to avoid duplication during the migration.

pub mod events;
pub mod pipe_transport;
pub mod pty_transport;
pub mod transport;

pub use events::{base64_encode, parse_json_event, spawn_stderr_reader, ChatEvent, ToolStatus};
pub use pipe_transport::PipeTransport;
pub use pty_transport::PtyTransport;
pub use transport::{ChatTransport, SpawnConfig, TransportEvent};
