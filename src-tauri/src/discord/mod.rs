//! Discord bot integration module
//!
//! Manages a Node.js sidecar process running the Discord bot.
//! Communication is done via JSON over stdin/stdout.

pub mod bridge;
pub mod handlers;

pub use bridge::{DiscordBridge, DiscordStatus, IncomingCommand, SharedDiscordBridge};
pub use handlers::{handle_command, CommandContext};
