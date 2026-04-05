//! Process management for PTY sessions.
//!
//! Handles spawning, tracking, and communicating with AI coding agent processes.
//! PtyManager provides core PTY infrastructure, AgentRunner manages per-task agents.

pub mod agent_runner;
pub mod pty_manager;
