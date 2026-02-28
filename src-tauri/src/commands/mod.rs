pub mod agent;
pub mod terminal;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Bento-ya.", name)
}
