pub mod agent;
pub mod agent_interactive;
pub mod checklist;
pub mod cli_detect;
pub mod column;
pub mod discord;
pub mod files;
pub mod git;
pub mod github;
pub mod history;
pub mod label;
pub mod orchestrator;
pub mod pipeline;
pub mod pipeline_template;
pub mod script;
pub mod settings;
pub mod siege;
pub mod system;
pub mod task;
pub mod terminal;
pub mod updater;
pub mod usage;
#[cfg(feature = "voice")]
pub mod voice;
#[cfg(not(feature = "voice"))]
pub mod voice_stubs;
#[cfg(not(feature = "voice"))]
pub use voice_stubs as voice;
pub mod workspace;

// Re-export models commands (they live in models module, not commands)
pub use crate::models;
