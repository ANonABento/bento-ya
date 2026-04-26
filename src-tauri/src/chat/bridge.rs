//! Bridges transport events to Tauri frontend events.
//!
//! The unified transport layer emits events via channels, but the frontend
//! expects Tauri events (`pty:{taskId}:output`, `pty:{taskId}:exit`).
//! This module provides helpers to forward transport events to the frontend,
//! and a background task runner for CLI triggers.

use std::collections::HashMap;

use rusqlite::Connection;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

use super::events::ChatEvent;
use super::transport::TransportEvent;
use crate::db;
use crate::pipeline;

/// Generate a random 16-char hex nonce (used for tmux wait-for channel names).
fn gen_nonce() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let s = RandomState::new();
    let mut h = s.build_hasher();
    h.write_u64(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64);
    format!("{:016x}", h.finish())
}

// ─── Managed Bridge ──────────────────────────────────────────────────────────

/// A single managed bridge that forwards PTY broadcast events to Tauri frontend events.
/// Only one bridge should exist per task at any time.
pub struct ManagedBridge {
    handle: JoinHandle<()>,
}

impl ManagedBridge {
    /// Start a new bridge that subscribes to the PTY broadcast channel and
    /// forwards events to the frontend via Tauri events.
    pub fn start(
        app: AppHandle,
        task_id: String,
        rx: broadcast::Receiver<TransportEvent>,
    ) -> Self {
        let handle = tokio::spawn(bridge_broadcast_to_tauri(app, task_id, rx));
        Self { handle }
    }

    /// Cancel the bridge by aborting its task.
    pub fn cancel(&self) {
        self.handle.abort();
    }

    /// Check if the bridge task is still running.
    pub fn is_alive(&self) -> bool {
        !self.handle.is_finished()
    }
}

