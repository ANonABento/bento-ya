//! Unified chat event types.
//!
//! Both PtyTransport and PipeTransport emit these events. The frontend
//! renders them as chat bubbles (pipe) or raw terminal output (pty).

use serde::Serialize;

/// Unified event emitted by both transports.
#[derive(Debug, Clone)]
pub enum ChatEvent {
    /// Session ID captured from CLI system event (pipe transport only)
    SessionId(String),
    /// Text content from assistant response
    TextContent(String),
    /// Extended thinking content
    ThinkingContent { content: String, is_complete: bool },
    /// Tool use information
    ToolUse {
        id: String,
        name: String,
        input: Option<String>,
        status: ToolStatus,
    },
    /// Response is complete
    Complete,
    /// Raw terminal output (PTY transport only, base64-encoded)
    RawOutput(String),
    /// Process exited
    Exit { code: Option<i32> },
    /// Error
    Error(String),
    /// Unknown or unhandled event
    Unknown,
}

/// Status of a tool call
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ToolStatus {
    Running,
    Complete,
}

impl ChatEvent {
    /// Returns true if this is a terminal event (Complete, Exit, Error)
    pub fn is_terminal(&self) -> bool {
        matches!(self, ChatEvent::Complete | ChatEvent::Exit { .. } | ChatEvent::Error(_))
    }
}
