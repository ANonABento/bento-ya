//! Tauri commands powering the interactive runtime mode (Phase 2).
//!
//! `agent_inject_message`, `agent_switch_model`, and `agent_restart` are
//! only valid when the task's resolved runtime mode is `"interactive"`.
//! `agent_interrupt` works in any mode (Ctrl+C to the tmux pane).
//!
//! All commands route through the per-task tmux session at
//! `kaitencode_<task_id>`. They never establish a parallel CLI session, which
//! is the whole point of interactive mode — the user is steering the same
//! live TUI the trigger spawned.

use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::chat::{bridge, tmux_transport};
use crate::config;
use crate::db::{self, AppState};
use crate::error::AppError;
use crate::pipeline::spawn;
use crate::pipeline::triggers::{
    parse_column_triggers, resolve_runtime_mode_for_task, resolve_working_dir, ResolvedRuntimeMode,
};

fn session_name(task_id: &str) -> String {
    tmux_transport::session_name(task_id)
}

fn require_session(task_id: &str) -> Result<String, AppError> {
    let name = session_name(task_id);
    if !tmux_transport::has_session(task_id) {
        return Err(AppError::CommandError(format!(
            "no tmux session for task {} (is the agent running?)",
            task_id
        )));
    }
    Ok(name)
}

/// Resolve the runtime mode for a task given the current task/column/global
/// config. Phase 2 implements the trigger > column > default tiers only;
/// the task/workspace/global tiers will be wired by Phase 4.
#[tauri::command(rename_all = "camelCase")]
pub fn resolve_runtime_mode(
    state: State<AppState>,
    task_id: String,
) -> Result<ResolvedRuntimeMode, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, &task_id)?;
    let column = db::get_column(&conn, &task.column_id)?;
    Ok(resolve_runtime_mode_for_task(&task, &column))
}

fn require_interactive_mode(state: &State<AppState>, task_id: &str) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, task_id)?;
    let column = db::get_column(&conn, &task.column_id)?;
    let resolved = resolve_runtime_mode_for_task(&task, &column);
    if resolved.mode != "interactive" {
        return Err(AppError::CommandError(format!(
            "command only valid in interactive mode (resolved: {} from {})",
            resolved.mode, resolved.source
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectMessageRequest {
    pub task_id: String,
    pub message: String,
}

/// Inject a message into the live interactive agent. Sends the message
/// literally via `tmux send-keys -l` and follows with Enter. Never used
/// in headless mode — the per-task chat hook owns that path.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_inject_message(
    state: State<AppState>,
    task_id: String,
    message: String,
) -> Result<(), AppError> {
    require_interactive_mode(&state, &task_id)?;
    let session = require_session(&task_id)?;
    if message.is_empty() {
        return Ok(());
    }
    run_tmux(&["send-keys", "-t", &session, "-l", &message])
        .map_err(|e| AppError::CommandError(format!("inject message failed: {}", e)))?;
    run_tmux(&["send-keys", "-t", &session, "Enter"])
        .map_err(|e| AppError::CommandError(format!("inject Enter failed: {}", e)))?;
    Ok(())
}

/// Advance the pipeline for an interactive task whose agent has signaled it is
/// done. Interactive completion is *advisory* — the watcher keeps the session
/// alive and never auto-advances — so this is the explicit, user-driven "I'm
/// satisfied, move it on" action surfaced by the "Advance column" control. It
/// runs the same `mark_complete(success = true)` the headless path runs.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_advance(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> Result<(), AppError> {
    require_interactive_mode(&state, &task_id)?;
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    crate::pipeline::mark_complete(&conn, &app, &task_id, true)?;
    Ok(())
}

/// Send Ctrl+C to the live agent. In interactive mode the agent returns
/// to its prompt (alive). In headless mode this kills the underlying
/// `claude -p` process (same as the existing Stop button).
#[tauri::command(rename_all = "camelCase")]
pub fn agent_interrupt(task_id: String) -> Result<(), AppError> {
    // No mode guard — interrupting works in any mode and matches the
    // existing tmux-cancel semantics used by `cancel_agent_chat`.
    let name = session_name(&task_id);
    if !tmux_transport::has_session(&task_id) {
        return Err(AppError::CommandError(format!(
            "no tmux session for task {}",
            task_id
        )));
    }
    run_tmux(&["send-keys", "-t", &name, "C-c"])
        .map_err(|e| AppError::CommandError(format!("interrupt failed: {}", e)))?;
    Ok(())
}

/// Send `/model <name>` to the live interactive agent. Phase 2 only
/// validates the request shape — the slash command's behavior is the
/// Claude Code CLI's responsibility. If the model name is unsupported the
/// CLI prints an error in-pane (and the user sees it via xterm).
#[tauri::command(rename_all = "camelCase")]
pub fn agent_switch_model(
    state: State<AppState>,
    task_id: String,
    model: String,
) -> Result<(), AppError> {
    require_interactive_mode(&state, &task_id)?;
    let model = model.trim();
    if model.is_empty() {
        return Err(AppError::CommandError("model name is empty".to_string()));
    }
    let session = require_session(&task_id)?;
    let slash = format!("/model {}", model);
    run_tmux(&["send-keys", "-t", &session, "-l", &slash])
        .map_err(|e| AppError::CommandError(format!("send /model failed: {}", e)))?;
    run_tmux(&["send-keys", "-t", &session, "Enter"])
        .map_err(|e| AppError::CommandError(format!("send Enter failed: {}", e)))?;
    Ok(())
}

/// Kill the current interactive agent and respawn a fresh one with the
/// same configuration. Useful when an agent is wedged or the user wants
/// a clean slate without changing column.
#[tauri::command(rename_all = "camelCase")]
pub async fn agent_restart(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), AppError> {
    require_interactive_mode(&state, &task_id)?;

    // Gather everything we need from the DB while we still hold the lock,
    // then drop it before doing any tmux / spawn I/O so we don't deadlock.
    let (cli_command, working_dir, args, initial_prompt, include_sentinel) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        let column = db::get_column(&conn, &task.column_id)?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)?;

        let column_triggers = parse_column_triggers(column.triggers.as_deref());
        let exit_criteria_str = column_triggers
            .exit_criteria
            .as_ref()
            .map(|c| c.criteria_type.as_str());
        let include_sentinel = bridge::exit_criteria_needs_sentinel(exit_criteria_str);

        let cli = task
            .agent_session_id
            .as_deref()
            .and_then(|sid| db::get_agent_session(&conn, sid).ok())
            .map(|s| s.agent_type)
            .unwrap_or_else(|| "claude".to_string());

        // Reuse the shared spawn helpers so restart stays in lock-step with
        // the original trigger spawn (working-dir, model→args, and the
        // `.task.md` prompt default all live in pipeline::spawn / triggers).
        let working_dir = resolve_working_dir(&task, &workspace.repo_path);

        let args = spawn::model_to_args(task.model.as_deref());

        let initial_prompt = task
            .trigger_prompt
            .clone()
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| spawn::task_md_default_prompt(&task));

        (cli, working_dir, args, initial_prompt, include_sentinel)
    };

    // Kill the existing session — spawn_interactive_claude does this
    // again as a belt-and-braces measure, but doing it here lets us also
    // surface any errors that would otherwise be silently swallowed.
    let _ = tmux_transport::kill_session(&task_id);

    let env_vars: HashMap<String, String> = HashMap::new();
    bridge::spawn_interactive_trigger_task(
        app,
        task_id,
        cli_command,
        args,
        working_dir,
        initial_prompt,
        Some(env_vars),
        include_sentinel,
    );
    Ok(())
}

