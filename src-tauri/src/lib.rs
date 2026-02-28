#![deny(clippy::all)]

pub mod checklist;
pub mod commands;
pub mod config;
pub mod db;
pub mod git;
pub mod pipeline;
pub mod process;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::git::create_task_branch,
            commands::git::switch_branch,
            commands::git::get_current_branch,
            commands::git::list_task_branches,
            commands::git::delete_task_branch,
            commands::git::get_changes,
            commands::git::get_diff,
            commands::git::get_conflict_matrix,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
