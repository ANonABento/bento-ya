//! Bridges transport events to Tauri frontend events.
//!
//! The unified transport layer emits events via channels, but the frontend
//! expects Tauri events (`pty:{taskId}:output`, `pty:{taskId}:exit`).
//! This module provides helpers to forward transport events to the frontend,
//! and a background task runner for CLI triggers.

use std::collections::HashMap;
use std::sync::Arc;

use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast, mpsc, Mutex as TokioMutex};
use tokio::task::JoinHandle;

use super::events::ChatEvent;
use super::registry::SharedSessionRegistry;
use super::session::{SessionConfig, TransportType};
use super::transport::TransportEvent;
use crate::db;
use crate::pipeline;

/// Sentinel pattern used to detect CLI command completion inside a PTY shell.
/// Format: `___BENTOYA_{nonce}_{exit_code}___`
/// The nonce is a random hex string generated per trigger invocation.
const SENTINEL_PREFIX: &str = "___BENTOYA_";
const SENTINEL_SUFFIX: &str = "___";

/// Shell ready detection: max time to wait for a prompt before falling back.
const SHELL_READY_TIMEOUT_MS: u64 = 5000;

/// Active sentinel nonces per task. When a trigger fires, it registers a nonce.
/// The bridge checks incoming output against the expected nonce for that task.
type SentinelMap = Arc<TokioMutex<HashMap<String, String>>>;

/// Global sentinel nonce registry.
static SENTINEL_NONCES: std::sync::OnceLock<SentinelMap> = std::sync::OnceLock::new();

fn sentinel_nonces() -> &'static SentinelMap {
    SENTINEL_NONCES.get_or_init(|| Arc::new(TokioMutex::new(HashMap::new())))
}

