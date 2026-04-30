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
pub mod models;
pub mod pipeline;
#[cfg(feature = "voice")]
pub mod whisper;

use chat::registry::{new_shared_session_registry, start_idle_sweep};
#[cfg(feature = "voice")]
use commands::voice::RecorderState;
use db::AppState;
use tauri::Manager;
#[cfg(feature = "voice")]
use whisper::AudioRecorder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let conn = db::init().expect("Failed to initialize database");

    // Clear stale cli_session_id references (previous app sessions are dead)
    let cli_reset: i64 = conn
        .execute(
            "UPDATE chat_sessions SET cli_session_id = NULL WHERE cli_session_id IS NOT NULL",
            [],
        )
        .unwrap_or(0) as i64;
    if cli_reset > 0 {
        eprintln!(
            "[startup] Cleared {} stale CLI session reference(s)",
            cli_reset
        );
    }

    // Seed built-in scripts (idempotent — skips if already present)
    if let Err(e) = db::seed_built_in_scripts(&conn) {
        eprintln!("[startup] Failed to seed built-in scripts: {}", e);
    }

    let state = AppState {
        db: Mutex::new(conn),
    };

    let session_registry = new_shared_session_registry();
    #[cfg(feature = "voice")]
    let recorder_state = RecorderState(Mutex::new(AudioRecorder::new()));

    // Clone for shutdown handler + idle sweep
    let session_registry_for_shutdown = Arc::clone(&session_registry);
    let session_registry_for_sweep = Arc::clone(&session_registry);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state)
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
                // Kill all sessions on window close
                let registry = Arc::clone(&session_registry_for_shutdown);
                tauri::async_runtime::block_on(async {
                    let mut reg = registry.lock().await;
                    reg.kill_all();
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
            commands::task::retry_from_start,
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
            commands::agent::switch_agent_transport,
            commands::agent::ensure_pty_session,
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
            commands::pipeline::get_pipeline_timing,
            commands::pipeline::get_average_pipeline_timing,
            // Siege loop commands
            commands::siege::start_siege,
            commands::siege::stop_siege,
            commands::siege::check_siege_status,
            commands::siege::continue_siege,
            commands::siege::get_pr_status,
            // Orchestrator commands
            commands::orchestrator::get_orchestrator_context,
            commands::orchestrator::get_orchestrator_session,
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
            commands::cli_detect::check_cli_update,
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
            // Dynamic model discovery
            models::get_available_models,
            models::refresh_models,
        ])
        .setup(|app| {
            // Start HTTP API server for external MCP control
            api::start(app.handle().clone());
            // Start periodic idle session sweep (every 60s)
            start_idle_sweep(session_registry_for_sweep, app.handle().clone());

            // Keep macOS didFinishLaunching light. Finder/Spotlight launches can
            // abort if setup blocks on DB queries, tmux checks, or pipeline resume.
            start_background_startup_recovery(app.handle().clone());

            // Start garbage collector for tmux sessions + agent resources
            chat::gc::start_gc();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Cleanup port file on exit
    api::cleanup();
}

fn start_background_startup_recovery(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        // Recover stale pipeline work from the previous app instance.
        resume_stale_pipeline_tasks(app.clone());

        // Recover tmux sessions from previous app instance.
        recover_tmux_sessions(app);
    });
}

