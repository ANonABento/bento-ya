#![deny(clippy::all)]

use std::sync::{Arc, Mutex};

pub mod checklist;
pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod events;
pub mod git;
pub mod pipeline;
pub mod process;

use db::AppState;
use process::agent_runner::AgentRunner;
use process::pty_manager::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::init().expect("Failed to initialize database");
    let state = AppState {
        db: Mutex::new(conn),
    };

    let pty_manager = Arc::new(Mutex::new(PtyManager::new()));
    let agent_runner = Arc::new(Mutex::new(AgentRunner::new(Arc::clone(&pty_manager))));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .manage(pty_manager)
        .manage(agent_runner)
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            // Workspace CRUD
            commands::workspace::create_workspace,
            commands::workspace::get_workspace,
            commands::workspace::list_workspaces,
            commands::workspace::update_workspace,
            commands::workspace::delete_workspace,
            // Column CRUD
            commands::column::create_column,
            commands::column::list_columns,
            commands::column::update_column,
            commands::column::reorder_columns,
            commands::column::delete_column,
            // Task CRUD
            commands::task::create_task,
            commands::task::get_task,
            commands::task::list_tasks,
            commands::task::update_task,
            commands::task::move_task,
            commands::task::reorder_tasks,
            commands::task::delete_task,
            // Git commands
            commands::git::create_task_branch,
            commands::git::switch_branch,
            commands::git::get_current_branch,
            commands::git::list_task_branches,
            commands::git::delete_task_branch,
            commands::git::get_changes,
            commands::git::get_diff,
            commands::git::get_conflict_matrix,
            commands::git::get_commits,
            // PTY / Agent commands
            commands::terminal::write_to_pty,
            commands::terminal::resize_pty,
            commands::terminal::get_pty_scrollback,
            commands::agent::start_agent,
            commands::agent::stop_agent,
            commands::agent::force_stop_agent,
            commands::agent::get_agent_status,
            commands::agent::list_active_agents,
            // Pipeline commands
            commands::pipeline::mark_pipeline_complete,
            commands::pipeline::get_pipeline_state,
            commands::pipeline::try_advance_task,
            commands::pipeline::set_pipeline_error,
            // Orchestrator commands
            commands::orchestrator::get_orchestrator_context,
            commands::orchestrator::get_orchestrator_session,
            commands::orchestrator::send_orchestrator_message,
            commands::orchestrator::get_chat_history,
            commands::orchestrator::clear_chat_history,
            commands::orchestrator::process_orchestrator_response,
            commands::orchestrator::set_orchestrator_error,
            // Voice commands
            commands::voice::transcribe_audio,
            commands::voice::save_audio_temp,
            commands::voice::is_voice_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
