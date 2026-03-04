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
pub mod siege;
pub mod task;
pub mod terminal;
pub mod usage;
pub mod voice;
pub mod workspace;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Bento-ya.", name)
}
