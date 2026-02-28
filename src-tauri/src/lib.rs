#![deny(clippy::all)]

use std::sync::{Arc, Mutex};

pub mod checklist;
pub mod commands;
pub mod config;
pub mod db;
pub mod git;
pub mod pipeline;
pub mod process;

use process::agent_runner::AgentRunner;
use process::pty_manager::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_manager = Arc::new(Mutex::new(PtyManager::new()));
    let agent_runner = Arc::new(Mutex::new(AgentRunner::new(Arc::clone(&pty_manager))));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(pty_manager)
        .manage(agent_runner)
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::terminal::write_to_pty,
            commands::terminal::resize_pty,
            commands::terminal::get_pty_scrollback,
            commands::agent::start_agent,
            commands::agent::stop_agent,
            commands::agent::force_stop_agent,
            commands::agent::get_agent_status,
            commands::agent::list_active_agents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
