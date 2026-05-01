use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::chat::events::{ChatEvent, TokenUsage as ChatTokenUsage, ToolStatus};
use crate::chat::registry::SharedSessionRegistry;
use crate::chat::session::{SessionConfig, SessionState, TransportType, UnifiedChatSession};
use crate::db::{self, AgentMessage, AppState};
use crate::error::AppError;
use crate::llm::{calculate_cost, infer_provider_id, types::TokenUsage as LlmTokenUsage};
use std::sync::{Arc, Mutex};

// ─── Types ────────────────────────────────────────────────────────────────

type SharedTokenUsage = Arc<Mutex<Option<ChatTokenUsage>>>;

fn remember_result_usage(final_usage: &SharedTokenUsage, event: &ChatEvent) {
    if let ChatEvent::Result(usage) = event {
        if let Ok(mut lock) = final_usage.lock() {
            *lock = Some(usage.clone());
        }
    }
}

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

    let _mpsc_rx = session.start_pty(120, 40)?;
    let pid = session.pid();

    // Start managed bridge via broadcast
    if let Some(rx) = session.resubscribe() {
        let bridge = crate::chat::bridge::ManagedBridge::start(app_handle, task_id.clone(), rx);
        registry.set_bridge(&task_id, bridge);
    }

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
#[allow(clippy::too_many_arguments)]
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_agent_messages(&conn, &task_id)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn clear_agent_messages(state: State<AppState>, task_id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::clear_agent_messages(&conn, &task_id)?;
    Ok(())
}

// ─── Agent CLI Chat (via UnifiedChatSession) ──────────────────────────────

/// Stream a message to the per-task agent CLI and emit response chunks.
///
/// Uses `UnifiedChatSession` from the `SessionRegistry`.
#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
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
    let usage_provider = infer_provider_id(&cli_path, &model);

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
    let (system_prompt, task_workspace_id) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        let task_workspace_id = task.workspace_id.clone();
        let system_prompt = format!(
            r#"You are an AI assistant helping with the task: "{}"

Task Description:
{}

Work in the current directory. You have access to tools for reading/editing files, running commands, etc.
Be concise and helpful."#,
            task.title,
            task.description.unwrap_or_default()
        );
        (system_prompt, task_workspace_id)
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
                return Err(AppError::InvalidInput(
                    "Maximum concurrent sessions reached".to_string(),
                ));
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
    let final_usage = Arc::new(Mutex::new(None::<ChatTokenUsage>));
    let final_usage_for_events = final_usage.clone();

    let (full_response, captured_cli_session_id) = session
        .send_message(&message, move |event| {
            remember_result_usage(&final_usage_for_events, &event);
            emit_agent_event(&app_for_events, &task_id_for_events, event);
        })
        .await
        .map_err(AppError::InvalidInput)?;

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
        let mut agent_session_id = None;

        if let Some(cli_sid) = &captured_cli_session_id {
            let agent_session = db::get_or_create_agent_session_for_task(
                &conn,
                &task_id,
                "claude",
                Some(&working_dir),
            )?;
            agent_session_id = Some(agent_session.id.clone());
            db::update_agent_session_cli(
                &conn,
                agent_session.id.as_str(),
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

        if let Some(usage) = final_usage.lock().ok().and_then(|usage| usage.clone()) {
            let resolved_model = usage.model.unwrap_or_else(|| model.clone());
            let cost = calculate_cost(
                &resolved_model,
                &LlmTokenUsage {
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                },
            );
            let record = db::insert_usage_record(
                &conn,
                &task_workspace_id,
                Some(&task_id),
                agent_session_id.as_deref(),
                usage_provider,
                &resolved_model,
                usage.input_tokens,
                usage.output_tokens,
                cost,
                None,
                0,
            )?;
            let _ = app.emit("usage:recorded", &record);
        }
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
/// Uses managed bridge for PTY event forwarding.
#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
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
        _ => {
            return Err(AppError::InvalidInput(format!(
                "Invalid transport type: {}",
                transport_type
            )))
        }
    };

    let c = cols.unwrap_or(120);
    let r = rows.unwrap_or(40);

    let mut registry = session_registry.lock().await;

    let has_session = registry.has(&task_id);
    let current_type = registry.get(&task_id).map(|s| s.transport_type());

    if has_session {
        // Already using this transport — no-op
        if current_type == Some(target_type) {
            return Ok(());
        }

        // Cancel existing bridge when switching transport
        registry.cancel_bridge(&task_id);

        let session = registry.get_mut(&task_id).unwrap();
        session.suspend().map_err(AppError::InvalidInput)?;
        session.set_transport_type(target_type);

        if target_type == TransportType::Pty {
            let _mpsc_rx = session.start_pty(c, r).map_err(AppError::InvalidInput)?;
            let rx = session.resubscribe();

            if let Some(rx) = rx {
                let bridge = crate::chat::bridge::ManagedBridge::start(app, task_id.clone(), rx);
                registry.set_bridge(&task_id, bridge);
            }
        }
    } else if target_type == TransportType::Pty {
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
            .map_err(AppError::InvalidInput)?;

        let _mpsc_rx = session.start_pty(c, r).map_err(AppError::InvalidInput)?;

        if let Some(rx) = session.resubscribe() {
            let bridge = crate::chat::bridge::ManagedBridge::start(app, task_id.clone(), rx);
            registry.set_bridge(&task_id, bridge);
        }
    }

    Ok(())
}

