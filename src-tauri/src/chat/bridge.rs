//! Bridges transport events to Tauri frontend events.
//!
//! The unified transport layer emits events via channels, but the frontend
//! expects Tauri events (`pty:{taskId}:output`, `pty:{taskId}:exit`).
//! This module provides helpers to forward transport events to the frontend,
//! and a background task runner for CLI triggers.

use std::collections::HashMap;

use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

use super::events::ChatEvent;
use super::registry::SharedSessionRegistry;
use super::session::{SessionConfig, TransportType};
use super::tmux_transport;
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

/// tmux session name for a task (delegates to tmux_transport for single source of truth).
fn tmux_session_name(task_id: &str) -> String {
    tmux_transport::session_name(task_id)
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
        let nonce = gen_nonce();
        let wait_channel = format!("bywait_{}", nonce);
        let exit_file = {
            let data_dir = crate::db::data_dir();
            format!("{}/exit_{}", data_dir.display(), nonce)
        };
        let tmux_name = tmux_session_name(&task_id);

        let result: Result<(), String> = async {
            let registry: SharedSessionRegistry = app.state::<SharedSessionRegistry>().inner().clone();

            // Ensure a tmux-backed PTY session exists
            {
                let mut reg = registry.lock().await;
                let session_alive = reg.get(&task_id).map(|s| s.is_alive()).unwrap_or(false);

                if !session_alive {
                    // Spawn a fresh tmux session
                    reg.remove(&task_id);

                    // Kill any stale tmux session left over from a dead agent.
                    // Without this, `spawn()` would reattach to the zombie session
                    // instead of creating a fresh one, causing trigger retries to fail.
                    if tmux_transport::has_session(&task_id) {
                        eprintln!(
                            "[bridge] Killing stale tmux session {} before retry",
                            tmux_name
                        );
                        if let Err(e) = tmux_transport::kill_session(&task_id) {
                            eprintln!("[bridge] Failed to kill stale tmux session: {}", e);
                        }
                    }

                    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
                    let config = SessionConfig {
                        cli_path: shell,
                        model: String::new(),
                        system_prompt: String::new(),
                        working_dir: Some(working_dir.clone()),
                        effort_level: None,
                    };

                    let session = reg
                        .get_or_create(&task_id, config, TransportType::Pty)
                        .map_err(|e| e.to_string())?;

                    let _mpsc_rx = session.start_pty(120, 40)?;

                    // Start managed bridge
                    if let Some(rx) = session.resubscribe() {
                        let bridge = ManagedBridge::start(app.clone(), task_id.clone(), rx);
                        reg.set_bridge(&task_id, bridge);
                    }
                }

                // Ensure bridge is running for existing sessions too
                let needs_bridge = !reg.has_active_bridge(&task_id);
                if needs_bridge {
                    let rx = reg.get(&task_id).and_then(|s| s.resubscribe());
                    if let Some(rx) = rx {
                        let bridge = ManagedBridge::start(app.clone(), task_id.clone(), rx);
                        reg.set_bridge(&task_id, bridge);
                    }
                }

                // Update PID in agent session record
                if let Some(ref sid) = session_id {
                    if let Some(pid) = reg.get(&task_id).and_then(|s| s.pid()) {
                        if let Ok(conn) = Connection::open(db::db_path()) {
                            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                            let _ = db::update_agent_session(
                                &conn, sid,
                                Some(Some(pid as i64)), None, None, None, None, None,
                            );
                        }
                    }
                }
            }
            // Registry lock released

            // Inject command via tmux send-keys with wait-for completion
            // Format: {command}; echo $? > {exit_file}; tmux wait-for -S {channel}
            let wrapped_cmd = format!(
                "{}; echo $? > {}; tmux wait-for -S {}",
                full_cmd, exit_file, wait_channel
            );

            eprintln!("[bridge] Injecting via tmux send-keys for task {}: {}", task_id, full_cmd);

            let send_output = tokio::process::Command::new("tmux")
                .args(["send-keys", "-t", &tmux_name, "-l", &wrapped_cmd])
                .output()
                .await
                .map_err(|e| format!("tmux send-keys failed: {}", e))?;

            if !send_output.status.success() {
                let stderr = String::from_utf8_lossy(&send_output.stderr);
                return Err(format!("tmux send-keys error: {}", stderr.trim()));
            }

            // Send Enter separately (not literal)
            let enter_output = tokio::process::Command::new("tmux")
                .args(["send-keys", "-t", &tmux_name, "Enter"])
                .output()
                .await
                .map_err(|e| format!("tmux send-keys failed: {}", e))?;

            if !enter_output.status.success() {
                let stderr = String::from_utf8_lossy(&enter_output.stderr);
                return Err(format!("tmux send-keys Enter error: {}", stderr.trim()));
            }

            // Wait for command completion via tmux wait-for (blocks until signaled)
            // Timeout after 2 hours to prevent permanently stuck tasks
            eprintln!("[bridge] Waiting for completion via tmux wait-for: {}", wait_channel);

            let wait_future = tokio::process::Command::new("tmux")
                .args(["wait-for", &wait_channel])
                .output();

            let wait_output = tokio::time::timeout(
                std::time::Duration::from_secs(7200), // 2 hour max
                wait_future,
            )
            .await
            .map_err(|_| format!("Trigger timed out after 2 hours for task {}", task_id))?
            .map_err(|e| format!("tmux wait-for failed: {}", e))?;

            if !wait_output.status.success() {
                let stderr = String::from_utf8_lossy(&wait_output.stderr);
                return Err(format!("tmux wait-for error: {}", stderr.trim()));
            }

            // Read exit code from temp file
            let exit_code = tokio::fs::read_to_string(&exit_file)
                .await
                .ok()
                .and_then(|s| s.trim().parse::<i32>().ok())
                .unwrap_or(1); // Default to failure if can't read

            // Clean up temp file
            let _ = tokio::fs::remove_file(&exit_file).await;

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

            // Clean up temp file on error too
            let _ = tokio::fs::remove_file(&exit_file).await;
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
        assert_eq!(cmd, "codex --model gpt-5 'hello'");
    }

    #[test]
    fn test_tmux_session_name() {
        assert_eq!(tmux_session_name("task-123"), "bentoya_task-123");
    }
}
