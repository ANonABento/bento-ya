pub mod agent;
pub mod column;
pub mod git;
pub mod orchestrator;
pub mod pipeline;
pub mod task;
pub mod terminal;
pub mod voice;
pub mod workspace;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Bento-ya.", name)
}
