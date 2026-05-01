pub mod agent;
pub mod checklist;
pub mod cli_detect;
pub mod column;
pub mod files;
pub mod git;
pub mod github;
pub mod history;
pub mod orchestrator;
pub mod pipeline;
pub mod script;
pub mod siege;
pub mod task;
pub mod updater;
pub mod terminal;
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

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Bento-ya.", name)
}