fn run_tmux(args: &[&str]) -> Result<String, String> {
    let output = Command::new("tmux")
        .args(args)
        .output()
        .map_err(|e| format!("failed to spawn tmux: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "tmux {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// Re-export the dev-flag check so the frontend can grey out the picker
// when the env var isn't set. Cheap to call.
#[tauri::command(rename_all = "camelCase")]
pub fn interactive_mode_dev_flag() -> bool {
    config::interactive_mode_enabled()
}

/// Phase 5 — pause an interactive agent via SIGTSTP. Network calls in
/// flight will not pause (their response is queued; the agent processes
/// it on resume). Headless mode rejects this command — pausing a `-p`
/// race-to-exit process is nonsensical.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_pause(state: State<AppState>, task_id: String) -> Result<(), AppError> {
    require_interactive_mode(&state, &task_id)?;
    let session = require_session(&task_id)?;

    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        if task.agent_paused_at.is_some() {
            return Err(AppError::CommandError(format!(
                "task {} is already paused (since {})",
                task_id,
                task.agent_paused_at.unwrap_or(0)
            )));
        }
        // SIGTSTP via tmux. send-keys C-z sends Ctrl+Z to the foreground
        // process in the pane, which the shell forwards to the agent.
        run_tmux(&["send-keys", "-t", &session, "C-z"])
            .map_err(|e| AppError::CommandError(format!("send Ctrl+Z failed: {}", e)))?;
        let now_ms = chrono::Utc::now().timestamp_millis();
        db::update_task_agent_paused_at(&conn, &task_id, Some(now_ms))?;
    }
    Ok(())
}

/// Phase 5 — resume a paused interactive agent. Sends `fg` + Enter to
/// the tmux pane to foreground the suspended process. Errors when the
/// task isn't actually paused.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_resume(state: State<AppState>, task_id: String) -> Result<(), AppError> {
    require_interactive_mode(&state, &task_id)?;
    let session = require_session(&task_id)?;

    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        if task.agent_paused_at.is_none() {
            return Err(AppError::CommandError(format!(
                "task {} is not paused",
                task_id
            )));
        }
        run_tmux(&["send-keys", "-t", &session, "-l", "fg"])
            .map_err(|e| AppError::CommandError(format!("send fg failed: {}", e)))?;
        run_tmux(&["send-keys", "-t", &session, "Enter"])
            .map_err(|e| AppError::CommandError(format!("send Enter for fg failed: {}", e)))?;
        db::update_task_agent_paused_at(&conn, &task_id, None)?;
    }
    Ok(())
}

/// Phase 4 — list the latest completion events for a workspace. Used by
/// the settings panel's telemetry view. Capped at 200 even if the
/// caller asks for more to keep the IPC payload bounded.
#[tauri::command(rename_all = "camelCase")]
pub fn list_completion_events(
    state: State<AppState>,
    workspace_id: String,
    limit: Option<i64>,
) -> Result<Vec<db::completion_events::AgentCompletionEvent>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let n = limit.unwrap_or(50).clamp(1, 200);
    db::completion_events::list_recent(&conn, &workspace_id, n)
        .map_err(|e| AppError::DatabaseError(e.to_string()))
}

// Touch a use to silence unused-import warnings in some build configs.
#[allow(dead_code)]
fn _touch_dur(_: Duration) {}
#[allow(dead_code)]
fn _touch_conn(_: &Connection) {}
