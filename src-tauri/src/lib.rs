#![deny(clippy::all)]

pub mod commands;
pub mod checklist;
pub mod config;
pub mod db;
pub mod git;
pub mod pipeline;
pub mod process;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![commands::greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
