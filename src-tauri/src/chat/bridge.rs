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
/// Consumes the event channel and emits:
/// - `pty:{task_id}:output` — base64-encoded terminal output
/// - `pty:{task_id}:exit` — process exited
///
/// Returns when the transport exits.
pub async fn bridge_pty_to_tauri(
    app: &AppHandle,
    task_id: &str,
    mut event_rx: mpsc::Receiver<TransportEvent>,
) {
    while let Some(event) = event_rx.recv().await {
        match event {
            TransportEvent::Chat(ChatEvent::RawOutput(data)) => {
                let _ = app.emit(&format!("pty:{}:output", task_id), data);
            }
            TransportEvent::Exited(_) => {
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
///   backend emits `pipeline:spawn_cli` → frontend catches → frontend calls `fire_cli_trigger`
///
/// Now: backend directly spawns PTY, writes prompt, bridges events to frontend,
/// monitors for exit, and calls `mark_complete` when done.
pub fn spawn_cli_trigger_task(
    app: AppHandle,
    task_id: String,
    cli_command: String,
    working_dir: String,
    initial_prompt: String,
    env_vars: Option<HashMap<String, String>>,
) {
    tokio::spawn(async move {
        let result: Result<(), String> = async {
            let mut transport = PtyTransport::new();

            let spawn_config = SpawnConfig {
                command: cli_command,
                args: Vec::new(),
                working_dir: Some(working_dir),
                env_vars,
                cols: 120,
                rows: 40,
            };

            let event_rx = transport
                .spawn(spawn_config)
                .map_err(|e| format!("Failed to spawn CLI trigger: {}", e))?;

            // Send initial prompt if provided — write immediately, kernel
            // PTY buffer holds the data until the child process reads it
            if !initial_prompt.is_empty() {
                let prompt_bytes = format!("{}\n", initial_prompt);
                transport
                    .write(prompt_bytes.as_bytes())
                    .map_err(|e| format!("Failed to write prompt: {}", e))?;
            }

            // Bridge events to frontend AND wait for exit
            bridge_pty_to_tauri(&app, &task_id, event_rx).await;

            // Process exited — open fresh DB connection and mark pipeline complete
            let conn = Connection::open(db::db_path())
                .map_err(|e| format!("Failed to open DB: {}", e))?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")
                .map_err(|e| format!("Failed to set pragmas: {}", e))?;
            let _ = pipeline::mark_complete(&conn, &app, &task_id, true);

            Ok(())
        }
        .await;

        if let Err(e) = result {
            eprintln!("CLI trigger failed for task {}: {}", task_id, e);
            // Set pipeline error state with fresh connection
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA foreign_keys=ON;");
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
