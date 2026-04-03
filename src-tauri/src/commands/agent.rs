use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::chat::registry::SharedSessionRegistry;
use crate::chat::session::SessionConfig;
use crate::chat::events::{ChatEvent, ToolStatus};
use crate::chat::session::TransportType;
use crate::db::{self, AppState, AgentMessage};
use crate::error::AppError;
use crate::process::agent_runner::{AgentRunner, AgentSession};

// ─── Types ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub task_id: String,
    pub agent_type: String,
    pub status: String,
    pub pid: Option<u32>,
    pub working_dir: String,
}

impl From<&AgentSession> for AgentInfo {
    fn from(s: &AgentSession) -> Self {
        Self {
            task_id: s.task_id.clone(),
            agent_type: s.agent_type.clone(),
            status: format!("{:?}", s.status),
            pid: s.pid,
            working_dir: s.working_dir.clone(),
        }
    }
}

impl From<AgentSession> for AgentInfo {
    fn from(s: AgentSession) -> Self {
        Self {
            task_id: s.task_id.clone(),
            agent_type: s.agent_type.clone(),
            status: format!("{:?}", s.status),
            pid: s.pid,
            working_dir: s.working_dir.clone(),
        }
    }
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

// ─── PTY Agent Commands (unchanged — used by terminal view) ───────────────

#[tauri::command(rename_all = "camelCase")]
pub async fn start_agent(
    task_id: String,
    agent_type: String,
    working_dir: String,
    env_vars: Option<HashMap<String, String>>,
    cli_path: Option<String>,
    app_handle: AppHandle,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<AgentInfo, String> {
    let mut runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let session = runner.start_agent(
        &task_id,
        &agent_type,
        &working_dir,
        env_vars,
        cli_path,
        app_handle,
    )?;

    Ok(AgentInfo::from(session))
}

#[tauri::command(rename_all = "camelCase")]
pub fn stop_agent(
    task_id: String,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<(), String> {
    let mut runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    runner.stop_agent(&task_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn force_stop_agent(
    task_id: String,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<(), String> {
    let mut runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    runner.force_stop_agent(&task_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_agent_status(
    task_id: String,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<AgentInfo, String> {
    let runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    runner
        .get_status(&task_id)
        .map(AgentInfo::from)
        .ok_or_else(|| format!("No agent session for task: {}", task_id))
}

#[tauri::command]
pub fn list_active_agents(
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<Vec<AgentInfo>, String> {
    let runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    Ok(runner.list_active().into_iter().map(AgentInfo::from).collect())
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
/// Uses `UnifiedChatSession` from the `SessionRegistry` instead of the
/// legacy `AgentCliSessionManager`.
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

    // 3. Get or create session from registry
    let (full_response, captured_cli_session_id) = {
        let mut registry = session_registry.lock().await;

        let config = SessionConfig {
            cli_path,
            model: model.clone(),
            system_prompt,
            working_dir: Some(working_dir.clone()),
            effort_level: effort_level.clone(),
        };

        let session = registry
            .get_or_create(&task_id, config.clone(), TransportType::Pipe)
            .map_err(|e| AppError::InvalidInput(e))?;

        // Update session config for existing sessions (get_or_create
        // ignores config if session exists — we need to refresh the
        // system prompt, model, etc. on every call)
        session.set_model(model.clone());
        session.set_system_prompt(config.system_prompt);

        // Send message with event forwarding to frontend
        let task_id_for_events = task_id.clone();
        let app_for_events = app.clone();

        session
            .send_message(&message, move |event| {
                emit_agent_event(&app_for_events, &task_id_for_events, event);
            })
            .await
            .map_err(|e| AppError::InvalidInput(e))?
    };

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
