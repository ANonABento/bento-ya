//! Bridges transport events to Tauri frontend events, and runs CLI pipeline
//! triggers inside per-task tmux sessions.
//!
//! Every pipeline trigger runs inside a tmux session named
//! `bentoya_<task_id>` — the same naming used by interactive chat sessions.
//! The frontend's `TerminalView` attaches to that session via
//! `ensure_pty_session` and gets a live, interactive view. Completion
//! detection uses `tmux wait-for` plus an exit-code sentinel file, so the
//! pipeline still knows when the agent finished and with what status.
//!
//! The Tauri events `pty:{taskId}:output` and `pty:{taskId}:exit` continue
//! to be the contract with the frontend; they're emitted by `ManagedBridge`
//! when a UI client attaches.
//!
//! Output capture for rate-limit detection and persistence is done by
//! `tmux pipe-pane`, which mirrors the pane's raw output to a log file in
//! `~/.bentoya/trigger_logs/`. We read that file on completion to drive
//! rate-limit detection and `tasks.pipeline_error`.

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rusqlite::Connection;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

use super::events::ChatEvent;
use super::log_retention;
use super::tmux_transport;
use super::transport::TransportEvent;
use crate::db;
use crate::pipeline;

// ─── Tunables ─────────────────────────────────────────────────────────────

/// Tail of the log copied into `tasks.pipeline_error` on failure.
const PIPELINE_ERROR_TAIL_BYTES: usize = 4 * 1024;
/// Live tail surfaced in `agent_sessions.last_output`.
const LAST_OUTPUT_TAIL_BYTES: usize = 16 * 1024;
/// Final scrollback persisted in `agent_sessions.scrollback` (head-truncated).
const SCROLLBACK_MAX_BYTES: usize = 256 * 1024;
/// Periodic flush cadence — the upper bound between live updates.
const FLUSH_INTERVAL: Duration = Duration::from_secs(3);
/// Fallback when we can't parse the rate-limit reset time.
const RATE_LIMIT_FALLBACK_DELAY: Duration = Duration::from_secs(60 * 60);
/// Hard cap on the trigger duration before we kill the tmux session.
const TRIGGER_TIMEOUT: Duration = Duration::from_secs(60 * 60 * 2);
/// How often we poll for completion when running `tmux wait-for` is too
/// blocking. We use a separate task for the wait-for so the timeout still
/// applies.
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// Default window dimensions when the trigger runs headless (no UI attached).
const DEFAULT_TRIGGER_COLS: u16 = 200;
const DEFAULT_TRIGGER_ROWS: u16 = 50;

