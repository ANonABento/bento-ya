pub mod column;
pub mod git;
pub mod task;
pub mod workspace;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Bento-ya.", name)
}
