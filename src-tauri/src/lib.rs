#![deny(clippy::all)]

use std::sync::{Arc, Mutex};

pub mod api;
pub mod chat;
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
#[cfg(feature = "voice")]
pub mod whisper;

#[cfg(feature = "voice")]
use commands::voice::RecorderState;
use db::AppState;
use chat::registry::new_shared_session_registry;
use process::agent_runner::AgentRunner;
use process::pty_manager::PtyManager;
#[cfg(feature = "voice")]
use whisper::AudioRecorder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::init().expect("Failed to initialize database");

    // Reset stale pipeline states from previous app instance (crash recovery)
    let reset_count: i64 = conn
        .execute(
            "UPDATE tasks SET pipeline_state = 'idle', pipeline_triggered_at = NULL, pipeline_error = 'App restarted — pipeline state reset' WHERE pipeline_state IN ('running', 'triggered', 'evaluating', 'advancing')",
            [],
        )
        .unwrap_or(0) as i64;
    if reset_count > 0 {
        eprintln!("[startup] Reset {} task(s) with stale pipeline state to idle", reset_count);
    }

    // Clear stale cli_session_id references (previous app sessions are dead)
    let cli_reset: i64 = conn
        .execute(
            "UPDATE chat_sessions SET cli_session_id = NULL WHERE cli_session_id IS NOT NULL",
            [],
        )
        .unwrap_or(0) as i64;
    if cli_reset > 0 {
        eprintln!("[startup] Cleared {} stale CLI session reference(s)", cli_reset);
    }

    // Seed built-in scripts (idempotent — skips if already present)
    if let Err(e) = db::seed_built_in_scripts(&conn) {
        eprintln!("[startup] Failed to seed built-in scripts: {}", e);
    }

    let state = AppState {
        db: Mutex::new(conn),
    };

    let pty_manager = Arc::new(Mutex::new(PtyManager::new()));
    let agent_runner = Arc::new(Mutex::new(AgentRunner::new(Arc::clone(&pty_manager))));
    let session_registry = new_shared_session_registry();
    #[cfg(feature = "voice")]
    let recorder_state = RecorderState(Mutex::new(AudioRecorder::new()));

    // Clone for shutdown handler
    let pty_for_shutdown = Arc::clone(&pty_manager);
    let agent_runner_for_shutdown = Arc::clone(&agent_runner);
    let session_registry_for_shutdown = Arc::clone(&session_registry);

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state)
        .manage(pty_manager)
        .manage(agent_runner)
        .manage(session_registry);

    #[cfg(feature = "webdriver")]
    {
        builder = builder.plugin(tauri_plugin_webdriver_automation::init());
    }

    #[cfg(feature = "voice")]
    {
        builder = builder.manage(recorder_state);
    }

    builder
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill all sessions and processes on window close
                let pty = Arc::clone(&pty_for_shutdown);
                let runner = Arc::clone(&agent_runner_for_shutdown);
                let registry = Arc::clone(&session_registry_for_shutdown);
                tauri::async_runtime::block_on(async {
                    let mut reg = registry.lock().await;
                    reg.kill_all();
                });
                // Kill PTY-managed processes (agents, scripts)
                let _ = pty.lock().map(|mut pty_mgr| pty_mgr.shutdown_all());
                // Clean up agent runner sessions
                let _ = runner.lock().map(|mut ar| ar.cleanup_all());
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
            commands::task::update_task_triggers,
            commands::task::move_task,
            commands::task::reorder_tasks,
            commands::task::delete_task,
            commands::task::approve_task,
            commands::task::reject_task,
            commands::task::create_pr,
            commands::task::update_task_stakeholders,
            commands::task::mark_task_notification_sent,
            commands::task::clear_task_notification_sent,
            commands::task::generate_test_checklist,
            commands::task::retry_pipeline,
            commands::task::validate_task_dependencies,
            commands::task::queue_backlog,
            commands::task::create_task_worktree,
            commands::task::remove_task_worktree,
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
            commands::agent::save_agent_message,
            commands::agent::get_agent_messages,
            commands::agent::clear_agent_messages,
            commands::agent::stream_agent_chat,
            commands::agent::cancel_agent_chat,
            commands::agent::queue_agent_tasks,
            commands::agent::update_task_agent_status,
            commands::agent::get_queue_status,
            commands::agent::get_next_queued_task,
            // Pipeline commands
            commands::pipeline::mark_pipeline_complete,
            commands::pipeline::get_pipeline_state,
            commands::pipeline::try_advance_task,
            commands::pipeline::set_pipeline_error,
            commands::pipeline::update_script_exit_code,
            // Siege loop commands
            commands::siege::start_siege,
            commands::siege::stop_siege,
            commands::siege::check_siege_status,
            commands::siege::continue_siege,
            commands::siege::get_pr_status,
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
            // Streaming transcription
            commands::voice::transcribe_recording_chunk,
            commands::voice::transcribe_all_recording,
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
            commands::history::restore_snapshot,
            // CLI detection commands
            commands::cli_detect::detect_clis,
            commands::cli_detect::detect_single_cli,
            commands::cli_detect::verify_cli_path,
            commands::cli_detect::get_cli_capabilities,
            // Checklist commands
            commands::checklist::get_workspace_checklist,
            commands::checklist::update_checklist_item,
            commands::checklist::update_checklist_category,
            commands::checklist::create_workspace_checklist,
            commands::checklist::delete_workspace_checklist,
            commands::checklist::update_checklist_item_auto_detect,
            commands::checklist::link_checklist_item_to_task,
            commands::checklist::run_checklist_detection,
            // Files commands
            commands::files::scan_workspace_files,
            commands::files::read_file_content,
            commands::files::create_note_file,
            // Script commands
            commands::script::list_scripts,
            commands::script::get_script,
            commands::script::create_script,
            commands::script::update_script,
            commands::script::delete_script,
            // GitHub PR status commands
            commands::github::fetch_pr_status,
            commands::github::fetch_pr_status_batch,
            commands::github::should_refresh_pr_status,
        ])
        .setup(|app| {
            // Start HTTP API server for external MCP control
            api::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Cleanup port file on exit
    api::cleanup();
}
