use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::chat::registry::SharedSessionRegistry;
use crate::chat::session::{SessionConfig, SessionState, TransportType, UnifiedChatSession};
use crate::chat::events::{ChatEvent, ToolStatus};
use crate::db::{self, AppState, AgentMessage};
use crate::error::AppError;

// ─── Types ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub task_id: String,
    pub agent_type: String,
    pub status: String,
    pub pid: Option<u32>,
    pub working_dir: String,
    /// Base64-encoded scrollback from previous session (for terminal restore)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scrollback: Option<String>,
}

/// Agent completion payload for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompletePayload {
    pub task_id: String,
    pub success: bool,
    pub message: Option<String>,
}

/// Agent stream payload for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentStreamPayload {
    task_id: String,
    content: String,
}

/// Agent thinking payload for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentThinkingPayload {
    task_id: String,
    content: String,
    is_complete: bool,
}

/// Agent tool call payload for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentToolCallPayload {
    task_id: String,
    tool_id: String,
    tool_name: String,
    tool_input: String,
    status: String,
}

// ─── PTY Agent Commands (via SessionRegistry) ──────────────────────────────

#[tauri::command(rename_all = "camelCase")]
pub async fn start_agent(
    task_id: String,
    _agent_type: String,
    working_dir: String,
    _env_vars: Option<std::collections::HashMap<String, String>>,
    cli_path: Option<String>,
    app_handle: AppHandle,
    session_registry: State<'_, SharedSessionRegistry>,
) -> Result<AgentInfo, String> {
    let cli = cli_path.unwrap_or_else(|| "claude".to_string());

    let event_rx = {
        let mut registry = session_registry.lock().await;

        // Clean up any existing session (handles React strict mode double-mount
        // and stale sessions from previous app instances)
        registry.remove(&task_id);

        let config = SessionConfig {
            cli_path: cli.clone(),
            model: "sonnet".to_string(),
            system_prompt: String::new(),
            working_dir: Some(working_dir.clone()),
            effort_level: None,
        };

        let session = registry
            .get_or_create(&task_id, config, TransportType::Pty)
            .map_err(|e| e.to_string())?;

        session.start_pty(120, 40)?
    };

    // Bridge PTY events to frontend
    let task_id_clone = task_id.clone();
    let app_clone = app_handle;
    tokio::spawn(async move {
        crate::chat::bridge::bridge_pty_to_tauri(&app_clone, &task_id_clone, event_rx).await;
    });

    let pid = {
        let registry = session_registry.lock().await;
        registry.get(&task_id).and_then(|s| s.pid())
    };

    Ok(AgentInfo {
        task_id,
        agent_type: "claude".to_string(),
        status: "Running".to_string(),
        pid,
        working_dir,
        scrollback: None,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stop_agent(
    task_id: String,
    session_registry: State<'_, SharedSessionRegistry>,
) -> Result<(), String> {
    let mut registry = session_registry.lock().await;
    if let Some(session) = registry.get_mut(&task_id) {
        // Send Ctrl+C via PTY write
        session.write_pty(&[0x03]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn force_stop_agent(
    task_id: String,
    session_registry: State<'_, SharedSessionRegistry>,
) -> Result<(), String> {
    let mut registry = session_registry.lock().await;
    if let Some(session) = registry.get_mut(&task_id) {
        session.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_agent_status(
    task_id: String,
    session_registry: State<'_, SharedSessionRegistry>,
) -> Result<AgentInfo, String> {
    let registry = session_registry.lock().await;
    let session = registry
        .get(&task_id)
        .ok_or_else(|| format!("No agent session for task: {}", task_id))?;

    let status = match session.state() {
        SessionState::Running => "Running",
        SessionState::Idle => "Idle",
        SessionState::Suspended => "Suspended",
    };

    Ok(AgentInfo {
        task_id: task_id.clone(),
        agent_type: "claude".to_string(),
        status: status.to_string(),
        pid: session.pid(),
        working_dir: String::new(),
        scrollback: None,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_active_agents(
    session_registry: State<'_, SharedSessionRegistry>,
) -> Result<Vec<AgentInfo>, String> {
    let registry = session_registry.lock().await;
    Ok(registry
        .list()
        .into_iter()
        .filter(|(_, state)| *state == SessionState::Running)
        .map(|(key, _)| AgentInfo {
            task_id: key,
            agent_type: "claude".to_string(),
            status: "Running".to_string(),
            pid: None,
            working_dir: String::new(),
            scrollback: None,
        })
        .collect())
}

// ─── Agent Message Commands ────────────────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
pub fn save_agent_message(
    state: State<AppState>,
    task_id: String,
    role: String,
    content: String,
    model: Option<String>,
    effort_level: Option<String>,
    tool_calls: Option<String>,
    thinking_content: Option<String>,
) -> Result<AgentMessage, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::insert_agent_message(
        &conn,
        &task_id,
        &role,
        &content,
        model.as_deref(),
        effort_level.as_deref(),
        tool_calls.as_deref(),
        thinking_content.as_deref(),
    )?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_agent_messages(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<AgentMessage>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_agent_messages(&conn, &task_id)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn clear_agent_messages(
    state: State<AppState>,
    task_id: String,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::clear_agent_messages(&conn, &task_id)?;
    Ok(())
}

// ─── Agent CLI Chat (via UnifiedChatSession) ──────────────────────────────

/// Stream a message to the per-task agent CLI and emit response chunks.
///
/// Uses `UnifiedChatSession` from the `SessionRegistry`.
#[tauri::command(rename_all = "camelCase")]
pub async fn stream_agent_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    task_id: String,
    message: String,
    working_dir: String,
    cli_path: String,
    model: Option<String>,
    effort_level: Option<String>,
) -> Result<(), AppError> {
    let model = model.unwrap_or_else(|| "sonnet".to_string());

    // 1. Save user message to DB
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::insert_agent_message(
            &conn,
            &task_id,
            "user",
            &message,
            Some(&model),
            effort_level.as_deref(),
            None,
            None,
        )?;
    }

    // 2. Build agent system prompt
    let system_prompt = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        format!(
            r#"You are an AI assistant helping with the task: "{}"

Task Description:
{}

Work in the current directory. You have access to tools for reading/editing files, running commands, etc.
Be concise and helpful."#,
            task.title,
            task.description.unwrap_or_default()
        )
    };

    // 3. Get or create session, configure it, then release lock before long await
    let mut session = {
        let mut registry = session_registry.lock().await;

        let config = SessionConfig {
            cli_path,
            model: model.clone(),
            system_prompt,
            working_dir: Some(working_dir.clone()),
            effort_level: effort_level.clone(),
        };

        // Take session out of registry so we can release the lock
        let mut session = if let Some(s) = registry.take(&task_id) {
            s
        } else {
            // Create new session (check capacity)
            if registry.is_at_capacity() {
                return Err(AppError::InvalidInput("Maximum concurrent sessions reached".to_string()));
            }
            UnifiedChatSession::new(config.clone(), TransportType::Pipe)
        };

        // Update config for existing sessions
        session.set_model(model.clone());
        session.set_system_prompt(config.system_prompt);

        session
        // Lock released here — other tasks can use the registry
    };

    // Send message WITHOUT holding the registry lock
    let task_id_for_events = task_id.clone();
    let app_for_events = app.clone();

    let (full_response, captured_cli_session_id) = session
        .send_message(&message, move |event| {
            emit_agent_event(&app_for_events, &task_id_for_events, event);
        })
        .await
        .map_err(|e| AppError::InvalidInput(e))?;

    // Put session back into registry
    {
        let mut registry = session_registry.lock().await;
        registry.insert(&task_id, session);
    }

    // 4. Save cli_session_id and assistant message
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        if let Some(cli_sid) = &captured_cli_session_id {
            let agent_session =
                db::get_or_create_agent_session_for_task(&conn, &task_id, "claude", Some(&working_dir))?;
            db::update_agent_session_cli(
                &conn,
                &agent_session.id,
                Some(cli_sid),
                Some(&model),
                effort_level.as_deref(),
            )?;
        }

        db::insert_agent_message(
            &conn,
            &task_id,
            "assistant",
            &full_response,
            Some(&model),
            effort_level.as_deref(),
            None,
            None,
        )?;
    }

    // 5. Emit completion event
    let _ = app.emit(
        "agent:complete",
        &AgentCompletePayload {
            task_id: task_id.clone(),
            success: true,
            message: None,
        },
    );

    Ok(())
}

/// Switch transport type for an agent session (pipe ↔ pty).
///
/// If a session exists: suspends it (preserving resume ID), switches transport.
/// If no session exists and switching to PTY: creates a new PTY session.
/// This ensures the terminal view always has a backing PTY session.
#[tauri::command(rename_all = "camelCase")]
pub async fn switch_agent_transport(
    app: AppHandle,
    session_registry: State<'_, SharedSessionRegistry>,
    task_id: String,
    transport_type: String,
    cli_path: Option<String>,
    working_dir: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), AppError> {
    let target_type = match transport_type.as_str() {
        "pipe" => TransportType::Pipe,
        "pty" => TransportType::Pty,
        _ => return Err(AppError::InvalidInput(format!("Invalid transport type: {}", transport_type))),
    };

    let c = cols.unwrap_or(120);
    let r = rows.unwrap_or(40);

    let event_rx = {
        let mut registry = session_registry.lock().await;

        if let Some(session) = registry.get_mut(&task_id) {
            // Session exists — switch transport

            // Already using this transport — no-op
            if session.transport_type() == target_type {
                return Ok(());
            }

            // Suspend current session (saves resume ID, kills transport)
            session.suspend().map_err(|e| AppError::InvalidInput(e))?;

            // Switch transport type
            session.set_transport_type(target_type);

            // If switching to PTY, start the PTY session immediately
            if target_type == TransportType::Pty {
                Some(session.start_pty(c, r).map_err(|e| AppError::InvalidInput(e))?)
            } else {
                // Pipe mode: session stays idle until next send_message()
                None
            }
        } else if target_type == TransportType::Pty {
            // No session exists — create a new PTY session
            let cli = cli_path.unwrap_or_else(|| "claude".to_string());
            let config = SessionConfig {
                cli_path: cli,
                model: "sonnet".to_string(),
                system_prompt: String::new(),
                working_dir,
                effort_level: None,
            };

            let session = registry
                .get_or_create(&task_id, config, TransportType::Pty)
                .map_err(|e| AppError::InvalidInput(e))?;

            Some(session.start_pty(c, r).map_err(|e| AppError::InvalidInput(e))?)
        } else {
            // No session + switching to pipe — nothing to do
            None
        }
    };

    // Bridge PTY events to frontend outside the lock
    if let Some(rx) = event_rx {
        let task_id_clone = task_id.clone();
        tokio::spawn(async move {
            crate::chat::bridge::bridge_pty_to_tauri(&app, &task_id_clone, rx).await;
        });
    }

    Ok(())
}

/// Ensure a PTY session exists for a task. Spawns a bare shell if none exists.
///
/// Called by the terminal view on mount. If a session is already alive,
/// resubscribes to its event stream (no kill) and returns scrollback for replay.
/// If no session exists or process exited, spawns a fresh shell.
#[tauri::command(rename_all = "camelCase")]
pub async fn ensure_pty_session(
    app: AppHandle,
    session_registry: State<'_, SharedSessionRegistry>,
    task_id: String,
    working_dir: String,
    cols: u16,
    rows: u16,
) -> Result<AgentInfo, String> {
    enum Action {
        /// Session alive — resubscribe to broadcast channel, replay scrollback
        Reconnect {
            scrollback: String,
            pid: Option<u32>,
            rx: tokio::sync::broadcast::Receiver<crate::chat::transport::TransportEvent>,
        },
        /// No session or dead — spawn fresh shell
        SpawnFresh {
            event_rx: tokio::sync::mpsc::Receiver<crate::chat::transport::TransportEvent>,
        },
    }

    let action = {
        let mut registry = session_registry.lock().await;

        // Check if an alive session exists
        if let Some(session) = registry.get(&task_id) {
            if session.is_alive() {
                if let Some(rx) = session.resubscribe() {
                    let scrollback = session.scrollback();
                    let pid = session.pid();
                    Action::Reconnect { scrollback, pid, rx }
                } else {
                    // Alive but can't resubscribe (shouldn't happen for PTY)
                    // Fall through to spawn fresh
                    registry.remove(&task_id);
                    registry.take_scrollback(&task_id);
                    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
                    let config = SessionConfig {
                        cli_path: shell, model: String::new(),
                        system_prompt: String::new(),
                        working_dir: Some(working_dir.clone()),
                        effort_level: None,
                    };
                    let session = registry.get_or_create(&task_id, config, TransportType::Pty)
                        .map_err(|e| e.to_string())?;
                    Action::SpawnFresh { event_rx: session.start_pty(cols, rows)? }
                }
            } else {
                // Session exists but dead — remove and spawn fresh
                registry.remove(&task_id);
                let scrollback = registry.take_scrollback(&task_id);
                let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
                let config = SessionConfig {
                    cli_path: shell, model: String::new(),
                    system_prompt: String::new(),
                    working_dir: Some(working_dir.clone()),
                    effort_level: None,
                };
                let session = registry.get_or_create(&task_id, config, TransportType::Pty)
                    .map_err(|e| e.to_string())?;
                let event_rx = session.start_pty(cols, rows)?;
                // Return scrollback from dead session so terminal shows history
                return {
                    let pid = session.pid();
                    let task_id_clone = task_id.clone();
                    tokio::spawn(async move {
                        crate::chat::bridge::bridge_pty_to_tauri(&app, &task_id_clone, event_rx).await;
                    });
                    Ok(AgentInfo {
                        task_id, agent_type: "shell".to_string(),
                        status: "Running".to_string(), pid, working_dir,
                        scrollback: if scrollback.is_empty() { None } else { Some(scrollback) },
                    })
                };
            }
        } else {
            // No session at all — spawn fresh
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
            let config = SessionConfig {
                cli_path: shell, model: String::new(),
                system_prompt: String::new(),
                working_dir: Some(working_dir.clone()),
                effort_level: None,
            };
            let session = registry.get_or_create(&task_id, config, TransportType::Pty)
                .map_err(|e| e.to_string())?;
            Action::SpawnFresh { event_rx: session.start_pty(cols, rows)? }
        }
    };
    // Registry lock released

    match action {
        Action::Reconnect { scrollback, pid, mut rx } => {
            // Start a new bridge from the broadcast receiver
            let task_id_clone = task_id.clone();
            tokio::spawn(async move {
                // Bridge broadcast events to Tauri (same as mpsc bridge but from broadcast)
                while let Ok(event) = rx.recv().await {
                    match event {
                        crate::chat::transport::TransportEvent::Chat(
                            crate::chat::events::ChatEvent::RawOutput(ref data)
                        ) => {
                            let _ = app.emit(&format!("pty:{}:output", task_id_clone), data);
                        }
                        crate::chat::transport::TransportEvent::Exited(_) => {
                            let _ = app.emit(
                                &format!("pty:{}:exit", task_id_clone),
                                serde_json::json!({ "taskId": task_id_clone }),
                            );
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(AgentInfo {
                task_id, agent_type: "shell".to_string(),
                status: "Running".to_string(), pid, working_dir,
                scrollback: if scrollback.is_empty() { None } else { Some(scrollback) },
            })
        }
        Action::SpawnFresh { event_rx } => {
            let pid = {
                let registry = session_registry.lock().await;
                registry.get(&task_id).and_then(|s| s.pid())
            };
            let task_id_clone = task_id.clone();
            tokio::spawn(async move {
                crate::chat::bridge::bridge_pty_to_tauri(&app, &task_id_clone, event_rx).await;
            });
            Ok(AgentInfo {
                task_id, agent_type: "shell".to_string(),
                status: "Running".to_string(), pid, working_dir,
                scrollback: None,
            })
        }
    }
}

/// Cancel an ongoing agent chat (kills the session)
#[tauri::command(rename_all = "camelCase")]
pub async fn cancel_agent_chat(
    app: AppHandle,
    session_registry: State<'_, SharedSessionRegistry>,
    task_id: String,
) -> Result<(), AppError> {
    {
        let mut registry = session_registry.lock().await;
        if let Some(session) = registry.get_mut(&task_id) {
            let _ = session.kill();
        }
    }

    let _ = app.emit(
        "agent:complete",
        &AgentCompletePayload {
            task_id: task_id.clone(),
            success: false,
            message: Some("Cancelled".to_string()),
        },
    );

    Ok(())
}

// ─── Queue Management Commands ────────────────────────────────────────────

const MAX_CONCURRENT_AGENTS: i64 = 5;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatus {
    pub queued_count: usize,
    pub running_count: i64,
    pub max_concurrent: i64,
    pub queued_tasks: Vec<db::Task>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn queue_agent_tasks(
    state: State<AppState>,
    task_ids: Vec<String>,
) -> Result<Vec<db::Task>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let queued_at = crate::db::now();
    let mut updated_tasks = Vec::new();

    for task_id in task_ids {
        let task = db::update_task_agent_status(&conn, &task_id, Some("queued"), Some(&queued_at))?;
        updated_tasks.push(task);
    }

    Ok(updated_tasks)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_task_agent_status(
    state: State<AppState>,
    task_id: String,
    agent_status: Option<String>,
    queued_at: Option<String>,
) -> Result<db::Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_task_agent_status(
        &conn,
        &task_id,
        agent_status.as_deref(),
        queued_at.as_deref(),
    )?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_queue_status(
    state: State<AppState>,
    workspace_id: String,
) -> Result<QueueStatus, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let queued_tasks = db::get_queued_tasks(&conn, &workspace_id)?;
    let running_count = db::get_running_agent_count(&conn, &workspace_id)?;

    Ok(QueueStatus {
        queued_count: queued_tasks.len(),
        running_count,
        max_concurrent: MAX_CONCURRENT_AGENTS,
        queued_tasks,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_next_queued_task(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Option<db::Task>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let running_count = db::get_running_agent_count(&conn, &workspace_id)?;

    if running_count >= MAX_CONCURRENT_AGENTS {
        return Ok(None);
    }

    let queued = db::get_queued_tasks(&conn, &workspace_id)?;
    Ok(queued.into_iter().next())
}

// ─── Event Forwarding ─────────────────────────────────────────────────────

/// Forward ChatEvent to agent-specific Tauri events for the frontend.
fn emit_agent_event(app: &AppHandle, task_id: &str, event: ChatEvent) {
    match event {
        ChatEvent::TextContent(content) => {
            let _ = app.emit(
                "agent:stream",
                &AgentStreamPayload {
                    task_id: task_id.to_string(),
                    content,
                },
            );
        }
        ChatEvent::ThinkingContent { content, is_complete } => {
            let _ = app.emit(
                "agent:thinking",
                &AgentThinkingPayload {
                    task_id: task_id.to_string(),
                    content,
                    is_complete,
                },
            );
        }
        ChatEvent::ToolUse {
            id,
            name,
            input,
            status,
        } => {
            let status_str = match status {
                ToolStatus::Running => "running",
                ToolStatus::Complete => "completed",
            };
            let _ = app.emit(
                "agent:tool_call",
                &AgentToolCallPayload {
                    task_id: task_id.to_string(),
                    tool_id: id,
                    tool_name: name,
                    tool_input: input.unwrap_or_default(),
                    status: status_str.to_string(),
                },
            );
        }
        ChatEvent::Complete | ChatEvent::SessionId(_) | ChatEvent::RawOutput(_) | ChatEvent::Unknown => {}
    }
}
