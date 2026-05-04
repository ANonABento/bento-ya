//! Bridges transport events to Tauri frontend events.
//!
//! The unified transport layer emits events via channels, but the frontend
//! expects Tauri events (`pty:{taskId}:output`, `pty:{taskId}:exit`).
//! This module provides helpers to forward transport events to the frontend,
//! and a background task runner for CLI triggers.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rusqlite::Connection;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::sync::{broadcast, mpsc, Notify};
use tokio::task::JoinHandle;

use super::events::ChatEvent;
use super::log_retention;
#[cfg(test)]
use super::tmux_transport;
use super::transport::TransportEvent;
use crate::db;
use crate::pipeline;

// ─── Output capture tunables ──────────────────────────────────────────────
//
// Live tail surfaced in `agent_sessions.last_output` (most recent bytes).
const LAST_OUTPUT_TAIL_BYTES: usize = 16 * 1024;
// Final scrollback persisted in `agent_sessions.scrollback` (head-truncated).
const SCROLLBACK_MAX_BYTES: usize = 256 * 1024;
// Tail of the log copied into `tasks.pipeline_error` on failure.
const PIPELINE_ERROR_TAIL_BYTES: usize = 4 * 1024;
// Periodic flush cadence — the upper bound between live updates.
const FLUSH_INTERVAL: Duration = Duration::from_secs(3);
// Byte threshold that triggers an early flush (overrides the timer).
const FLUSH_BYTE_THRESHOLD: usize = 4 * 1024;
// Fallback when we can't parse the rate-limit reset time.
const RATE_LIMIT_FALLBACK_DELAY: Duration = Duration::from_secs(60 * 60);
// Hard cap on the trigger duration before we kill the child process.
const TRIGGER_TIMEOUT: Duration = Duration::from_secs(60 * 60 * 2);

/// Generate a random 16-char hex nonce (used for tmux wait-for channel names).
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

/// tmux session name for a task (delegates to tmux_transport for single source of truth).
#[cfg(test)]
fn tmux_session_name(task_id: &str) -> String {
    tmux_transport::session_name(task_id)
}

// ─── Output capture ────────────────────────────────────────────────────────

/// Rolling capture of a child process's combined stdout+stderr.
///
/// `scrollback` retains the last `SCROLLBACK_MAX_BYTES` of output (oldest bytes
/// drained first when full). `pending_bytes` tracks how much new output has
/// arrived since the last flush so the flusher can decide whether to push an
/// early update to `agent_sessions.last_output`.
#[derive(Default)]
struct CapturedOutput {
    scrollback: Vec<u8>,
    pending_bytes: usize,
}

impl CapturedOutput {
    fn append(&mut self, data: &[u8]) {
        self.scrollback.extend_from_slice(data);
        if self.scrollback.len() > SCROLLBACK_MAX_BYTES {
            let trim = self.scrollback.len() - SCROLLBACK_MAX_BYTES;
            self.scrollback.drain(..trim);
        }
        self.pending_bytes = self.pending_bytes.saturating_add(data.len());
    }

    fn last_output_tail(&self) -> String {
        let len = self.scrollback.len();
        let start = len.saturating_sub(LAST_OUTPUT_TAIL_BYTES);
        String::from_utf8_lossy(&self.scrollback[start..]).to_string()
    }

    fn pipeline_error_tail(&self) -> String {
        let len = self.scrollback.len();
        let start = len.saturating_sub(PIPELINE_ERROR_TAIL_BYTES);
        String::from_utf8_lossy(&self.scrollback[start..]).to_string()
    }

    fn full_scrollback(&self) -> String {
        String::from_utf8_lossy(&self.scrollback).to_string()
    }
}

/// Flush the most recent output tail into `agent_sessions.last_output`.
fn flush_last_output_to_db(session_id: &str, tail: &str) {
    let Ok(conn) = Connection::open(db::db_path()) else {
        return;
    };
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
    let _ = db::update_agent_session_output(&conn, session_id, Some(tail), None);
}

