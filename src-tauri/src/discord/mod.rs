//! Discord bot integration module
//!
//! Manages a Node.js sidecar process running the Discord bot.
//! Communication is done via JSON over stdin/stdout.

pub mod bridge;

pub use bridge::{DiscordBridge, DiscordStatus, SharedDiscordBridge};
