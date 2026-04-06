//! Bridges transport events to Tauri frontend events.
//!
//! The unified transport layer emits events via channels, but the frontend
//! expects Tauri events (`pty:{taskId}:output`, `pty:{taskId}:exit`).
//! This module provides helpers to forward transport events to the frontend,
//! and a background task runner for CLI triggers.

use std::collections::HashMap;

use rusqlite::Connection;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use super::events::ChatEvent;
use super::pty_transport::PtyTransport;
use super::transport::{ChatTransport, SpawnConfig, TransportEvent};
use crate::db;
use crate::pipeline;

/// Forward PTY transport events to Tauri events for frontend rendering.
///
/// Emits both raw PTY events (for terminal view) and parsed agent events
/// (for chat panel). Also saves assistant messages to DB.
pub async fn bridge_pty_to_tauri(
    app: &AppHandle,
    task_id: &str,
    mut event_rx: mpsc::Receiver<TransportEvent>,
) {
    // Accumulate text content for saving to DB on complete
    let mut accumulated_text = String::new();

    while let Some(event) = event_rx.recv().await {
        match event {
            TransportEvent::Chat(ChatEvent::RawOutput(data)) => {
                let _ = app.emit(&format!("pty:{}:output", task_id), data);
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
                // Save accumulated text as an agent message
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
                // Save any remaining text
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

/// Spawn a background task that runs a CLI trigger via a PTY session.
///
/// Replaces the old frontend round-trip:
///   (old: backend emits event → frontend catches → frontend calls IPC → backend spawns)
///
/// Now: backend directly spawns PTY, writes prompt, bridges events to frontend,
/// monitors for exit, and calls `mark_complete` when done.
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
                    // Link session to task and set running status
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
            let mut transport = PtyTransport::new();

            let spawn_config = SpawnConfig {
                command: cli_command,
                args,
                working_dir: Some(working_dir),
                env_vars,
                cols: 120,
                rows: 40,
            };

            let event_rx = transport
                .spawn(spawn_config)
                .map_err(|e| format!("Failed to spawn CLI trigger: {}", e))?;

            // Update session with PID if available
            if let Some(ref sid) = session_id {
                if let Some(pid) = transport.pid() {
                    if let Ok(conn) = Connection::open(db::db_path()) {
                        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                        let _ = db::update_agent_session(
                            &conn, sid,
                            Some(Some(pid as i64)), None, None, None, None, None,
                        );
                    }
                }
            }

            // Send initial prompt if provided
            if !initial_prompt.is_empty() {
                let prompt_bytes = format!("{}\n", initial_prompt);
                transport
                    .write(prompt_bytes.as_bytes())
                    .map_err(|e| format!("Failed to write prompt: {}", e))?;
            }

            // Bridge events to frontend AND wait for exit
            bridge_pty_to_tauri(&app, &task_id, event_rx).await;

            // Process exited — update session + mark pipeline complete
            let conn = Connection::open(db::db_path())
                .map_err(|e| format!("Failed to open DB: {}", e))?;
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

            if let Some(ref sid) = session_id {
                let _ = db::update_agent_session(
                    &conn, sid,
                    None, Some("completed"), Some(Some(0)), None, None, None,
                );
                let _ = db::update_task_agent_status(&conn, &task_id, Some("completed"), None);
            }

            let _ = pipeline::mark_complete(&conn, &app, &task_id, true);

            Ok(())
        }
        .await;

        if let Err(e) = result {
            eprintln!("CLI trigger failed for task {}: {}", task_id, e);
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

                // Mark session as failed
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