/// Recover tmux sessions from a previous app instance.
///
/// On startup, discovers any `bentoya_*` tmux sessions still running.
/// For sessions whose task_id exists in the DB with agent_status="running",
/// re-registers them in the SessionRegistry so they can be reattached
/// when the user opens the terminal panel.
/// Orphaned sessions (task not in DB or not running) are killed.
fn recover_tmux_sessions(app: tauri::AppHandle) {
    use chat::tmux_transport;

    // Check tmux availability and ensure server is configured
    match tmux_transport::check_tmux() {
        Ok(version) => {
            eprintln!("[startup] tmux available: {}", version);
            // Ensure tmux server won't die when all sessions are killed
            if let Err(e) = tmux_transport::ensure_tmux_server() {
                eprintln!("[startup] tmux server setup failed: {}", e);
            }
        }
        Err(e) => {
            eprintln!("[startup] {}", e);
            return;
        }
    }

    let existing = tmux_transport::list_sessions();
    if existing.is_empty() {
        return;
    }

    eprintln!(
        "[startup] Found {} existing tmux session(s)",
        existing.len()
    );

    let state: tauri::State<db::AppState> = app.state();
    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut recovered = 0;
    let mut cleaned = 0;

    for session_name in &existing {
        let task_id = match tmux_transport::session_name_to_task_id(session_name) {
            Some(id) => id,
            None => continue,
        };

        // Check if task exists and was running
        let should_recover = db::get_task(&conn, task_id)
            .ok()
            .map(|t| t.agent_status.as_deref() == Some("running"))
            .unwrap_or(false);

        if should_recover {
            eprintln!("[startup] Recovering tmux session for task: {}", task_id);
            // Don't attach yet — just note it exists. When the user opens the
            // terminal panel, ensure_pty_session will call TmuxTransport::reconnect()
            // and attach.
            recovered += 1;
        } else {
            eprintln!("[startup] Cleaning orphaned tmux session: {}", session_name);
            let _ = std::process::Command::new("tmux")
                .args(["kill-session", "-t", session_name])
                .output();
            cleaned += 1;
        }
    }

    if recovered > 0 || cleaned > 0 {
        eprintln!(
            "[startup] tmux recovery: {} recovered, {} cleaned up",
            recovered, cleaned
        );
    }
}

const STALE_PIPELINE_STATES_SQL: &str = "'running', 'triggered', 'evaluating', 'advancing'";

fn stale_pipeline_state_filter(column: &str) -> String {
    format!("{column} IN ({STALE_PIPELINE_STATES_SQL})")
}