/// Generate a random 16-char hex nonce.
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
    ///
    /// The bridge also watches for sentinel patterns (trigger completion detection).
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
    let mut sentinel_buffer = String::new();

    loop {
        match event_rx.recv().await {
            Ok(event) => {
                if handle_bridge_event(&app, &task_id, &event, &mut accumulated_text, &mut sentinel_buffer).await {
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

/// Wait for the shell to be ready by watching broadcast output for a prompt pattern.
/// Returns Ok(()) when a prompt is detected, or after the timeout (5s fallback).
pub async fn wait_for_shell_ready(
    mut rx: broadcast::Receiver<TransportEvent>,
) -> Result<(), String> {
    let deadline = tokio::time::Instant::now()
        + std::time::Duration::from_millis(SHELL_READY_TIMEOUT_MS);

    loop {
        let timeout_result = tokio::time::timeout_at(deadline, rx.recv()).await;
        match timeout_result {
            Err(_) => {
                // Timeout — shell may be slow, proceed anyway
                eprintln!("[bridge] Shell ready timeout ({}ms), proceeding", SHELL_READY_TIMEOUT_MS);
                return Ok(());
            }
            Ok(Ok(TransportEvent::Chat(ChatEvent::RawOutput(ref data)))) => {
                if let Ok(decoded) = base64_decode(data) {
                    let text = String::from_utf8_lossy(&decoded);
                    // Match common shell prompts: $, %, #, > at end of line
                    // or user@host patterns
                    if is_shell_prompt(&text) {
                        return Ok(());
                    }
                }
            }
            Ok(Ok(TransportEvent::Exited(_))) => {
                return Err("Shell exited before becoming ready".to_string());
            }
            Ok(Ok(_)) => continue,
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => {
                return Err("Broadcast channel closed before shell ready".to_string());
            }
        }
    }
}

/// Strip ANSI escape sequences from text.
/// Handles CSI sequences (\x1b[...X), OSC sequences (\x1b]...BEL/ST), and simple escapes.
fn strip_ansi(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some('[') => {
                    // CSI sequence: \x1b[ ... (parameter bytes 0x30-0x3F) (intermediate 0x20-0x2F) final (0x40-0x7E)
                    chars.next(); // consume '['
                    while let Some(&ch) = chars.peek() {
                        if ch.is_ascii() && (0x40..=0x7E).contains(&(ch as u8)) {
                            chars.next(); // consume final byte
                            break;
                        }
                        chars.next(); // consume parameter/intermediate byte
                    }
                }
                Some(']') => {
                    // OSC sequence: \x1b] ... (terminated by BEL \x07 or ST \x1b\\)
                    chars.next(); // consume ']'
                    while let Some(ch) = chars.next() {
                        if ch == '\x07' {
                            break;
                        }
                        if ch == '\x1b' {
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                    }
                }
                _ => {
                    // Simple escape: consume next character
                    chars.next();
                }
            }
        } else {
            result.push(c);
        }
    }

    result
}

/// Check if text looks like a shell prompt.
/// Strips ANSI escape codes before checking, so colored prompts are detected.
fn is_shell_prompt(text: &str) -> bool {
    let clean = strip_ansi(text);
    let trimmed = clean.trim();
    if trimmed.is_empty() {
        return false;
    }
    let last_line = trimmed.lines().last().unwrap_or("");
    let last_line = last_line.trim();
    if last_line.is_empty() {
        return false;
    }
    // Prompt typically ends with $, %, #, or >
    let last_char = last_line.chars().last().unwrap_or(' ');
    let ends_with_prompt = matches!(last_char, '$' | '%' | '#' | '>');
    // Also detect user@host style prompts (even if not ending with prompt char)
    let has_at_pattern = last_line.contains('@')
        && (last_line.contains('$') || last_line.contains('%') || last_line.contains('#'));
    ends_with_prompt || has_at_pattern
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
    let mut sentinel_buffer = String::new();

    while let Some(event) = event_rx.recv().await {
        if handle_bridge_event(app, task_id, &event, &mut accumulated_text, &mut sentinel_buffer).await {
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
    sentinel_buffer: &mut String,
) -> bool {
    match event {
        TransportEvent::Chat(ChatEvent::RawOutput(ref data)) => {
            let _ = app.emit(&format!("pty:{}:output", task_id), data);

            // Watch for sentinel in raw PTY output (trigger completion detection)
            if let Ok(decoded) = base64_decode(data) {
                sentinel_buffer.push_str(&String::from_utf8_lossy(&decoded));
                if let Some(exit_code) = extract_sentinel_for_task(task_id, sentinel_buffer).await {
                    // Clear the nonce — trigger is done
                    { sentinel_nonces().lock().await.remove(task_id); }
                    let success = exit_code == 0;
                    if let Ok(conn) = Connection::open(db::db_path()) {
                        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                        let status = if success { "completed" } else { "failed" };
                        let _ = db::update_task_agent_status(&conn, task_id, Some(status), None);
                        let _ = pipeline::mark_complete(&conn, app, task_id, success);
                    }
                    pipeline::emit_tasks_changed(app, "", "trigger_complete");
                    sentinel_buffer.clear();
                }
                if sentinel_buffer.len() > 500 {
                    *sentinel_buffer = sentinel_buffer[sentinel_buffer.len() - 200..].to_string();
                }
            }
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

/// Decode base64 string to bytes.
fn base64_decode(data: &str) -> Result<Vec<u8>, ()> {
    // Simple base64 decoder matching our encoder
    const DECODE: [u8; 128] = {
        let mut table = [255u8; 128];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 {
            table[chars[i] as usize] = i as u8;
            i += 1;
        }
        table
    };

    let bytes: Vec<u8> = data.bytes().filter(|&b| b != b'=' && b != b'\n' && b != b'\r').collect();
    let mut result = Vec::with_capacity(bytes.len() * 3 / 4);

    for chunk in bytes.chunks(4) {
        let mut buf = [0u8; 4];
        for (i, &b) in chunk.iter().enumerate() {
            if b >= 128 || DECODE[b as usize] == 255 {
                return Err(());
            }
            buf[i] = DECODE[b as usize];
        }
        result.push((buf[0] << 2) | (buf[1] >> 4));
        if chunk.len() > 2 {
            result.push((buf[1] << 4) | (buf[2] >> 2));
        }
        if chunk.len() > 3 {
            result.push((buf[2] << 6) | buf[3]);
        }
    }

    Ok(result)
}

/// Extract exit code from sentinel pattern in output text.
/// Pattern: `___BENTOYA_{nonce}_{exit_code}___`
/// Returns Some(exit_code) if pattern found with matching nonce.
fn extract_sentinel(text: &str, expected_nonce: &str) -> Option<i32> {
    let pattern = format!("{}{}_{}", SENTINEL_PREFIX, expected_nonce, "");
    if let Some(start) = text.find(&pattern) {
        let after_nonce = &text[start + pattern.len()..];
        if let Some(end) = after_nonce.find(SENTINEL_SUFFIX) {
            let code_str = &after_nonce[..end];
            return code_str.parse().ok();
        }
    }
    None
}

/// Check sentinel for a specific task by looking up its registered nonce.
async fn extract_sentinel_for_task(task_id: &str, text: &str) -> Option<i32> {
    let nonces = sentinel_nonces().lock().await;
    if let Some(nonce) = nonces.get(task_id) {
        extract_sentinel(text, nonce)
    } else {
        None
    }
}

/// Run a CLI trigger by injecting the command into the task's PTY shell.
///
/// Uses a single managed bridge per task. If a PTY session already exists,
/// reuses it. If not, spawns a fresh shell and waits for it to be ready
/// (prompt detection) before injecting the command.
///
/// Uses a sentinel pattern to detect when the command completes.
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

    tokio::spawn(async move {
        let result: Result<(), String> = async {
            let registry: SharedSessionRegistry = app.state::<SharedSessionRegistry>().inner().clone();

            // Build the CLI command string to inject into the shell
            let mut cmd_parts = vec![cli_command.clone()];
            cmd_parts.extend(args);
            if !initial_prompt.is_empty() {
                cmd_parts.push("-p".to_string());
                let escaped = initial_prompt.replace('\'', "'\\''");
                cmd_parts.push(format!("'{}'", escaped));
            }
            let full_cmd = cmd_parts.join(" ");

            // Generate nonce and register it for this task
            let nonce = gen_nonce();
            {
                let mut nonces = sentinel_nonces().lock().await;
                nonces.insert(task_id.clone(), nonce.clone());
            }

            // Wrap with sentinel for exit detection (nonce prevents spoofing)
            let sentinel_cmd = format!(
                "{} ; echo \"{}{}_{}{}\"\n",
                full_cmd, SENTINEL_PREFIX, nonce, "$?", SENTINEL_SUFFIX
            );

            // Check if a PTY session already exists for this task
            {
                let mut reg = registry.lock().await;

                let session_alive = reg.get(&task_id).map(|s| s.is_alive()).unwrap_or(false);
                let needs_bridge = !reg.has_active_bridge(&task_id);

                if session_alive {
                    // Session exists — inject command into existing shell
                    let (pid, resubscribe_rx) = {
                        let session = reg.get_mut(&task_id).unwrap();
                        session.write_pty(sentinel_cmd.as_bytes())
                            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
                        let pid = session.pid();
                        let rx = if needs_bridge { session.resubscribe() } else { None };
                        (pid, rx)
                    }; // session borrow ends here

                    // Start bridge if needed
                    if let Some(rx) = resubscribe_rx {
                        let bridge = ManagedBridge::start(app.clone(), task_id.clone(), rx);
                        reg.set_bridge(&task_id, bridge);
                    }

                    // Update PID in agent session record
                    if let Some(ref sid) = session_id {
                        if let Some(pid) = pid {
                            if let Ok(conn) = Connection::open(db::db_path()) {
                                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                                let _ = db::update_agent_session(
                                    &conn, sid,
                                    Some(Some(pid as i64)), None, None, None, None, None,
                                );
                            }
                        }
                    }

                    return Ok(());
                }
            }

            // No active PTY — spawn a fresh one
            let broadcast_rx = {
                let mut reg = registry.lock().await;
                reg.remove(&task_id);

                let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
                let config = SessionConfig {
                    cli_path: shell,
                    model: String::new(),
                    system_prompt: String::new(),
                    working_dir: Some(working_dir),
                    effort_level: None,
                };

                let session = reg
                    .get_or_create(&task_id, config, TransportType::Pty)
                    .map_err(|e| e.to_string())?;

                // Start PTY then subscribe to broadcast (tiny race window is fine —
                // shell takes much longer to produce first output than subscribe takes)
                let _mpsc_rx = session.start_pty(120, 40)?;

                let broadcast_rx = session.resubscribe()
                    .ok_or_else(|| "Failed to subscribe to PTY broadcast".to_string())?;

                // Update PID in agent session record
                if let Some(ref sid) = session_id {
                    if let Some(pid) = session.pid() {
                        if let Ok(conn) = Connection::open(db::db_path()) {
                            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                            let _ = db::update_agent_session(
                                &conn, sid,
                                Some(Some(pid as i64)), None, None, None, None, None,
                            );
                        }
                    }
                }

                broadcast_rx
                // Registry lock released
            };

            // Get a second subscription for shell ready detection
            // (the first subscription goes to the managed bridge)
            let ready_rx = {
                let reg = registry.lock().await;
                reg.get(&task_id)
                    .and_then(|s| s.resubscribe())
                    .ok_or_else(|| "Session lost during shell ready wait".to_string())?
            };

            // Start the managed bridge (it will forward events to frontend)
            {
                let mut reg = registry.lock().await;
                let bridge = ManagedBridge::start(app.clone(), task_id.clone(), broadcast_rx);
                reg.set_bridge(&task_id, bridge);
            }

            // Wait for shell to be ready (prompt detection) before injecting command
            if let Err(e) = wait_for_shell_ready(ready_rx).await {
                return Err(format!("Shell ready detection failed: {}", e));
            }

            // Inject the command
            {
                let mut reg = registry.lock().await;
                if let Some(session) = reg.get_mut(&task_id) {
                    session.write_pty(sentinel_cmd.as_bytes())
                        .map_err(|e| format!("Failed to write trigger command to PTY: {}", e))?;
                } else {
                    return Err("PTY session disappeared after spawn".to_string());
                }
            }

            Ok(())
        }
        .await;

        if let Err(e) = result {
            // Clean up sentinel nonce to prevent leak
            { sentinel_nonces().lock().await.remove(&task_id); }

            let error_detail = format!("CLI trigger '{}' failed for task {}: {}", cli_command, task_id, e);
            eprintln!("[bridge] {}", error_detail);
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

                // Store detailed error in pipeline_error field
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
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_sentinel_success() {
        assert_eq!(extract_sentinel("some output\n___BENTOYA_abc12345_0___\n", "abc12345"), Some(0));
        assert_eq!(extract_sentinel("___BENTOYA_nonce1_1___", "nonce1"), Some(1));
        assert_eq!(extract_sentinel("blah ___BENTOYA_xyz_127___ more", "xyz"), Some(127));
    }

    #[test]
    fn test_extract_sentinel_wrong_nonce() {
        assert_eq!(extract_sentinel("___BENTOYA_wrong_0___", "expected"), None);
    }

    #[test]
    fn test_extract_sentinel_not_found() {
        assert_eq!(extract_sentinel("no sentinel here", "abc"), None);
        assert_eq!(extract_sentinel("___BENTOYA_abc_", "abc"), None);
        assert_eq!(extract_sentinel("partial ___BENTOYA_abc_0", "abc"), None);
    }

    #[test]
    fn test_extract_sentinel_invalid_code() {
        assert_eq!(extract_sentinel("___BENTOYA_abc_xyz___", "abc"), None);
    }

    #[test]
    fn test_base64_decode() {
        let encoded = super::super::events::base64_encode(b"Hello World");
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(decoded, b"Hello World");
    }

    #[test]
    fn test_is_shell_prompt() {
        // Common prompts
        assert!(is_shell_prompt("user@host ~ $ "));
        assert!(is_shell_prompt("$ "));
        assert!(is_shell_prompt("% "));
        assert!(is_shell_prompt("# "));
        assert!(is_shell_prompt("> "));
        assert!(is_shell_prompt("user@macbook:~/code$"));
        assert!(is_shell_prompt("bash-5.2$"));

        // ANSI colored prompts (the critical case)
        assert!(is_shell_prompt("\x1b[32muser@host\x1b[0m:\x1b[34m~/code\x1b[0m$ "));
        assert!(is_shell_prompt("\x1b[1;32m$\x1b[0m "));
        assert!(is_shell_prompt("\x1b[31m%\x1b[0m"));

        // Not prompts
        assert!(!is_shell_prompt(""));
        assert!(!is_shell_prompt("   "));
        assert!(!is_shell_prompt("Loading plugins..."));
        assert!(!is_shell_prompt("export PATH=/usr/bin"));
    }

    #[test]
    fn test_strip_ansi() {
        assert_eq!(strip_ansi("\x1b[32mhello\x1b[0m"), "hello");
        assert_eq!(strip_ansi("\x1b[1;34m$\x1b[0m "), "$ ");
        assert_eq!(strip_ansi("no escapes"), "no escapes");
        assert_eq!(strip_ansi("\x1b]0;title\x07prompt$"), "prompt$");
    }

    #[test]
    fn test_gen_nonce_unique() {
        let a = gen_nonce();
        let b = gen_nonce();
        // Not guaranteed to differ with hash-based impl, but should be 16 hex chars
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
