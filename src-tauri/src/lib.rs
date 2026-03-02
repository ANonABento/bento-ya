#![deny(clippy::all)]

use std::sync::{Arc, Mutex};

pub mod checklist;
pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod events;
pub mod git;
pub mod llm;
pub mod pipeline;
pub mod process;
pub mod whisper;

use commands::voice::RecorderState;
use db::AppState;
use process::agent_runner::AgentRunner;
use process::cli_session::new_shared_cli_session_manager;
use process::pty_manager::PtyManager;
use whisper::AudioRecorder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::init().expect("Failed to initialize database");
    let state = AppState {
        db: Mutex::new(conn),
    };

    let pty_manager = Arc::new(Mutex::new(PtyManager::new()));
    let agent_runner = Arc::new(Mutex::new(AgentRunner::new(Arc::clone(&pty_manager))));
    let cli_session_manager = new_shared_cli_session_manager();
    let recorder_state = RecorderState(Mutex::new(AudioRecorder::new()));

    // Clone for shutdown handler
    let cli_manager_for_shutdown = Arc::clone(&cli_session_manager);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .manage(pty_manager)
        .manage(agent_runner)
        .manage(cli_session_manager)
        .manage(recorder_state)
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill all CLI sessions on window close
                let manager = Arc::clone(&cli_manager_for_shutdown);
                tauri::async_runtime::block_on(async {
                    let mut m = manager.lock().await;
                    m.kill_all().await;
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            // Workspace CRUD
            commands::workspace::create_workspace,
            commands::workspace::get_workspace,
            commands::workspace::list_workspaces,
            commands::workspace::update_workspace,
            commands::workspace::delete_workspace,
            commands::workspace::clone_workspace,
            commands::workspace::reorder_workspaces,
            commands::workspace::seed_demo_data,
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
            commands::orchestrator::list_chat_sessions,
            commands::orchestrator::get_active_chat_session,
            commands::orchestrator::create_chat_session,
            commands::orchestrator::delete_chat_session,
            commands::orchestrator::get_chat_history,
            commands::orchestrator::clear_chat_history,
            commands::orchestrator::reset_cli_session,
            commands::orchestrator::process_orchestrator_response,
            commands::orchestrator::set_orchestrator_error,
            commands::orchestrator::stream_orchestrator_chat,
            commands::orchestrator::cancel_orchestrator_chat,
            // Voice commands
            commands::voice::transcribe_audio,
            commands::voice::save_audio_temp,
            commands::voice::is_voice_available,
            commands::voice::list_whisper_models,
            commands::voice::download_whisper_model,
            commands::voice::delete_whisper_model,
            commands::voice::get_whisper_model_info,
            // Native audio recording (bypasses webview limitations)
            commands::voice::start_native_recording,
            commands::voice::stop_native_recording,
            commands::voice::cancel_native_recording,
            commands::voice::is_native_recording,
            // Usage tracking commands
            commands::usage::record_usage,
            commands::usage::get_workspace_usage,
            commands::usage::get_task_usage,
            commands::usage::get_workspace_usage_summary,
            commands::usage::get_task_usage_summary,
            commands::usage::clear_workspace_usage,
            // History commands
            commands::history::create_snapshot,
            commands::history::get_snapshot,
            commands::history::get_session_history,
            commands::history::get_workspace_history,
            commands::history::get_task_history,
            commands::history::clear_session_history,
            // CLI detection commands
            commands::cli_detect::detect_clis,
            commands::cli_detect::detect_single_cli,
            commands::cli_detect::verify_cli_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
