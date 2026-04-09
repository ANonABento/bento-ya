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
use tokio::sync::{mpsc, Mutex as TokioMutex};

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

/// Active sentinel nonces per task. When a trigger fires, it registers a nonce.
/// The bridge checks incoming output against the expected nonce for that task.
type SentinelMap = Arc<TokioMutex<HashMap<String, String>>>;

/// Global sentinel nonce registry.
static SENTINEL_NONCES: std::sync::OnceLock<SentinelMap> = std::sync::OnceLock::new();

fn sentinel_nonces() -> &'static SentinelMap {
    SENTINEL_NONCES.get_or_init(|| Arc::new(TokioMutex::new(HashMap::new())))
}

/// Generate a random 8-char hex nonce.
fn gen_nonce() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{:08x}", t.subsec_nanos() ^ (t.as_secs() as u32))
}

/// Forward PTY transport events to Tauri events for frontend rendering.
///
/// Emits raw PTY events (for terminal view), parsed agent events (for chat panel),
/// and watches for sentinel patterns to detect trigger command completion.
/// Also saves assistant messages to DB.
pub async fn bridge_pty_to_tauri(
    app: &AppHandle,
    task_id: &str,
    mut event_rx: mpsc::Receiver<TransportEvent>,
) {
    let mut accumulated_text = String::new();
    let mut sentinel_buffer = String::new();

    while let Some(event) = event_rx.recv().await {
        match event {
            TransportEvent::Chat(ChatEvent::RawOutput(ref data)) => {
                let _ = app.emit(&format!("pty:{}:output", task_id), data);

                // Watch for sentinel in raw PTY output (trigger completion detection)
                if let Ok(decoded) = base64_decode(data) {
                    sentinel_buffer.push_str(&String::from_utf8_lossy(&decoded));
                    if let Some(exit_code) = extract_sentinel_for_task(task_id, &sentinel_buffer).await {
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
                        sentinel_buffer = sentinel_buffer[sentinel_buffer.len() - 200..].to_string();
                    }
                }
            }
            TransportEvent::Chat(ChatEvent::TextContent(text)) => {
                accumulated_text.push_str(&text);
                let _ = app.emit("agent:stream", &serde_json::json!({
                    "taskId": task_id,
                    "content": text,
                }));
            }
            TransportEvent::Chat(ChatEvent::ThinkingContent { content, is_complete }) => {
                let _ = app.emit("agent:thinking", &serde_json::json!({
                    "taskId": task_id,
                    "content": content,
                    "isComplete": is_complete,
                }));
            }
            TransportEvent::Chat(ChatEvent::ToolUse { id, name, input, status }) => {
                let _ = app.emit("agent:tool_call", &serde_json::json!({
                    "taskId": task_id,
                    "toolId": id,
                    "toolName": name,
                    "toolInput": input.unwrap_or_default(),
                    "status": format!("{:?}", status).to_lowercase(),
                }));
            }
            TransportEvent::Chat(ChatEvent::Complete) => {
                if !accumulated_text.is_empty() {
                    if let Ok(conn) = Connection::open(db::db_path()) {
                        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                        let _ = db::insert_agent_message(
                            &conn, task_id, "assistant", &accumulated_text,
                            None, None, None, None,
                        );
                    }
                    accumulated_text.clear();
                }
                let _ = app.emit("agent:complete", &serde_json::json!({
                    "taskId": task_id,
                    "success": true,
                }));
            }
            TransportEvent::Exited(_) => {
                if !accumulated_text.is_empty() {
                    if let Ok(conn) = Connection::open(db::db_path()) {
                        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                        let _ = db::insert_agent_message(
                            &conn, task_id, "assistant", &accumulated_text,
                            None, None, None, None,
                        );
                    }
                }
                let _ = app.emit(
                    &format!("pty:{}:exit", task_id),
                    serde_json::json!({ "taskId": task_id }),
                );
                break;
            }
            _ => {}
        }
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
/// If a PTY session exists for the task, writes the command into it.
/// If not, spawns a new PTY shell first, then writes the command.
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
            let mut reg = registry.lock().await;

            // Build the CLI command string to inject into the shell
            let mut cmd_parts = vec![cli_command.clone()];
            cmd_parts.extend(args);
            if !initial_prompt.is_empty() {
                cmd_parts.push("-p".to_string());
                // Escape single quotes in prompt for shell safety
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
            if let Some(session) = reg.get_mut(&task_id) {
                if session.is_alive() {
                    // Session exists — inject command into existing shell
                    session.write_pty(sentinel_cmd.as_bytes())?;

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

                    // Note: sentinel detection happens in the existing bridge task
                    // that was started when the PTY was first opened.
                    // We don't need a new bridge here.
                    return Ok(());
                }
            }

            // No active PTY — spawn a fresh one
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

            let event_rx = session.start_pty(120, 40)?;

            // Get PID before dropping lock
            let pid = session.pid();

            // Drop registry lock before delay + bridging
            drop(reg);

            // Update PID in agent session record
            if let Some(ref sid) = session_id {
                if let Some(p) = pid {
                    if let Ok(conn) = Connection::open(db::db_path()) {
                        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                        let _ = db::update_agent_session(
                            &conn, sid,
                            Some(Some(p as i64)), None, None, None, None, None,
                        );
                    }
                }
            }

            // Brief delay for shell rc file processing before injecting command
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            {
                let mut reg = registry.lock().await;
                if let Some(session) = reg.get_mut(&task_id) {
                    session.write_pty(sentinel_cmd.as_bytes())?;
                }
            }

            // Bridge events (includes sentinel detection for trigger completion)
            bridge_pty_to_tauri(&app, &task_id, event_rx).await;

            Ok(())
        }
        .await;

        if let Err(e) = result {
            eprintln!("CLI trigger failed for task {}: {}", task_id, e);
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

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
                            pipeline::handle_trigger_failure(&conn, &app, &task, &col, &e);
                    }
                }
            }
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
        // Correct pattern but wrong nonce — should not match (anti-spoofing)
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
}