/// Ensure a PTY session exists for a task. Spawns a bare shell if none exists.
///
/// Called by the terminal view on mount. Uses a single managed bridge per task:
/// - Session alive + bridge alive → return scrollback (no new bridge)
/// - Session alive + bridge dead → start new managed bridge
/// - Session dead or missing → spawn fresh shell + managed bridge
#[tauri::command(rename_all = "camelCase")]
pub async fn ensure_pty_session(
    app: AppHandle,
    session_registry: State<'_, SharedSessionRegistry>,
    task_id: String,
    working_dir: String,
    cols: u16,
    rows: u16,
) -> Result<AgentInfo, String> {
    let mut registry = session_registry.lock().await;

    // Case 1: Session is alive
    let session_alive = registry
        .get(&task_id)
        .map(|s| s.is_alive())
        .unwrap_or(false);
    if session_alive {
        let needs_bridge = !registry.has_active_bridge(&task_id);

        let (scrollback, pid, resubscribe_rx) = {
            let session = registry.get_mut(&task_id).unwrap();
            // Resize PTY to match panel dimensions (sends SIGWINCH to running process)
            // This fixes TUI apps (codex, vim) that were spawned at a different size
            let _ = session.resize_pty(cols, rows);
            let scrollback = session.scrollback();
            let pid = session.pid();
            let rx = if needs_bridge {
                session.resubscribe()
            } else {
                None
            };
            (scrollback, pid, rx)
        }; // session borrow ends

        if let Some(rx) = resubscribe_rx {
            let bridge =
                crate::chat::bridge::ManagedBridge::start(app.clone(), task_id.clone(), rx);
            registry.set_bridge(&task_id, bridge);
        }

        return Ok(AgentInfo {
            task_id,
            agent_type: "shell".to_string(),
            status: "Running".to_string(),
            pid,
            working_dir,
            scrollback: if scrollback.is_empty() {
                None
            } else {
                Some(scrollback)
            },
        });
    }

    // Case 2: Session dead or missing — spawn fresh
    // Remove dead session (caches scrollback + cancels old bridge)
    registry.remove(&task_id);
    let cached_scrollback = registry.take_scrollback(&task_id);

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let config = SessionConfig {
        cli_path: shell,
        model: String::new(),
        system_prompt: String::new(),
        working_dir: Some(working_dir.clone()),
        effort_level: None,
    };

    let session = registry
        .get_or_create(&task_id, config, TransportType::Pty)
        .map_err(|e| e.to_string())?;

    let _mpsc_rx = session.start_pty(cols, rows)?;
    let pid = session.pid();

    // Start managed bridge via broadcast
    if let Some(rx) = session.resubscribe() {
        let bridge = crate::chat::bridge::ManagedBridge::start(app.clone(), task_id.clone(), rx);
        registry.set_bridge(&task_id, bridge);
    }

    Ok(AgentInfo {
        task_id,
        agent_type: "shell".to_string(),
        status: "Running".to_string(),
        pid,
        working_dir,
        scrollback: if cached_scrollback.is_empty() {
            None
        } else {
            Some(cached_scrollback)
        },
    })
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

const DEFAULT_MAX_CONCURRENT_AGENTS: i64 = 5;

/// Read maxConcurrentAgents from workspace config JSON, falling back to default.
fn get_max_concurrent(conn: &rusqlite::Connection, workspace_id: &str) -> i64 {
    db::get_workspace(conn, workspace_id)
        .ok()
        .and_then(|ws| serde_json::from_str::<serde_json::Value>(&ws.config).ok())
        .and_then(|cfg| cfg.get("maxConcurrentAgents")?.as_i64())
        .unwrap_or(DEFAULT_MAX_CONCURRENT_AGENTS)
}

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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let queued_tasks = db::get_queued_tasks(&conn, &workspace_id)?;
    let running_count = db::get_running_agent_count(&conn, &workspace_id)?;

    Ok(QueueStatus {
        queued_count: queued_tasks.len(),
        running_count,
        max_concurrent: get_max_concurrent(&conn, &workspace_id),
        queued_tasks,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_next_queued_task(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Option<db::Task>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let running_count = db::get_running_agent_count(&conn, &workspace_id)?;

    if running_count >= get_max_concurrent(&conn, &workspace_id) {
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
        ChatEvent::ThinkingContent {
            content,
            is_complete,
        } => {
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
        ChatEvent::Complete
        | ChatEvent::Result(_)
        | ChatEvent::SessionId(_)
        | ChatEvent::RawOutput(_)
        | ChatEvent::Unknown => {}
    }
}