#[cfg(test)]
fn startup_resume_candidates(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<Vec<(db::Task, db::Column)>> {
    let stale_pipeline_filter = stale_pipeline_state_filter("t.pipeline_state");
    let mut stmt = conn.prepare(&format!(
        "SELECT t.id
         FROM tasks t
         JOIN columns c ON c.id = t.column_id
         WHERE {stale_pipeline_filter}
         ORDER BY t.workspace_id, c.position, t.position",
    ))?;
    let task_ids = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut candidates = Vec::new();
    for task_id in task_ids {
        let task = db::get_task(conn, &task_id)?;
        let column = db::get_column(conn, &task.column_id)?;
        if pipeline::triggers::has_effective_on_entry_trigger(&task, &column) {
            candidates.push((task, column));
        }
    }

    Ok(candidates)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartupRecoveryAction {
    Retrigger,
    CompleteAndAdvance,
    ResetIdle,
}

fn column_name_matches(column: &db::Column, names: &[&str]) -> bool {
    names
        .iter()
        .any(|candidate| column.name.eq_ignore_ascii_case(candidate))
}

fn is_named_no_agent_column(column: &db::Column) -> bool {
    column_name_matches(column, &["setup", "pr", "staging", "merge"])
}

fn is_named_agent_column(column: &db::Column) -> bool {
    column_name_matches(column, &["plan", "implement", "review", "verify"])
}

fn worktree_has_new_commits_since_trigger(task: &db::Task) -> bool {
    let Some(triggered_at) = task.pipeline_triggered_at.as_deref() else {
        return false;
    };
    let Some(worktree_path) = task.worktree_path.as_deref() else {
        return false;
    };
    if worktree_path.is_empty() || !std::path::Path::new(worktree_path).exists() {
        return false;
    }

    let output = std::process::Command::new("git")
        .args(["log", "--since", triggered_at, "--format=%H", "-n", "1"])
        .current_dir(worktree_path)
        .output();

    output
        .ok()
        .filter(|out| out.status.success())
        .map(|out| !String::from_utf8_lossy(&out.stdout).trim().is_empty())
        .unwrap_or(false)
}

fn startup_recovery_action(task: &db::Task, column: &db::Column) -> StartupRecoveryAction {
    let trigger = pipeline::triggers::effective_on_entry_trigger(task, column);
    let is_agent_trigger = matches!(
        trigger,
        Some(pipeline::triggers::TriggerActionV2::SpawnCli { .. })
    );
    let has_trigger = trigger.is_some();

    if is_named_agent_column(column) || is_agent_trigger {
        if worktree_has_new_commits_since_trigger(task) {
            StartupRecoveryAction::CompleteAndAdvance
        } else if has_trigger {
            StartupRecoveryAction::Retrigger
        } else {
            StartupRecoveryAction::ResetIdle
        }
    } else if is_named_no_agent_column(column) || has_trigger {
        StartupRecoveryAction::Retrigger
    } else {
        StartupRecoveryAction::ResetIdle
    }
}

fn stale_pipeline_tasks(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<Vec<(db::Task, db::Column, StartupRecoveryAction)>> {
    let stale_pipeline_filter = stale_pipeline_state_filter("t.pipeline_state");
    let mut stmt = conn.prepare(&format!(
        "SELECT t.id
         FROM tasks t
         JOIN columns c ON c.id = t.column_id
         WHERE {stale_pipeline_filter}
         ORDER BY t.workspace_id, c.position, t.position",
    ))?;
    let task_ids = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut tasks = Vec::new();
    for task_id in task_ids {
        let task = db::get_task(conn, &task_id)?;
        let column = db::get_column(conn, &task.column_id)?;
        let action = startup_recovery_action(&task, &column);
        tasks.push((task, column, action));
    }

    Ok(tasks)
}

fn reset_task_runtime_state(
    conn: &rusqlite::Connection,
    task_id: &str,
) -> rusqlite::Result<db::Task> {
    let ts = db::now();
    conn.execute(
        "UPDATE agent_sessions
         SET status = 'failed', exit_code = COALESCE(exit_code, -1), updated_at = ?1
         WHERE status = 'running' AND task_id = ?2",
        rusqlite::params![ts, task_id],
    )?;

    conn.execute(
        "UPDATE tasks
         SET pipeline_state = 'idle',
             pipeline_triggered_at = NULL,
             pipeline_error = NULL,
             agent_status = 'idle',
             queued_at = NULL,
             agent_session_id = NULL,
             updated_at = ?1
         WHERE id = ?2",
        rusqlite::params![ts, task_id],
    )?;
    db::get_task(conn, task_id)
}

fn complete_interrupted_agent_work(
    conn: &rusqlite::Connection,
    app: &tauri::AppHandle,
    task: &db::Task,
) -> Result<db::Task, error::AppError> {
    let ts = db::now();
    if let Some(session_id) = task.agent_session_id.as_deref() {
        let _ = db::update_agent_session(
            conn,
            session_id,
            None,
            Some("completed"),
            Some(Some(-1)),
            None,
            None,
            None,
        );
    }
    conn.execute(
        "UPDATE tasks
         SET agent_status = 'completed',
             queued_at = NULL,
             updated_at = ?1
         WHERE id = ?2",
        rusqlite::params![ts, task.id],
    )?;
    pipeline::mark_complete(conn, app, &task.id, true)
}

/// Resume tasks that were interrupted while sitting in trigger columns.
///
/// No-agent trigger columns are re-fired immediately. Agent columns inspect the
/// task worktree for commits after the last trigger; if commits exist, the task
/// is completed through the normal pipeline path so it can advance. Otherwise,
/// its current column trigger is restarted.
fn resume_stale_pipeline_tasks(app: tauri::AppHandle) {
    let state: tauri::State<db::AppState> = app.state();
    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[startup] DB lock failed during pipeline recovery: {}", e);
            return;
        }
    };

    let tasks = match stale_pipeline_tasks(&conn) {
        Ok(tasks) => tasks,
        Err(e) => {
            eprintln!("[startup] Failed to inspect stale pipeline tasks: {}", e);
            Vec::new()
        }
    };

    if tasks.is_empty() {
        return;
    }

    let mut retriggered = 0;
    let mut advanced = 0;
    let mut reset = 0;
    let mut failed = 0;
    for (stale_task, column, action) in tasks {
        match action {
            StartupRecoveryAction::Retrigger => {
                let task = match reset_task_runtime_state(&conn, &stale_task.id) {
                    Ok(task) => task,
                    Err(e) => {
                        log::warn!(
                            "[startup] Failed to reset task {} for trigger recovery: {}",
                            stale_task.id,
                            e
                        );
                        failed += 1;
                        continue;
                    }
                };

                match pipeline::fire_trigger(&conn, &app, &task, &column) {
                    Ok(_) => retriggered += 1,
                    Err(e) => {
                        log::warn!(
                            "[startup] Failed to resume pipeline trigger for task {}: {}",
                            task.id,
                            e
                        );
                        failed += 1;
                    }
                }
            }
            StartupRecoveryAction::CompleteAndAdvance => {
                match complete_interrupted_agent_work(&conn, &app, &stale_task) {
                    Ok(_) => advanced += 1,
                    Err(e) => {
                        log::warn!(
                            "[startup] Failed to advance recovered work for task {}: {}",
                            stale_task.id,
                            e
                        );
                        failed += 1;
                    }
                }
            }
            StartupRecoveryAction::ResetIdle => {
                if let Err(e) = reset_task_runtime_state(&conn, &stale_task.id) {
                    log::warn!(
                        "[startup] Failed to reset stale task {} to idle: {}",
                        stale_task.id,
                        e
                    );
                    failed += 1;
                } else {
                    reset += 1;
                }
            }
        }
    }

    eprintln!(
        "[startup] Pipeline recovery: {} retriggered, {} advanced, {} reset, {} failed",
        retriggered, advanced, reset, failed
    );
}

#[cfg(test)]
mod startup_recovery_tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    fn temp_git_repo(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "bento-ya-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();

        for args in [
            vec!["init"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test User"],
        ] {
            let status = Command::new("git")
                .args(args)
                .current_dir(&path)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .unwrap();
            assert!(status.success());
        }

        path
    }

    fn commit_file(repo: &Path, file_name: &str, contents: &str) {
        fs::write(repo.join(file_name), contents).unwrap();
        for args in [vec!["add", file_name], vec!["commit", "-m", "test commit"]] {
            let status = Command::new("git")
                .args(args)
                .current_dir(repo)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .unwrap();
            assert!(status.success());
        }
    }

    #[test]
    fn startup_resume_candidates_only_include_stale_tasks_in_trigger_columns() {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let backlog = db::insert_column(&conn, &workspace.id, "Backlog", 0).unwrap();
        let plan = db::insert_column(&conn, &workspace.id, "Plan", 1).unwrap();
        let done = db::insert_column(&conn, &workspace.id, "Done", 2).unwrap();
        let trigger_json = r#"{"on_entry":{"type":"spawn_cli","cli":"codex"}}"#;
        db::update_column(
            &conn,
            &plan.id,
            None,
            None,
            None,
            None,
            None,
            Some(trigger_json),
        )
        .unwrap();

        let backlog_task =
            db::insert_task(&conn, &workspace.id, &backlog.id, "Backlog", None).unwrap();
        let plan_task = db::insert_task(&conn, &workspace.id, &plan.id, "Plan", None).unwrap();
        let idle_plan_task =
            db::insert_task(&conn, &workspace.id, &plan.id, "Idle Plan", None).unwrap();
        let done_task = db::insert_task(&conn, &workspace.id, &done.id, "Done", None).unwrap();

        db::update_task_pipeline_state(&conn, &backlog_task.id, "running", None, None).unwrap();
        db::update_task_pipeline_state(&conn, &plan_task.id, "triggered", None, None).unwrap();
        db::update_task_pipeline_state(&conn, &done_task.id, "advancing", None, None).unwrap();

        let candidates = startup_resume_candidates(&conn).unwrap();
        let ids: Vec<_> = candidates.into_iter().map(|(task, _)| task.id).collect();

        assert_eq!(ids, vec![plan_task.id]);
        assert!(!ids.contains(&idle_plan_task.id));
    }

    #[test]
    fn startup_recovery_actions_classify_no_agent_columns_for_retrigger() {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let setup = db::insert_column(&conn, &workspace.id, "Setup", 0).unwrap();
        let pr = db::insert_column(&conn, &workspace.id, "PR", 1).unwrap();
        let task = db::insert_task(&conn, &workspace.id, &setup.id, "Setup Task", None).unwrap();

        assert_eq!(
            startup_recovery_action(&task, &setup),
            StartupRecoveryAction::Retrigger
        );
        assert_eq!(
            startup_recovery_action(&task, &pr),
            StartupRecoveryAction::Retrigger
        );
    }

    #[test]
    fn startup_recovery_actions_classify_agent_columns_without_commits_for_retrigger() {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let plan = db::insert_column(&conn, &workspace.id, "Plan", 0).unwrap();
        db::update_column(
            &conn,
            &plan.id,
            None,
            None,
            None,
            None,
            None,
            Some(r#"{"on_entry":{"type":"spawn_cli","cli":"codex"}}"#),
        )
        .unwrap();
        let plan = db::get_column(&conn, &plan.id).unwrap();
        let task = db::insert_task(&conn, &workspace.id, &plan.id, "Plan Task", None).unwrap();

        assert_eq!(
            startup_recovery_action(&task, &plan),
            StartupRecoveryAction::Retrigger
        );
    }

    #[test]
    fn startup_recovery_actions_classify_agent_columns_with_new_commits_for_advance() {
        let repo = temp_git_repo("startup-recovery-commits");
        commit_file(&repo, "result.txt", "done\n");

        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "Test", repo.to_str().unwrap()).unwrap();
        let plan = db::insert_column(&conn, &workspace.id, "Plan", 0).unwrap();
        db::update_column(
            &conn,
            &plan.id,
            None,
            None,
            None,
            None,
            None,
            Some(r#"{"on_entry":{"type":"spawn_cli","cli":"codex"}}"#),
        )
        .unwrap();

        let task = db::insert_task(&conn, &workspace.id, &plan.id, "Plan Task", None).unwrap();
        db::update_task_pipeline_state(
            &conn,
            &task.id,
            "running",
            Some("1970-01-01 00:00:00"),
            None,
        )
        .unwrap();
        db::update_task_worktree_path(&conn, &task.id, Some(repo.to_str().unwrap())).unwrap();
        let task = db::get_task(&conn, &task.id).unwrap();
        let plan = db::get_column(&conn, &plan.id).unwrap();

        assert_eq!(
            startup_recovery_action(&task, &plan),
            StartupRecoveryAction::CompleteAndAdvance
        );

        fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn startup_resume_candidates_skip_explicit_none_triggers() {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let column = db::insert_column(&conn, &workspace.id, "Backlog", 0).unwrap();
        db::update_column(
            &conn,
            &column.id,
            None,
            None,
            None,
            None,
            None,
            Some(r#"{"on_entry":{"type":"none"}}"#),
        )
        .unwrap();
        let task = db::insert_task(&conn, &workspace.id, &column.id, "Task", None).unwrap();
        db::update_task_pipeline_state(&conn, &task.id, "running", None, None).unwrap();

        assert!(startup_resume_candidates(&conn).unwrap().is_empty());
    }

    #[test]
    fn startup_resume_candidates_respect_task_trigger_overrides() {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let column = db::insert_column(&conn, &workspace.id, "Plan", 0).unwrap();
        db::update_column(
            &conn,
            &column.id,
            None,
            None,
            None,
            None,
            None,
            Some(r#"{"on_entry":{"type":"spawn_cli","cli":"codex"}}"#),
        )
        .unwrap();

        let skipped = db::insert_task(&conn, &workspace.id, &column.id, "Skipped", None).unwrap();
        let resumable = db::insert_task(&conn, &workspace.id, &column.id, "Resume", None).unwrap();

        conn.execute(
            "UPDATE tasks SET trigger_overrides = ?1 WHERE id = ?2",
            rusqlite::params![r#"{"skip_triggers":true}"#, skipped.id],
        )
        .unwrap();

        for task_id in [&skipped.id, &resumable.id] {
            db::update_task_pipeline_state(&conn, task_id, "running", None, None).unwrap();
        }

        let candidates = startup_resume_candidates(&conn).unwrap();
        let ids: Vec<_> = candidates.into_iter().map(|(task, _)| task.id).collect();

        assert_eq!(ids, vec![resumable.id]);
    }

    #[test]
    fn reset_task_runtime_state_clears_agent_and_pipeline_state() {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let column = db::insert_column(&conn, &workspace.id, "Plan", 0).unwrap();
        let task = db::insert_task(&conn, &workspace.id, &column.id, "Task", None).unwrap();
        let session = db::insert_agent_session(&conn, &task.id, "codex", Some("/tmp")).unwrap();

        db::update_task_pipeline_state(&conn, &task.id, "running", Some("now"), Some("old"))
            .unwrap();
        db::update_task_agent_status(&conn, &task.id, Some("running"), Some("now")).unwrap();
        db::update_task_agent_session(&conn, &task.id, Some(&session.id)).unwrap();
        db::update_agent_session(
            &conn,
            &session.id,
            None,
            Some("running"),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        reset_task_runtime_state(&conn, &task.id).unwrap();

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(task.pipeline_state, "idle");
        assert_eq!(task.agent_status.as_deref(), Some("idle"));
        assert!(task.pipeline_triggered_at.is_none());
        assert!(task.pipeline_error.is_none());
        assert!(task.agent_session_id.is_none());

        let session = db::get_agent_session(&conn, &session.id).unwrap();
        assert_eq!(session.status, "failed");
        assert_eq!(session.exit_code, Some(-1));
    }
}