/// Periodically push the latest output tail to the DB. Runs until `stop` is
/// set, then performs one final flush before exiting.
async fn run_output_flusher(
    capture: Arc<std::sync::Mutex<CapturedOutput>>,
    notify: Arc<Notify>,
    stop: Arc<AtomicBool>,
    session_id: Option<String>,
) {
    loop {
        tokio::select! {
            _ = tokio::time::sleep(FLUSH_INTERVAL) => {}
            _ = notify.notified() => {}
        }
        let stopping = stop.load(Ordering::Relaxed);
        let snapshot = {
            let mut c = capture.lock().expect("capture mutex");
            if c.pending_bytes == 0 {
                None
            } else {
                let tail = c.last_output_tail();
                c.pending_bytes = 0;
                Some(tail)
            }
        };
        if let (Some(tail), Some(sid)) = (&snapshot, &session_id) {
            flush_last_output_to_db(sid, tail);
        }
        if stopping {
            break;
        }
    }
}

/// Spawn a reader that pumps the child's merged stdout into the on-disk log
/// file, the in-memory scrollback, and signals the flusher when the byte
/// threshold is crossed.
fn spawn_output_reader(
    stdout: tokio::process::ChildStdout,
    log_file: tokio::fs::File,
    capture: Arc<std::sync::Mutex<CapturedOutput>>,
    notify: Arc<Notify>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut log_writer = tokio::io::BufWriter::new(log_file);
        let mut buf = vec![0u8; 8192];
        loop {
            match tokio::io::AsyncReadExt::read(&mut reader, &mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    if let Err(e) = log_writer.write_all(chunk).await {
                        log::warn!("[bridge] log file write failed: {}", e);
                    }
                    let should_notify = {
                        let mut c = capture.lock().expect("capture mutex");
                        c.append(chunk);
                        c.pending_bytes >= FLUSH_BYTE_THRESHOLD
                    };
                    if should_notify {
                        notify.notify_one();
                    }
                }
                Err(e) => {
                    log::warn!("[bridge] reader error: {}", e);
                    break;
                }
            }
        }
        let _ = log_writer.flush().await;
    })
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

    let (time_part, ampm) = if let Some(rest) = lower.strip_suffix("am") {
        (rest.trim(), Some(false))
    } else if let Some(rest) = lower.strip_suffix("pm") {
        (rest.trim(), Some(true))
    } else if let Some(rest) = lower.strip_suffix(" a.m.") {
        (rest.trim(), Some(false))
    } else if let Some(rest) = lower.strip_suffix(" p.m.") {
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
        let _ = db::update_task_pipeline_state(&conn, &task.id, "idle", None, None);
        if let Err(e) = pipeline::fire_trigger(&conn, &app, &task, &column) {
            log::warn!(
                "[bridge] rate-limit retry: re-fire failed for task {}: {}",
                task_id,
                e
            );
        }
    });
}

// ─── Trigger runner ───────────────────────────────────────────────────────