impl Drop for ManagedBridge {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Forward PTY broadcast events to Tauri events for frontend rendering.
///
/// This is the broadcast-based equivalent of `bridge_pty_to_tauri`. It subscribes
/// to the PTY's broadcast channel and emits Tauri events until the channel closes
/// or the task is aborted.
async fn bridge_broadcast_to_tauri(
    app: AppHandle,
    task_id: String,
    mut event_rx: broadcast::Receiver<TransportEvent>,
) {
    let mut accumulated_text = String::new();

    loop {
        match event_rx.recv().await {
            Ok(event) => {
                if handle_bridge_event(&app, &task_id, &event, &mut accumulated_text).await {
                    break; // Exited event received
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                eprintln!("[bridge] {} lagged, skipped {} events", task_id, n);
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => {
                break;
            }
        }
    }
}

/// Forward PTY transport events to Tauri events for frontend rendering (mpsc version).
///
/// DEPRECATED: Prefer ManagedBridge::start() with broadcast receiver.
/// Kept for backward compatibility with pipe transport callers.
pub async fn bridge_pty_to_tauri(
    app: &AppHandle,
    task_id: &str,
    mut event_rx: mpsc::Receiver<TransportEvent>,
) {
    let mut accumulated_text = String::new();

    while let Some(event) = event_rx.recv().await {
        if handle_bridge_event(app, task_id, &event, &mut accumulated_text).await {
            break;
        }
    }
}

/// Shared event handling logic for both mpsc and broadcast bridges.
/// Returns true if the bridge should stop (Exited event received).
///
/// Completion detection is handled by `tmux wait-for` in spawn_cli_trigger_task,
/// NOT by scanning output. This handler just forwards events to the frontend.
async fn handle_bridge_event(
    app: &AppHandle,
    task_id: &str,
    event: &TransportEvent,
    accumulated_text: &mut String,
) -> bool {
    match event {
        TransportEvent::Chat(ChatEvent::RawOutput(ref data)) => {
            let _ = app.emit(&format!("pty:{}:output", task_id), data);
            false
        }
        TransportEvent::Chat(ChatEvent::TextContent(ref text)) => {
            accumulated_text.push_str(text);
            let _ = app.emit("agent:stream", &serde_json::json!({
                "taskId": task_id,
                "content": text,
            }));
            false
        }
        TransportEvent::Chat(ChatEvent::ThinkingContent { ref content, is_complete }) => {
            let _ = app.emit("agent:thinking", &serde_json::json!({
                "taskId": task_id,
                "content": content,
                "isComplete": is_complete,
            }));
            false
        }
        TransportEvent::Chat(ChatEvent::ToolUse { ref id, ref name, ref input, ref status }) => {
            let _ = app.emit("agent:tool_call", &serde_json::json!({
                "taskId": task_id,
                "toolId": id,
                "toolName": name,
                "toolInput": input.clone().unwrap_or_default(),
                "status": format!("{:?}", status).to_lowercase(),
            }));
            false
        }
        TransportEvent::Chat(ChatEvent::Complete) => {
            if !accumulated_text.is_empty() {
                if let Ok(conn) = Connection::open(db::db_path()) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = db::insert_agent_message(
                        &conn, task_id, "assistant", accumulated_text,
                        None, None, None, None,
                    );
                }
                accumulated_text.clear();
            }
            let _ = app.emit("agent:complete", &serde_json::json!({
                "taskId": task_id,
                "success": true,
            }));
            false
        }
        TransportEvent::Exited(exit_code) => {
            if !accumulated_text.is_empty() {
                if let Ok(conn) = Connection::open(db::db_path()) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = db::insert_agent_message(
                        &conn, task_id, "assistant", accumulated_text,
                        None, None, None, None,
                    );
                }
            }
            let _ = app.emit(
                &format!("pty:{}:exit", task_id),
                serde_json::json!({ "task_id": task_id, "exit_code": exit_code }),
            );
            true
        }
        _ => false,
    }
}

/// Build the CLI command string for a trigger, handling CLI-specific prompt flags.
fn build_trigger_command(cli_command: &str, args: &[String], initial_prompt: &str) -> String {
    let mut cmd_parts = vec![cli_command.to_string()];

    // Add permission bypass flags and non-interactive mode per CLI
    let cli_name = cli_command.rsplit('/').next().unwrap_or(cli_command);
    match cli_name {
        "claude" => {
            cmd_parts.push("--dangerously-skip-permissions".to_string());
        }
        "codex" => {
            // codex needs `exec` subcommand for non-interactive mode
            cmd_parts.push("exec".to_string());
            cmd_parts.push("--dangerously-bypass-approvals-and-sandbox".to_string());
            cmd_parts.push("--skip-git-repo-check".to_string());
        }
        _ => {}
    }

    cmd_parts.extend(args.iter().cloned());
    if !initial_prompt.is_empty() {
        let escaped = initial_prompt.replace('\'', "'\\''");
        // claude CLI uses -p for prompt; codex exec takes prompt as positional arg
        if cli_name == "claude" {
            cmd_parts.push("-p".to_string());
        }
        cmd_parts.push(format!("'{}'", escaped));
    }
    cmd_parts.join(" ")
}

/// Run a CLI trigger by injecting the command into the task's tmux session.
///
/// Uses `tmux send-keys` for command injection and `tmux wait-for` for
/// completion detection. No sentinel patterns, no shell ready detection —
/// tmux handles all of that.
pub fn spawn_cli_trigger_task(
    app: AppHandle,
    task_id: String,
    cli_command: String,
    args: Vec<String>,
    working_dir: String,
    initial_prompt: String,
    _env_vars: Option<HashMap<String, String>>,
) {
    // Create agent session record so the UI can track this agent
    let session_id = {
        if let Ok(conn) = Connection::open(db::db_path()) {
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
            match db::insert_agent_session(&conn, &task_id, &cli_command, Some(&working_dir)) {
                Ok(session) => {
                    let _ = db::update_agent_session(
                        &conn, &session.id,
                        None, Some("running"), None, None, None, None,
                    );
                    let _ = db::update_task_agent_status(&conn, &task_id, Some("running"), None);
                    let ts = db::now();
                    let _ = conn.execute(
                        "UPDATE tasks SET agent_session_id = ?1, updated_at = ?2 WHERE id = ?3",
                        rusqlite::params![session.id, ts, task_id],
                    );
                    pipeline::emit_tasks_changed(&app, "", "agent_session_created");
                    Some(session.id)
                }
                Err(e) => {
                    log::error!("[bridge] Failed to create agent session: {}", e);
                    None
                }
            }
        } else {
            None
        }
    };

    // Capture the column_id at trigger time — used to verify task hasn't moved before mark_complete
    let trigger_column_id = {
        if let Ok(conn) = Connection::open(db::db_path()) {
            db::get_task(&conn, &task_id).ok().map(|t| t.column_id)
        } else {
            None
        }
    };

    tokio::spawn(async move {
        let start_time = std::time::Instant::now();
        let full_cmd = build_trigger_command(&cli_command, &args, &initial_prompt);
        let log_file = format!("{}/trigger_{}.log", crate::db::data_dir().display(), gen_nonce());

        let result: Result<(), String> = async {
            // ── Direct process execution (no tmux) ─────────────────────
            // Pipeline triggers run as direct child processes. No tmux,
            // no PTY bridge, no attach process. This eliminates SIGHUP
            // from terminal disconnects and idle sweep kills.

            eprintln!("[bridge] Spawning direct process for task {}", task_id);
            eprintln!("[bridge] CLI command: {}", full_cmd);
            eprintln!("[bridge] Working dir: {}", working_dir);

            // Open log file for stdout/stderr capture
            let log_out = std::fs::File::create(&log_file)
                .map_err(|e| format!("Failed to create log file: {}", e))?;
            let log_err = log_out.try_clone()
                .map_err(|e| format!("Failed to clone log file: {}", e))?;

            // Build the command — use shell to handle the full command string
            // (which includes pipes, semicolons, quotes from build_trigger_command)
            let mut child = tokio::process::Command::new("bash")
                .args(["-c", &full_cmd])
                .current_dir(&working_dir)
                .stdout(log_out)
                .stderr(log_err)
                .stdin(std::process::Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to spawn CLI process: {}", e))?;

            let child_pid = child.id().unwrap_or(0);
            eprintln!("[bridge] Process spawned for task {}: PID {}", task_id, child_pid);

            // Update PID in agent session record
            if let Some(ref sid) = session_id {
                if let Ok(conn) = Connection::open(db::db_path()) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = db::update_agent_session(
                        &conn, sid,
                        Some(Some(child_pid as i64)), None, None, None, None, None,
                    );
                }
            }

            // Wait for process to complete with 2-hour timeout
            let status = tokio::time::timeout(
                std::time::Duration::from_secs(7200),
                child.wait(),
            )
            .await
            .map_err(|_| {
                // Kill the process on timeout
                let _ = child.start_kill();
                format!("Trigger timed out after 2 hours for task {}", task_id)
            })?
            .map_err(|e| format!("Process wait failed: {}", e))?;

            let exit_code = status.code().unwrap_or(1);
            // Keep log file on failure for debugging; clean up on success
            if exit_code == 0 {
                let _ = tokio::fs::remove_file(&log_file).await;
            } else {
                eprintln!("[bridge] Keeping log file for failed task {}: {}", task_id, log_file);
            }

            let success = exit_code == 0;
            eprintln!("[bridge] Trigger completed for task {}: exit_code={}, success={}", task_id, exit_code, success);

            // Update agent session + task status — but only if task hasn't moved columns
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

                // Guard: check task is still in the same column as when trigger fired
                let task_still_here = db::get_task(&conn, &task_id)
                    .ok()
                    .map(|t| trigger_column_id.as_deref() == Some(&t.column_id))
                    .unwrap_or(false);

                if !task_still_here {
                    eprintln!("[bridge] Task {} moved columns during trigger — skipping mark_complete", task_id);
                } else {
                    let status = if success { "completed" } else { "failed" };
                    let _ = db::update_task_agent_status(&conn, &task_id, Some(status), None);

                    // Update agent_session status (exit criteria checks this)
                    if let Ok(task) = db::get_task(&conn, &task_id) {
                        if let Some(ref sid) = task.agent_session_id {
                            let _ = db::update_agent_session(
                                &conn, sid,
                                None, Some(status), Some(Some(exit_code as i64)), None, None, None,
                            );
                        }
                    }

                    // Record duration-based usage (token counts require CLI output parsing — future work)
                    let duration_secs = start_time.elapsed().as_secs() as i64;
                    if let Ok(task) = db::get_task(&conn, &task_id) {
                        let model_name = task.model.as_deref().unwrap_or("unknown");
                        let column_name = db::get_column(&conn, &task.column_id)
                            .map(|c| c.name).unwrap_or_default();
                        // Insert usage record with duration (tokens TBD — requires parsing CLI output)
                        let _ = db::insert_usage_record(
                            &conn, &task.workspace_id,
                            Some(&task_id), session_id.as_deref(),
                            "anthropic", model_name, 0, 0, 0.0,
                            Some(&column_name), duration_secs,
                        );
                        eprintln!("[bridge] Usage recorded: task={} column={} model={} duration={}s",
                            &task_id[..8], column_name, model_name, duration_secs);
                    }

                    if success {
                        let _ = pipeline::mark_complete(&conn, &app, &task_id, true);
                    } else {
                        let detail = format!("Agent exited with code {}", exit_code);
                        let _ = pipeline::mark_complete_with_error(&conn, &app, &task_id, false, Some(&detail));
                    }
                }
            }
            pipeline::emit_tasks_changed(&app, "", "trigger_complete");

            Ok(())
        }
        .await;

        if let Err(e) = result {
            let error_detail = format!("CLI trigger '{}' failed for task {}: {}", cli_command, task_id, e);
            eprintln!("[bridge] {}", error_detail);
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

                let _ = conn.execute(
                    "UPDATE tasks SET pipeline_error = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![error_detail, db::now(), task_id],
                );

                if let Some(ref sid) = session_id {
                    let _ = db::update_agent_session(
                        &conn, sid,
                        None, Some("failed"), Some(Some(1)), None, None, None,
                    );
                    let _ = db::update_task_agent_status(&conn, &task_id, Some("failed"), None);
                }

                if let Ok(task) = db::get_task(&conn, &task_id) {
                    if let Ok(col) = db::get_column(&conn, &task.column_id) {
                        let _ =
                            pipeline::handle_trigger_failure(&conn, &app, &task, &col, &error_detail);
                    }
                }
            }
            pipeline::emit_tasks_changed(&app, "", "trigger_failed");

            // Clean up log file on error too
            let _ = tokio::fs::remove_file(&log_file).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gen_nonce() {
        let a = gen_nonce();
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_build_trigger_command_codex() {
        let cmd = build_trigger_command("codex exec", &[], "do the thing");
        assert!(cmd.starts_with("codex exec"));
        assert!(cmd.contains("do the thing"));
        assert!(!cmd.contains("-p")); // codex doesn't use -p
    }

    #[test]
    fn test_build_trigger_command_claude() {
        let cmd = build_trigger_command("claude", &[], "do the thing");
        assert!(cmd.contains("-p")); // claude uses -p for prompt
        assert!(cmd.contains("do the thing"));
    }

    #[test]
    fn test_build_trigger_command_with_args() {
        let cmd = build_trigger_command("codex", &["--model".to_string(), "gpt-5".to_string()], "hello");
        assert_eq!(
            cmd,
            "codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --model gpt-5 'hello'"
        );
    }
}
