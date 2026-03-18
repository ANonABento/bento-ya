//! Process management for CLI and PTY sessions.
//!
//! Handles spawning, tracking, and communicating with AI coding agent processes.
//! Supports both CLI-based sessions (Claude, Codex) and PTY-based terminal sessions.

pub mod agent_cli_session;
pub mod agent_runner;
pub mod cli_session;
pub mod cli_shared;
pub mod pty_manager;