/// Run a CLI trigger as a direct child process with full output capture.
///
/// Captures merged stdout/stderr to:
/// 1. `~/.bentoya/trigger_logs/trigger_<nonce>.log` — preserved across runs,
///    GC'd on startup.
/// 2. `agent_sessions.last_output` — periodic live tail (≤16KB) flushed every
///    `FLUSH_INTERVAL` or every `FLUSH_BYTE_THRESHOLD` of new output.
/// 3. `agent_sessions.scrollback` — final full output (≤256KB, head-truncated).
///
/// On non-zero exit, the last `PIPELINE_ERROR_TAIL_BYTES` bytes of output are
/// copied into `tasks.pipeline_error` so the UI can show the real failure.
///
/// Detects provider rate-limit output and re-schedules the trigger instead of
/// burning a normal retry slot.
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

    tokio::spawn(async move {
        let start_time = std::time::Instant::now();
        let full_cmd = build_trigger_command(&cli_command, &args, &initial_prompt);
        let nonce = gen_nonce();
        let log_path = log_retention::new_trigger_log_path(&nonce);
        let log_path_str = log_path.display().to_string();

        let result = run_trigger_with_capture(
            &app,
            &task_id,
            &full_cmd,
            &working_dir,
            &log_path_str,
            session_id.as_deref(),
            trigger_column_id.as_deref(),
            start_time,
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
async fn run_trigger_with_capture(
    app: &AppHandle,
    task_id: &str,
    full_cmd: &str,
    working_dir: &str,
    log_path: &str,
    session_id: Option<&str>,
    trigger_column_id: Option<&str>,
    start_time: std::time::Instant,
) -> Result<(), String> {
    eprintln!("[bridge] Spawning direct process for task {}", task_id);
    eprintln!("[bridge] CLI command: {}", full_cmd);
    eprintln!("[bridge] Working dir: {}", working_dir);
    eprintln!("[bridge] Log file: {}", log_path);

    let log_file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .await
        .map_err(|e| format!("Failed to create log file: {}", e))?;

    // Merge stderr into stdout via shell so a single reader sees the full
    // feed. Wrap in a subshell so the redirect applies to the whole pipeline,
    // not just the trailing statement.
    let merged_cmd = format!("({}) 2>&1", full_cmd);
    let mut child = tokio::process::Command::new("bash")
        .args(["-c", &merged_cmd])
        .current_dir(working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .stdin(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn CLI process: {}", e))?;

    let child_pid = child.id().unwrap_or(0);
    eprintln!(
        "[bridge] Process spawned for task {}: PID {}",
        task_id, child_pid
    );

    if let Some(sid) = session_id {
        if let Ok(conn) = Connection::open(db::db_path()) {
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
            let _ = db::update_agent_session(
                &conn,
                sid,
                Some(Some(child_pid as i64)),
                None,
                None,
                None,
                None,
                None,
            );
        }
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "stdout pipe missing".to_string())?;

    // Set up the capture pipeline: reader → buffer + log file; flusher → DB.
    let capture = Arc::new(std::sync::Mutex::new(CapturedOutput::default()));
    let notify = Arc::new(Notify::new());
    let stop_flusher = Arc::new(AtomicBool::new(false));

    let reader_handle = spawn_output_reader(stdout, log_file, Arc::clone(&capture), Arc::clone(&notify));
    let flusher_handle = tokio::spawn(run_output_flusher(
        Arc::clone(&capture),
        Arc::clone(&notify),
        Arc::clone(&stop_flusher),
        session_id.map(str::to_string),
    ));

    // Wait for the child with a hard timeout. If it times out, kill it.
    let wait_result = tokio::time::timeout(TRIGGER_TIMEOUT, child.wait()).await;

    // Resolve the wait result FIRST so we can kill the child before draining
    // the reader. Awaiting the reader while the child (or any grandchild
    // holding the inherited stdout fd) is alive would block indefinitely.
    let status_result: Result<std::process::ExitStatus, String> = match wait_result {
        Ok(Ok(s)) => Ok(s),
        Ok(Err(e)) => {
            let _ = child.start_kill();
            Err(format!("Process wait failed: {}", e))
        }
        Err(_) => {
            let _ = child.start_kill();
            Err(format!("Trigger timed out after {:?}", TRIGGER_TIMEOUT))
        }
    };

    // Stop the flusher and drain the reader. The reader EOFs once the OS
    // closes the stdout pipe, which happens when every fd-holder (bash and
    // any orphaned grandchildren) exits. Cap the drain so a stuck grandchild
    // can't pin this task forever — we'd rather lose the trailing tail than
    // leak a worker.
    stop_flusher.store(true, Ordering::Relaxed);
    notify.notify_one();
    let _ = tokio::time::timeout(Duration::from_secs(30), reader_handle).await;
    let _ = flusher_handle.await;

    let status = status_result?;

    let exit_code = status.code().unwrap_or(1);
    let success = exit_code == 0;
    eprintln!(
        "[bridge] Trigger completed for task {}: exit_code={}, success={} log={}",
        task_id, exit_code, success, log_path
    );

    // Snapshot the captured output once so we don't hold the lock across DB IO.
    let (scrollback, error_tail, last_output_tail) = {
        let c = capture.lock().expect("capture mutex");
        (c.full_scrollback(), c.pipeline_error_tail(), c.last_output_tail())
    };

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
                    Some(Some(exit_code as i64)),
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
                        Some(Some(exit_code as i64)),
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
                    format!("Agent exited with code {}", exit_code)
                } else {
                    let mut msg = format!("Agent exited with code {}: ", exit_code);
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

    Ok(())
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
    fn test_captured_output_appends_and_truncates() {
        let mut out = CapturedOutput::default();
        // Write 2x SCROLLBACK_MAX_BYTES of distinct bytes so head-truncation kicks in.
        let mut payload = Vec::with_capacity(SCROLLBACK_MAX_BYTES * 2);
        for i in 0..(SCROLLBACK_MAX_BYTES * 2) {
            payload.push((i % 251) as u8);
        }
        out.append(&payload);
        assert_eq!(out.scrollback.len(), SCROLLBACK_MAX_BYTES);
        // The retained slice must equal the tail of the input (head was dropped).
        let tail_start = payload.len() - SCROLLBACK_MAX_BYTES;
        assert_eq!(out.scrollback, &payload[tail_start..]);
    }

    #[test]
    fn test_captured_output_last_output_tail_size() {
        let mut out = CapturedOutput::default();
        out.append(&vec![b'a'; LAST_OUTPUT_TAIL_BYTES * 3]);
        let tail = out.last_output_tail();
        assert_eq!(tail.len(), LAST_OUTPUT_TAIL_BYTES);
    }

    #[test]
    fn test_captured_output_pipeline_error_tail() {
        let mut out = CapturedOutput::default();
        out.append(b"early prefix that should be dropped\n");
        out.append(&vec![b'z'; PIPELINE_ERROR_TAIL_BYTES]);
        let tail = out.pipeline_error_tail();
        assert_eq!(tail.len(), PIPELINE_ERROR_TAIL_BYTES);
        assert!(tail.chars().all(|c| c == 'z'));
    }

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

    // ─── End-to-end capture pipeline (no Tauri AppHandle) ─────────────────
    //
    // These tests exercise the same reader + flusher tasks that
    // `run_trigger_with_capture` wires up, against a real `tokio::process`
    // child that streams output over time. We can't easily test the full DB
    // path (it requires an AppHandle), but we can prove that the in-memory
    // capture and the on-disk log file end up populated.

    async fn run_capture_against(cmd: &str) -> (CapturedOutput, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "bentoya_capture_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let log_path = dir.join("trigger_test.log");
        let log_file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&log_path)
            .await
            .unwrap();

        let mut child = tokio::process::Command::new("bash")
            .args(["-c", &format!("({}) 2>&1", cmd)])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .stdin(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();

        let capture = Arc::new(std::sync::Mutex::new(CapturedOutput::default()));
        let notify = Arc::new(Notify::new());
        let stop = Arc::new(AtomicBool::new(false));

        let reader = spawn_output_reader(stdout, log_file, Arc::clone(&capture), Arc::clone(&notify));
        let flusher = tokio::spawn(run_output_flusher(
            Arc::clone(&capture),
            Arc::clone(&notify),
            Arc::clone(&stop),
            None,
        ));

        let _ = child.wait().await.unwrap();
        stop.store(true, Ordering::Relaxed);
        notify.notify_one();
        let _ = reader.await;
        let _ = flusher.await;

        let final_capture = std::mem::take(&mut *capture.lock().unwrap());
        (final_capture, log_path)
    }

    #[tokio::test]
    async fn capture_collects_streamed_output_and_log() {
        let (out, log_path) =
            run_capture_against("for i in 1 2 3; do echo line$i; sleep 0.05; done").await;
        let scrollback = out.full_scrollback();
        assert!(scrollback.contains("line1"));
        assert!(scrollback.contains("line2"));
        assert!(scrollback.contains("line3"));

        let log_contents = std::fs::read_to_string(&log_path).unwrap();
        assert_eq!(log_contents, scrollback);
    }

    #[tokio::test]
    async fn capture_includes_stderr_via_shell_redirect() {
        // build_trigger_command + run_trigger_with_capture wraps the user
        // command in `... 2>&1`, so stderr lands in scrollback too. Mirror
        // that here.
        let (out, _log) = run_capture_against("echo OUT; echo ERR 1>&2").await;
        let scrollback = out.full_scrollback();
        assert!(scrollback.contains("OUT"));
        assert!(scrollback.contains("ERR"));
    }

    #[tokio::test]
    async fn capture_preserves_log_for_failed_command() {
        // Important: trigger logs are no longer deleted on success or failure.
        // This test exercises the failure side of that guarantee.
        let (out, log_path) = run_capture_against("echo bad; exit 1").await;
        assert!(out.full_scrollback().contains("bad"));
        assert!(log_path.exists(), "log file must be retained for failed runs");
    }

    #[tokio::test]
    async fn timeout_drain_terminates_even_with_orphaned_grandchild() {
        // Regression: on timeout, killing the immediate child is not enough —
        // grandchildren (e.g. `sleep` spawned by bash) keep the inherited
        // stdout pipe open after their parent dies, so the reader blocks on
        // a never-closing pipe. The trigger runner protects against this by
        // bounding the reader drain with a tokio timeout. Verify here that
        // the bounded drain returns even when the reader cannot EOF.
        let dir = std::env::temp_dir().join(format!(
            "bentoya_timeout_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let log_path = dir.join("trigger_timeout.log");
        let log_file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&log_path)
            .await
            .unwrap();

        // bash spawns `sleep 60` as a child; SIGKILL on bash leaves sleep
        // orphaned but holding the inherited stdout fd, reproducing the
        // grandchild-pipe-hold scenario.
        let mut child = tokio::process::Command::new("bash")
            .args(["-c", "(echo started; sleep 60) 2>&1"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .stdin(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();

        let capture = Arc::new(std::sync::Mutex::new(CapturedOutput::default()));
        let notify = Arc::new(Notify::new());
        let stop = Arc::new(AtomicBool::new(false));

        let reader =
            spawn_output_reader(stdout, log_file, Arc::clone(&capture), Arc::clone(&notify));
        let flusher = tokio::spawn(run_output_flusher(
            Arc::clone(&capture),
            Arc::clone(&notify),
            Arc::clone(&stop),
            None,
        ));

        // Trigger the timeout branch with a short fuse.
        let wait_result =
            tokio::time::timeout(Duration::from_millis(200), child.wait()).await;
        assert!(wait_result.is_err(), "wait should have timed out");
        let _ = child.start_kill();

        stop.store(true, Ordering::Relaxed);
        notify.notify_one();

        // The bounded drain must return — by EOF or by the elapsed timer —
        // even though the orphaned `sleep` keeps the pipe open.
        let started = std::time::Instant::now();
        let _ = tokio::time::timeout(Duration::from_secs(2), reader).await;
        assert!(
            started.elapsed() < Duration::from_secs(4),
            "drain blocked beyond the timeout bound"
        );
        let _ = flusher.await;

        // Best-effort cleanup so an orphaned `sleep` doesn't linger past the
        // test process. Killing the parent's process group is fine here.
        let _ = std::process::Command::new("pkill")
            .arg("-f")
            .arg("sleep 60")
            .status();
    }
}