/// Generate a random 16-char hex nonce (used for tmux wait-for channel names
/// and exit-code sentinel files).
fn gen_nonce() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let s = RandomState::new();
    let mut h = s.build_hasher();
    h.write_u64(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64,
    );
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
    pub fn start(app: AppHandle, task_id: String, rx: broadcast::Receiver<TransportEvent>) -> Self {
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
            let _ = app.emit(
                "agent:stream",
                &serde_json::json!({
                    "taskId": task_id,
                    "content": text,
                }),
            );
            false
        }
        TransportEvent::Chat(ChatEvent::ThinkingContent {
            ref content,
            is_complete,
        }) => {
            let _ = app.emit(
                "agent:thinking",
                &serde_json::json!({
                    "taskId": task_id,
                    "content": content,
                    "isComplete": is_complete,
                }),
            );
            false
        }
        TransportEvent::Chat(ChatEvent::ToolUse {
            ref id,
            ref name,
            ref input,
            ref status,
        }) => {
            let _ = app.emit(
                "agent:tool_call",
                &serde_json::json!({
                    "taskId": task_id,
                    "toolId": id,
                    "toolName": name,
                    "toolInput": input.clone().unwrap_or_default(),
                    "status": format!("{:?}", status).to_lowercase(),
                }),
            );
            false
        }
        TransportEvent::Chat(ChatEvent::Complete) => {
            if !accumulated_text.is_empty() {
                if let Ok(conn) = Connection::open(db::db_path()) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = db::insert_agent_message(
                        &conn,
                        task_id,
                        "assistant",
                        accumulated_text,
                        None,
                        None,
                        None,
                        None,
                    );
                }
                accumulated_text.clear();
            }
            let _ = app.emit(
                "agent:complete",
                &serde_json::json!({
                    "taskId": task_id,
                    "success": true,
                }),
            );
            false
        }
        TransportEvent::Exited(exit_code) => {
            if !accumulated_text.is_empty() {
                if let Ok(conn) = Connection::open(db::db_path()) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = db::insert_agent_message(
                        &conn,
                        task_id,
                        "assistant",
                        accumulated_text,
                        None,
                        None,
                        None,
                        None,
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
            // codex needs `exec` subcommand for non-interactive mode.
            // `--full-auto` is the supported convenience alias for low-friction
            // sandboxed automatic execution. Older codex builds rejected
            // `--dangerously-bypass-approvals-and-sandbox` outright (the source
            // of thousands of historical 58-byte stub failures), so we use the
            // longer-lived `--full-auto` form which is portable across versions.
            cmd_parts.push("exec".to_string());
            cmd_parts.push("--full-auto".to_string());
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

// ─── Rate-limit detection ─────────────────────────────────────────────────

/// Heuristic match for provider rate-limit messages. Looks for the
/// case-insensitive substring "you've hit your limit" anywhere in the captured
/// output. The message can be surrounded by ANSI escape codes or wrapped in
/// other lines, so we match on substring rather than full lines.
pub(crate) fn is_rate_limit_output(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    lower.contains("you've hit your limit") || lower.contains("you have hit your limit")
}

/// Parse the reset time mentioned after the literal "resets " in the rate-limit
/// message and convert it to a delay from now. Falls back to
/// `RATE_LIMIT_FALLBACK_DELAY` when parsing fails.
pub(crate) fn parse_rate_limit_delay(content: &str) -> Duration {
    parse_rate_limit_delay_from(content, chrono::Local::now())
        .unwrap_or(RATE_LIMIT_FALLBACK_DELAY)
}

fn parse_rate_limit_delay_from<Tz: chrono::TimeZone>(
    content: &str,
    now: chrono::DateTime<Tz>,
) -> Option<Duration>
where
    Tz::Offset: Copy,
{
    let target = parse_reset_time(content)?;
    let now_naive = now.naive_local();
    let mut target_dt = now_naive.date().and_time(target);
    if target_dt <= now_naive {
        target_dt += chrono::Duration::days(1);
    }
    let delta = target_dt.signed_duration_since(now_naive);
    let secs = delta.num_seconds();
    if secs <= 0 {
        return None;
    }
    // Floor to at least 60s to avoid hammering the provider on near-misses.
    Some(Duration::from_secs(secs.max(60) as u64))
}

/// Extract the time string after "resets " and parse it. Supports `12pm`,
/// `1:30 PM`, `13:00`, with or without internal whitespace.
fn parse_reset_time(content: &str) -> Option<chrono::NaiveTime> {
    let lower = content.to_ascii_lowercase();
    let idx = lower.find("resets ")?;
    let after = &content[idx + "resets ".len()..];
    let time_str = extract_time_token(after)?;
    parse_clock_time(&time_str)
}

/// Pull the leading clock-time substring from `s`. Stops at `(`, newline, or
/// any non-time character. Allows one internal whitespace between the digits
/// and an `am`/`pm` marker (so "1:30 PM" works), but no trailing junk.
fn extract_time_token(s: &str) -> Option<String> {
    let mut buf = String::new();
    let mut chars = s.chars().peekable();
    let mut allowed_space = true;
    while let Some(&c) = chars.peek() {
        if c == '(' || c == '\n' || c == '\r' || c == ',' {
            break;
        }
        if c.is_whitespace() {
            if !allowed_space {
                break;
            }
            // Only swallow the space if what follows looks like am/pm.
            let lookahead: String = chars.clone().skip(1).take(2).collect();
            let la_lower = lookahead.to_ascii_lowercase();
            if la_lower.starts_with("am") || la_lower.starts_with("pm") {
                buf.push(' ');
                chars.next();
                allowed_space = false;
                continue;
            }
            break;
        }
        if c.is_ascii_alphanumeric() || c == ':' {
            buf.push(c);
            chars.next();
        } else {
            break;
        }
    }
    let trimmed = buf.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_clock_time(s: &str) -> Option<chrono::NaiveTime> {
    let lower = s.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }

    // `extract_time_token` strips non-alphanumeric chars (including dots), so
    // we only need to handle the bare am/pm forms here.
    let (time_part, ampm) = if let Some(rest) = lower.strip_suffix("am") {
        (rest.trim(), Some(false))
    } else if let Some(rest) = lower.strip_suffix("pm") {
        (rest.trim(), Some(true))
    } else {
        (lower.as_str(), None)
    };

    let (raw_h, raw_m) = match time_part.find(':') {
        Some(idx) => {
            let h: u32 = time_part[..idx].trim().parse().ok()?;
            let m: u32 = time_part[idx + 1..].trim().parse().ok()?;
            (h, m)
        }
        None => {
            if time_part.is_empty() {
                return None;
            }
            (time_part.parse().ok()?, 0)
        }
    };

    if raw_m >= 60 {
        return None;
    }
    let hour = match ampm {
        Some(true) => {
            if raw_h == 12 {
                12
            } else if raw_h < 12 {
                raw_h + 12
            } else {
                return None;
            }
        }
        Some(false) => {
            if raw_h == 12 {
                0
            } else if raw_h < 12 {
                raw_h
            } else {
                return None;
            }
        }
        None => {
            if raw_h >= 24 {
                return None;
            }
            raw_h
        }
    };

    chrono::NaiveTime::from_hms_opt(hour, raw_m, 0)
}

/// Schedule a deferred re-fire of the trigger after `delay`. The retry runs in
/// its own tokio task and is gated on the task still being in the same column.
fn schedule_rate_limit_retry(
    app: AppHandle,
    task_id: String,
    trigger_column_id: Option<String>,
    delay: Duration,
) {
    tokio::spawn(async move {
        log::info!(
            "[bridge] rate-limit retry scheduled for task {} in {:?}",
            task_id,
            delay
        );
        tokio::time::sleep(delay).await;
        let conn = match Connection::open(db::db_path()) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[bridge] rate-limit retry: DB open failed: {}", e);
                return;
            }
        };
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
        let task = match db::get_task(&conn, &task_id) {
            Ok(t) => t,
            Err(_) => return,
        };
        if Some(&task.column_id) != trigger_column_id.as_ref() {
            log::info!(
                "[bridge] rate-limit retry: task {} moved columns, skipping",
                task_id
            );
            return;
        }
        let column = match db::get_column(&conn, &task.column_id) {
            Ok(c) => c,
            Err(_) => return,
        };
        let _ = db::update_task_pipeline_state(
            &conn,
            &task.id,
            pipeline::PipelineState::Idle.as_str(),
            None,
            None,
        );
        if let Err(e) = pipeline::fire_trigger(&conn, &app, &task, &column) {
            log::warn!(
                "[bridge] rate-limit retry: re-fire failed for task {}: {}",
                task_id,
                e
            );
        }
    });
}

// ─── Trigger runner (tmux-based) ──────────────────────────────────────────

/// Convenience: tmux session name for a task.
fn tmux_session_name(task_id: &str) -> String {
    tmux_transport::session_name(task_id)
}

/// Run `tmux <args>` and return Ok(stdout) on success, Err(stderr) otherwise.
fn run_tmux(args: &[&str]) -> Result<String, String> {
    let output = Command::new("tmux")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to spawn tmux: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "tmux {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Capture pane scrollback (with escape sequences). Returns empty string on
/// any error so callers can treat it as "no output captured".
fn capture_pane_scrollback(session: &str) -> String {
    Command::new("tmux")
        .args(["capture-pane", "-t", session, "-p", "-e", "-S", "-"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

/// Truncate a captured log to the trailing N bytes, on a UTF-8-safe boundary.
fn tail_bytes(s: &str, n: usize) -> String {
    if s.len() <= n {
        return s.to_string();
    }
    let start = s.len() - n;
    // Walk forward to a UTF-8 boundary so we don't slice a multi-byte char.
    let mut i = start;
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    s[i..].to_string()
}

/// Truncate the log to the trailing SCROLLBACK_MAX_BYTES on a char boundary.
fn truncate_for_scrollback(s: &str) -> String {
    tail_bytes(s, SCROLLBACK_MAX_BYTES)
}

/// Create a fresh tmux session for a pipeline trigger. Fails if a session
/// with the same name already exists — callers should kill stale sessions
/// first if they want a clean slate.
fn create_trigger_session(
    task_id: &str,
    working_dir: &str,
    cols: u16,
    rows: u16,
    env_vars: &HashMap<String, String>,
) -> Result<(), String> {
    let name = tmux_session_name(task_id);

    let cols_str = cols.to_string();
    let rows_str = rows.to_string();
    let mut args: Vec<&str> = vec![
        "new-session", "-d", "-s", &name, "-x", &cols_str, "-y", &rows_str,
    ];
    if Path::new(working_dir).exists() {
        args.push("-c");
        args.push(working_dir);
    }

    let mut cmd = Command::new("tmux");
    cmd.args(&args);
    for (k, v) in env_vars {
        cmd.env(k, v);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to spawn tmux new-session: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tmux new-session failed: {}", stderr.trim()));
    }
    Ok(())
}

/// Run a CLI trigger inside a tmux session named `bentoya_<task_id>`.
///
/// Behavior:
/// 1. Ensure the tmux server is running and create a fresh session for the task.
/// 2. Mirror pane output to a log file via `tmux pipe-pane`.
/// 3. Send the wrapped command into the session via `tmux send-keys`. The
///    wrapper writes the command's exit code to a sentinel file and signals
///    completion via `tmux wait-for -S`.
/// 4. Wait for that signal with a hard timeout; on timeout, kill the session.
/// 5. Read the exit code, capture pane scrollback for rate-limit detection
///    and for `tasks.pipeline_error`, then mark complete / schedule retry.
///
/// The frontend's `TerminalView` can attach (or be attached) at any time
/// during the trigger via `ensure_pty_session`, which finds the existing
/// tmux session and starts streaming live to xterm.js.
pub fn spawn_cli_trigger_task(
    app: AppHandle,
    task_id: String,
    cli_command: String,
    args: Vec<String>,
    working_dir: String,
    initial_prompt: String,
    env_vars: Option<HashMap<String, String>>,
) {
    // Create agent session record so the UI can track this agent
    let session_id = {
        if let Ok(conn) = Connection::open(db::db_path()) {
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
            match db::insert_agent_session(&conn, &task_id, &cli_command, Some(&working_dir)) {
                Ok(session) => {
                    let _ = db::update_agent_session(
                        &conn,
                        &session.id,
                        None,
                        Some("running"),
                        None,
                        None,
                        None,
                        None,
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

    // Capture column_id at trigger time — used to verify task hasn't moved
    // before mark_complete or before scheduling a rate-limit retry.
    let trigger_column_id = {
        if let Ok(conn) = Connection::open(db::db_path()) {
            db::get_task(&conn, &task_id).ok().map(|t| t.column_id)
        } else {
            None
        }
    };

    let env_vars = env_vars.unwrap_or_default();

    tokio::spawn(async move {
        let start_time = std::time::Instant::now();
        let full_cmd = build_trigger_command(&cli_command, &args, &initial_prompt);
        let nonce = gen_nonce();
        let log_path = log_retention::new_trigger_log_path(&nonce);
        let log_path_str = log_path.display().to_string();

        let result = run_trigger_in_tmux(
            &app,
            &task_id,
            &cli_command,
            &full_cmd,
            &working_dir,
            &log_path_str,
            &nonce,
            session_id.as_deref(),
            trigger_column_id.as_deref(),
            start_time,
            &env_vars,
        )
        .await;

        if let Err(error_detail) = result {
            let error_msg = format!(
                "CLI trigger '{}' failed for task {}: {}",
                cli_command, task_id, error_detail
            );
            eprintln!("[bridge] {}", error_msg);
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

                let _ = conn.execute(
                    "UPDATE tasks SET pipeline_error = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![error_msg, db::now(), task_id],
                );

                if let Some(ref sid) = session_id {
                    let _ = db::update_agent_session(
                        &conn,
                        sid,
                        None,
                        Some("failed"),
                        Some(Some(1)),
                        None,
                        None,
                        None,
                    );
                    let _ = db::update_task_agent_status(&conn, &task_id, Some("failed"), None);
                }

                if let Ok(task) = db::get_task(&conn, &task_id) {
                    if let Ok(col) = db::get_column(&conn, &task.column_id) {
                        let _ = pipeline::handle_trigger_failure(
                            &conn, &app, &task, &col, &error_msg,
                        );
                    }
                }
            }
            pipeline::emit_tasks_changed(&app, "", "trigger_failed");
        }
    });
}

#[allow(clippy::too_many_arguments)]
async fn run_trigger_in_tmux(
    app: &AppHandle,
    task_id: &str,
    cli_command: &str,
    full_cmd: &str,
    working_dir: &str,
    log_path: &str,
    nonce: &str,
    session_id: Option<&str>,
    trigger_column_id: Option<&str>,
    start_time: std::time::Instant,
    env_vars: &HashMap<String, String>,
) -> Result<(), String> {
    eprintln!("[bridge] Starting tmux-backed trigger for task {}", task_id);
    eprintln!("[bridge] CLI command: {}", full_cmd);
    eprintln!("[bridge] Working dir: {}", working_dir);
    eprintln!("[bridge] Log file: {}", log_path);

    // Make sure the tmux server is up; auto-start a default session if needed.
    tmux_transport::ensure_tmux_server()?;

    let session = tmux_session_name(task_id);

    // If a stale session for this task already exists (e.g. previous run crashed),
    // kill it. We want a clean window for this trigger.
    if tmux_transport::has_session(task_id) {
        eprintln!(
            "[bridge] Killing stale tmux session before trigger: {}",
            session
        );
        let _ = tmux_transport::kill_session(task_id);
    }

    // Create the session detached. UI clients can attach later and see the
    // same pane. Use a generous default size; UI attach will resize.
    create_trigger_session(
        task_id,
        working_dir,
        DEFAULT_TRIGGER_COLS,
        DEFAULT_TRIGGER_ROWS,
        env_vars,
    )?;

    // Mirror pane output to a log file. We use `pipe-pane -O` (Open) to log
    // to the file; -o would toggle. The shell wrapper handles redirection.
    let pipe_cmd = format!("cat > '{}'", shell_quote(log_path));
    if let Err(e) = run_tmux(&["pipe-pane", "-t", &session, "-O", &pipe_cmd]) {
        log::warn!("[bridge] pipe-pane failed (continuing): {}", e);
    }

    // Path for the exit-code sentinel file.
    let exit_path = format!(
        "{}/exit_{}.code",
        log_retention::trigger_logs_dir().display(),
        nonce
    );
    let wait_channel = format!("bentoya_done_{}", nonce);

    // Build the wrapped command. We send it as a single line via send-keys
    // with `Enter`. Layout:
    //   <full_cmd>; printf '%s' "$?" > <exit_file>; tmux wait-for -S <chan>
    //
    // Note: full_cmd already contains shell quoting for the prompt; we just
    // append our completion-signaling tail. We also `clear` first so the
    // user sees a clean pane when they attach.
    let wrapped = format!(
        "clear; {}; rc=$?; printf '%s' \"$rc\" > {}; tmux wait-for -S {}",
        full_cmd,
        shell_quote_arg(&exit_path),
        wait_channel
    );

    // Send the command into the session. Use `-l` to send literally so any
    // embedded special chars don't get re-interpreted by tmux. Then `Enter`.
    // We split into two send-keys calls because `-l` doesn't interpret keys.
    if let Err(e) = run_tmux(&["send-keys", "-t", &session, "-l", &wrapped]) {
        let _ = tmux_transport::kill_session(task_id);
        return Err(format!("send-keys (literal) failed: {}", e));
    }
    if let Err(e) = run_tmux(&["send-keys", "-t", &session, "Enter"]) {
        let _ = tmux_transport::kill_session(task_id);
        return Err(format!("send-keys Enter failed: {}", e));
    }

    // Spawn a periodic flusher that snapshots scrollback into the DB so the
    // last_output column stays fresh while the trigger runs. This is the
    // tmux equivalent of the old direct-subprocess flusher.
    let flusher_stop = Arc::new(AtomicBool::new(false));
    let flusher_handle: Option<tokio::task::JoinHandle<()>> = session_id.map(|sid| {
        let session_for_flusher = session.clone();
        let sid = sid.to_string();
        let stop = Arc::clone(&flusher_stop);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(FLUSH_INTERVAL).await;
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                let scrollback = capture_pane_scrollback(&session_for_flusher);
                if scrollback.is_empty() {
                    continue;
                }
                let tail = tail_bytes(&scrollback, LAST_OUTPUT_TAIL_BYTES);
                if let Ok(conn) = Connection::open(db::db_path()) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = db::update_agent_session_output(&conn, &sid, Some(&tail), None);
                }
            }
        })
    });

    // Wait for the wait-for signal in a blocking task with a timeout.
    let wait_handle = tokio::task::spawn_blocking({
        let chan = wait_channel.clone();
        move || {
            let output = Command::new("tmux")
                .args(["wait-for", &chan])
                .output();
            match output {
                Ok(o) if o.status.success() => Ok(()),
                Ok(o) => Err(format!(
                    "tmux wait-for failed: {}",
                    String::from_utf8_lossy(&o.stderr).trim()
                )),
                Err(e) => Err(format!("tmux wait-for spawn error: {}", e)),
            }
        }
    });

    let timed_out = match tokio::time::timeout(TRIGGER_TIMEOUT, wait_handle).await {
        Ok(Ok(Ok(()))) => false,
        Ok(Ok(Err(e))) => {
            // wait-for exited non-zero — usually because the session was killed.
            log::warn!("[bridge] wait-for returned error for task {}: {}", task_id, e);
            false
        }
        Ok(Err(join_err)) => {
            log::warn!(
                "[bridge] wait-for join error for task {}: {}",
                task_id,
                join_err
            );
            false
        }
        Err(_) => true,
    };

    // Stop the flusher.
    flusher_stop.store(true, Ordering::Relaxed);
    if let Some(h) = flusher_handle {
        // Don't await — the flusher sleeps up to FLUSH_INTERVAL between checks
        // and we don't want to wait that long. Just abort it.
        h.abort();
    }

    if timed_out {
        eprintln!(
            "[bridge] Trigger timed out for task {} after {:?}; killing session",
            task_id, TRIGGER_TIMEOUT
        );
        // Send a stronger signal first; if pane is still alive, killing the
        // whole session takes everything down.
        tmux_transport::cancel_agent(task_id);
        // Give it a moment to settle, then kill the session.
        tokio::time::sleep(WAIT_POLL_INTERVAL).await;
        let _ = tmux_transport::kill_session(task_id);
    }

    // ─── Result handling ────────────────────────────────────────────────

    // Read exit code from sentinel file (if we got one).
    let exit_code: Option<i32> = std::fs::read_to_string(&exit_path)
        .ok()
        .and_then(|s| s.trim().parse::<i32>().ok());

    // Best-effort cleanup of the sentinel file.
    let _ = std::fs::remove_file(&exit_path);

    // Capture full scrollback for persistence + rate-limit scan. Prefer the
    // log file (preserved across runs) but fall back to live pane capture if
    // the file is empty (e.g. pipe-pane never opened in time).
    let log_contents = std::fs::read_to_string(log_path).unwrap_or_default();
    let scrollback_full = if !log_contents.is_empty() {
        log_contents
    } else {
        capture_pane_scrollback(&session)
    };
    let scrollback = truncate_for_scrollback(&scrollback_full);
    let error_tail = tail_bytes(&scrollback, PIPELINE_ERROR_TAIL_BYTES);
    let last_output_tail = tail_bytes(&scrollback, LAST_OUTPUT_TAIL_BYTES);

    // Resolve effective exit code:
    //   - timed out: synthetic 124 (mimics `timeout` utility)
    //   - missing sentinel but session vanished: synthetic 1 (failure)
    //   - otherwise the parsed value
    let effective_exit = match (timed_out, exit_code) {
        (true, _) => 124,
        (false, Some(code)) => code,
        (false, None) => 1,
    };
    let success = effective_exit == 0;

    eprintln!(
        "[bridge] Trigger completed for task {}: exit_code={}, success={} log={}",
        task_id, effective_exit, success, log_path
    );

    // IMPORTANT: do not kill the tmux session yet. We must update the task's
    // agent_status BEFORE the session disappears, otherwise the GC sweep
    // (which marks "running" tasks with no tmux session as failed) can race
    // us and overwrite a successful completion. The session is killed at the
    // very end of this function, after all DB writes are committed.

    if let Ok(conn) = Connection::open(db::db_path()) {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

        // Persist final scrollback + a fresh last_output regardless of success.
        if let Some(sid) = session_id {
            let _ = db::update_agent_session_output(
                &conn,
                sid,
                Some(&last_output_tail),
                Some(&scrollback),
            );
        }

        // Rate-limit branch — do NOT mark failed, just schedule a future retry.
        if !success && is_rate_limit_output(&scrollback) {
            let delay = parse_rate_limit_delay(&scrollback);
            log::warn!(
                "[bridge] task {} hit provider rate limit; scheduling retry in {:?}",
                task_id,
                delay
            );
            if let Some(sid) = session_id {
                let _ = db::update_agent_session(
                    &conn,
                    sid,
                    None,
                    Some("rate_limited"),
                    Some(Some(effective_exit as i64)),
                    None,
                    None,
                    None,
                );
            }
            let _ = db::update_task_agent_status(&conn, task_id, Some("idle"), None);
            let _ = db::update_task_pipeline_state(
                &conn,
                task_id,
                pipeline::PipelineState::RateLimited.as_str(),
                None,
                Some(&format!("Rate limited; retrying in {}m", delay.as_secs() / 60)),
            );
            pipeline::emit_tasks_changed(app, "", "trigger_rate_limited");
            schedule_rate_limit_retry(
                app.clone(),
                task_id.to_string(),
                trigger_column_id.map(str::to_string),
                delay,
            );
            // Clean up the tmux session — the agent has already exited inside
            // it, no point leaving a dead shell hanging around.
            let _ = tmux_transport::kill_session(task_id);
            return Ok(());
        }

        // Guard: only mark complete if task hasn't moved columns.
        let task_still_here = db::get_task(&conn, task_id)
            .ok()
            .map(|t| trigger_column_id == Some(t.column_id.as_str()))
            .unwrap_or(false);

        if !task_still_here {
            eprintln!(
                "[bridge] Task {} moved columns during trigger — skipping mark_complete",
                task_id
            );
        } else {
            let status_str = if success { "completed" } else { "failed" };
            let _ = db::update_task_agent_status(&conn, task_id, Some(status_str), None);

            if let Ok(task) = db::get_task(&conn, task_id) {
                if let Some(ref sid) = task.agent_session_id {
                    let _ = db::update_agent_session(
                        &conn,
                        sid,
                        None,
                        Some(status_str),
                        Some(Some(effective_exit as i64)),
                        None,
                        None,
                        None,
                    );
                }
            }

            // Record duration-based usage (token counts require CLI parsing).
            let duration_secs = start_time.elapsed().as_secs() as i64;
            if let Ok(task) = db::get_task(&conn, task_id) {
                let model_name = task.model.as_deref().unwrap_or("unknown");
                let column_name = db::get_column(&conn, &task.column_id)
                    .map(|c| c.name)
                    .unwrap_or_default();
                let _ = db::insert_usage_record(
                    &conn,
                    &task.workspace_id,
                    Some(task_id),
                    session_id,
                    "anthropic",
                    model_name,
                    0,
                    0,
                    0.0,
                    Some(&column_name),
                    duration_secs,
                );
            }

            if success {
                let _ = pipeline::mark_complete(&conn, app, task_id, true);
            } else {
                // Surface the real CLI error tail to the UI tooltip via
                // pipeline_error instead of a generic "exit code N" message.
                let detail = if error_tail.trim().is_empty() {
                    format!("Agent exited with code {}", effective_exit)
                } else {
                    let mut msg = format!("Agent exited with code {}: ", effective_exit);
                    msg.push_str(error_tail.trim());
                    msg
                };
                let _ = pipeline::mark_complete_with_error(
                    &conn,
                    app,
                    task_id,
                    false,
                    Some(&detail),
                );
            }
        }
    }

    pipeline::emit_tasks_changed(app, "", "trigger_complete");

    // NOW kill the tmux session — DB status is committed, so the GC won't
    // race us. The agent inside the pane has already exited (we observed
    // its exit code via the sentinel file), so all this does is clean up
    // the shell that was waiting on `tmux wait-for`.
    let _ = tmux_transport::kill_session(task_id);

    // Touch a known-unused parameter to silence dead-code warnings if needed.
    let _ = cli_command;

    Ok(())
}

// ─── Shell quoting helpers ────────────────────────────────────────────────

/// Wrap a value in single quotes, escaping any inner single quotes.
fn shell_quote_arg(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Escape a string so it can be inserted between single quotes (no surrounding
/// quotes added — the caller wraps it).
fn shell_quote(s: &str) -> String {
    s.replace('\'', "'\\''")
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
        let cmd = build_trigger_command("codex", &[], "do the thing");
        assert!(cmd.starts_with("codex exec"));
        assert!(cmd.contains("--full-auto"));
        assert!(!cmd.contains("--dangerously-bypass"));
        assert!(cmd.contains("do the thing"));
        assert!(!cmd.contains(" -p "));
    }

    #[test]
    fn test_build_trigger_command_claude() {
        let cmd = build_trigger_command("claude", &[], "do the thing");
        assert!(cmd.contains("-p"));
        assert!(cmd.contains("do the thing"));
    }

    #[test]
    fn test_build_trigger_command_with_args() {
        let cmd = build_trigger_command(
            "codex",
            &["--model".to_string(), "gpt-5".to_string()],
            "hello",
        );
        assert_eq!(
            cmd,
            "codex exec --full-auto --skip-git-repo-check --model gpt-5 'hello'"
        );
    }

    #[test]
    fn test_tmux_session_name() {
        assert_eq!(tmux_session_name("task-123"), "bentoya_task-123");
    }

    #[test]
    fn test_shell_quote_arg() {
        assert_eq!(shell_quote_arg("hello"), "'hello'");
        assert_eq!(shell_quote_arg("it's me"), "'it'\\''s me'");
    }

    #[test]
    fn test_tail_bytes_short_input() {
        assert_eq!(tail_bytes("abc", 100), "abc");
    }

    #[test]
    fn test_tail_bytes_truncates() {
        let s = "a".repeat(2000);
        let tail = tail_bytes(&s, 1000);
        assert_eq!(tail.len(), 1000);
        assert!(tail.chars().all(|c| c == 'a'));
    }

    #[test]
    fn test_tail_bytes_utf8_safe() {
        // Build a string with a multi-byte char near the truncation boundary.
        let prefix = "a".repeat(998);
        let s = format!("{}é", prefix); // é is 2 bytes
        let tail = tail_bytes(&s, 1000);
        // Should land on a char boundary, not in the middle of é.
        assert!(tail.is_char_boundary(0));
        assert!(tail.ends_with('é'));
    }

    // ─── Rate-limit detection ─────────────────────────────────────────────

    #[test]
    fn test_is_rate_limit_output_positive() {
        assert!(is_rate_limit_output(
            "You've hit your limit · resets 12pm (America/Montevideo)"
        ));
        assert!(is_rate_limit_output(
            "blah blah\nYOU'VE HIT YOUR LIMIT — resets 1:30 PM\n"
        ));
        assert!(is_rate_limit_output("you have hit your limit, friend"));
    }

    #[test]
    fn test_is_rate_limit_output_negative() {
        assert!(!is_rate_limit_output("Hello world"));
        assert!(!is_rate_limit_output(
            "Option '--dangerously-bypass-approvals-and-sandbox' not supported."
        ));
    }

    #[test]
    fn test_is_rate_limit_output_with_ansi_escapes() {
        // Tmux pane scrollback often contains ANSI escape codes around the
        // rate-limit text. Detection must still work.
        let ansi_wrapped =
            "\x1b[31mYou've hit your limit\x1b[0m · resets 12pm";
        assert!(is_rate_limit_output(ansi_wrapped));
    }

    fn anchor() -> chrono::DateTime<chrono::FixedOffset> {
        // 2026-05-04 09:00:00 -03:00 (Montevideo)
        chrono::DateTime::parse_from_rfc3339("2026-05-04T09:00:00-03:00").unwrap()
    }

    #[test]
    fn test_parse_rate_limit_delay_12pm() {
        let now = anchor();
        let dur = parse_rate_limit_delay_from(
            "You've hit your limit · resets 12pm (America/Montevideo)",
            now,
        )
        .unwrap();
        // 09:00 → 12:00 == 3 hours
        assert_eq!(dur.as_secs(), 3 * 3600);
    }

    #[test]
    fn test_parse_rate_limit_delay_1_30_pm() {
        let now = anchor();
        let dur = parse_rate_limit_delay_from(
            "You've hit your limit. Resets 1:30 PM, please wait.",
            now,
        )
        .unwrap();
        // 09:00 → 13:30 == 4h30m
        assert_eq!(dur.as_secs(), 4 * 3600 + 30 * 60);
    }

    #[test]
    fn test_parse_rate_limit_delay_24h_format() {
        let now = anchor();
        let dur =
            parse_rate_limit_delay_from("you've hit your limit · resets 13:00 today", now).unwrap();
        // 09:00 → 13:00 == 4 hours
        assert_eq!(dur.as_secs(), 4 * 3600);
    }

    #[test]
    fn test_parse_rate_limit_delay_passed_time_rolls_to_next_day() {
        let now = anchor();
        // 06:00 already passed today (anchor is 09:00) → roll over 24h
        let dur =
            parse_rate_limit_delay_from("You've hit your limit · resets 6am next day", now).unwrap();
        // 09:00 → 06:00 next day == 21h
        assert_eq!(dur.as_secs(), 21 * 3600);
    }

    #[test]
    fn test_parse_rate_limit_delay_unknown_format_falls_back() {
        let now = anchor();
        let result =
            parse_rate_limit_delay_from("You've hit your limit · resets soonish", now);
        assert!(result.is_none());
        // Public API returns the fallback in this case.
        let pub_dur = parse_rate_limit_delay("You've hit your limit · resets soonish");
        assert_eq!(pub_dur, RATE_LIMIT_FALLBACK_DELAY);
    }

    #[test]
    fn test_codex_flag_mismatch_is_a_failure_not_a_rate_limit() {
        // The historical codex flag-mismatch error must NOT be treated as a
        // rate-limit (it's a real failure that the user needs to see).
        let stderr = "Option '--dangerously-bypass-approvals-and-sandbox' not supported. Trigger 'codex -h' for more details.";
        assert!(!is_rate_limit_output(stderr));
    }

    #[test]
    fn test_extract_time_token_stops_at_paren() {
        assert_eq!(
            extract_time_token("12pm (America/Montevideo)").as_deref(),
            Some("12pm")
        );
    }

    #[test]
    fn test_extract_time_token_keeps_internal_space_for_ampm() {
        assert_eq!(
            extract_time_token("1:30 PM, please wait").as_deref(),
            Some("1:30 PM")
        );
    }

    #[test]
    fn test_extract_time_token_24h() {
        assert_eq!(extract_time_token("13:00 today").as_deref(), Some("13:00"));
    }

    // ─── tmux trigger end-to-end (gated on tmux being available) ──────────

    fn tmux_available() -> bool {
        Command::new("tmux")
            .arg("-V")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn tmux_trigger_creates_session_and_completes() {
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        // Use a unique task id so we don't collide with other tests or the
        // running app.
        let task_id = format!("test-trigger-{}", uuid::Uuid::new_v4());
        let session = tmux_session_name(&task_id);

        // Make sure we don't have a stale session.
        let _ = tmux_transport::kill_session(&task_id);

        tmux_transport::ensure_tmux_server().expect("tmux server");

        // Create the session manually (no AppHandle in tests).
        let env_vars = HashMap::new();
        create_trigger_session(&task_id, "/tmp", 80, 24, &env_vars).expect("create session");
        assert!(tmux_transport::has_session(&task_id));

        // Send a command that signals completion.
        let nonce = "abc1234567890def";
        let dir = log_retention::trigger_logs_dir();
        std::fs::create_dir_all(&dir).ok();
        let exit_path = format!("{}/exit_{}.code", dir.display(), nonce);
        let chan = format!("bentoya_done_{}", nonce);
        let wrapped = format!(
            "echo HELLO_FROM_TMUX; printf '%s' \"0\" > {}; tmux wait-for -S {}",
            shell_quote_arg(&exit_path),
            chan
        );

        run_tmux(&["send-keys", "-t", &session, "-l", &wrapped]).expect("send-keys literal");
        run_tmux(&["send-keys", "-t", &session, "Enter"]).expect("send-keys Enter");

        // Wait for completion (with a generous timeout for slow CI).
        let wait = tokio::task::spawn_blocking({
            let chan = chan.clone();
            move || {
                Command::new("tmux")
                    .args(["wait-for", &chan])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
        });
        let ok = tokio::time::timeout(Duration::from_secs(10), wait)
            .await
            .ok()
            .and_then(|r| r.ok())
            .unwrap_or(false);
        assert!(ok, "wait-for did not return");

        // Exit code file should contain "0".
        let code = std::fs::read_to_string(&exit_path).expect("read exit code");
        assert_eq!(code.trim(), "0");

        // Scrollback should contain our echo'd string.
        let scrollback = capture_pane_scrollback(&session);
        assert!(scrollback.contains("HELLO_FROM_TMUX"), "got: {}", scrollback);

        // Cleanup.
        let _ = std::fs::remove_file(&exit_path);
        let _ = tmux_transport::kill_session(&task_id);
    }

    #[tokio::test]
    async fn tmux_trigger_timeout_recovers_when_wait_hangs() {
        // Regression: `tmux wait-for` is server-global, not session-local. If
        // a session dies before signaling its channel, wait-for can block
        // indefinitely (channel never fires). Production code wraps wait-for
        // in `tokio::time::timeout(TRIGGER_TIMEOUT, ...)` so the trigger
        // runner always has a path back. This test verifies that the timeout
        // path does in fact unblock the awaiter, regardless of what tmux is
        // doing with the orphaned wait-for process.
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let task_id = format!("test-killwait-{}", uuid::Uuid::new_v4());

        let _ = tmux_transport::kill_session(&task_id);
        tmux_transport::ensure_tmux_server().expect("tmux server");

        let env_vars = HashMap::new();
        create_trigger_session(&task_id, "/tmp", 80, 24, &env_vars).expect("create session");

        // Channel that nobody will ever signal.
        let chan = format!("bentoya_done_{}", uuid::Uuid::new_v4().simple());

        // Spawn a wait-for in a blocking task — production analog of the
        // wait_handle in run_trigger_in_tmux.
        let wait_handle = tokio::task::spawn_blocking({
            let chan = chan.clone();
            move || {
                Command::new("tmux")
                    .args(["wait-for", &chan])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
        });

        // The session has nothing to signal the channel — kill the session,
        // then prove the timeout path returns within bounds.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let _ = tmux_transport::kill_session(&task_id);

        let started = std::time::Instant::now();
        let timed_out = tokio::time::timeout(Duration::from_millis(750), wait_handle)
            .await
            .is_err();

        assert!(
            timed_out,
            "expected the timeout path to fire when wait-for is orphaned"
        );
        // The timeout must actually elapse near the bound, not return early.
        assert!(
            started.elapsed() >= Duration::from_millis(700),
            "timeout fired early: {:?}",
            started.elapsed()
        );
        // Best-effort cleanup of any stragglers from the test.
        let _ = std::process::Command::new("pkill")
            .args(["-f", &format!("wait-for {}", chan)])
            .status();
    }
}
