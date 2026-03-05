use std::sync::Arc;

use tauri::{AppHandle, State};
use tokio::sync::Mutex as TokioMutex;

use crate::db::{
    self, AgentMessage, AgentSession, AppState,
};
use crate::process::agent_session::AgentSessionManager;

// ─── Streaming agent commands (--print mode like orchestrator) ──────────────

/// Initialize an agent chat session for a task
#[tauri::command(rename_all = "camelCase")]
pub async fn init_agent_session(
    task_id: String,
    working_dir: String,
    cli_path: String,
    agent_sessions: State<'_, Arc<TokioMutex<AgentSessionManager>>>,
) -> Result<(), String> {
    let mut sessions = agent_sessions.lock().await;
    sessions.init_session(&task_id, &working_dir, &cli_path, None);
    Ok(())
}

/// Send a message to an agent and stream the response
#[tauri::command(rename_all = "camelCase")]
pub async fn stream_agent_chat(
    task_id: String,
    message: String,
    model: Option<String>,
    effort_level: Option<String>,
    app_handle: AppHandle,
    agent_sessions: State<'_, Arc<TokioMutex<AgentSessionManager>>>,
) -> Result<(), String> {
    let mut sessions = agent_sessions.lock().await;

    // Send message and stream response
    sessions
        .send_message(
            &task_id,
            &message,
            model.as_deref(),
            effort_level.as_deref(),
            &app_handle,
        )
        .await?;

    Ok(())
}

/// Cancel an ongoing agent chat (kills the CLI process)
#[tauri::command(rename_all = "camelCase")]
pub async fn cancel_agent_chat(
    task_id: String,
    agent_sessions: State<'_, Arc<TokioMutex<AgentSessionManager>>>,
) -> Result<(), String> {
    let mut sessions = agent_sessions.lock().await;
    sessions.cancel_session(&task_id).await
}

/// Reset agent session for a fresh start
#[tauri::command(rename_all = "camelCase")]
pub async fn reset_agent_session(
    task_id: String,
    agent_sessions: State<'_, Arc<TokioMutex<AgentSessionManager>>>,
) -> Result<(), String> {
    let mut sessions = agent_sessions.lock().await;
    sessions.kill_session(&task_id);
    Ok(())
}

// ─── Agent persistence commands (DB-backed) ─────────────────────────────────

/// Get or create an agent session for a task (DB-backed)
#[tauri::command(rename_all = "camelCase")]
pub async fn get_agent_session_for_task(
    task_id: String,
    working_dir: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentSession, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_or_create_agent_session_for_task(&conn, &task_id, working_dir.as_deref())
        .map_err(|e| e.to_string())
}

/// Update agent session CLI session ID (for --resume)
#[tauri::command(rename_all = "camelCase")]
pub async fn update_agent_cli_session_id(
    session_id: String,
    cli_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentSession, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_agent_session_cli_id(&conn, &session_id, cli_session_id.as_deref())
        .map_err(|e| e.to_string())
}

/// Update agent session status
#[tauri::command(rename_all = "camelCase")]
pub async fn update_agent_status(
    session_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<AgentSession, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_agent_session_status(&conn, &session_id, &status)
        .map_err(|e| e.to_string())
}

/// Get count of running agent sessions (for max concurrent check)
#[tauri::command(rename_all = "camelCase")]
pub async fn get_running_agent_count(
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::count_running_agent_sessions(&conn)
        .map_err(|e| e.to_string())
}

/// Save an agent message to DB
#[tauri::command(rename_all = "camelCase")]
pub async fn save_agent_message(
    task_id: String,
    role: String,
    content: String,
    model: Option<String>,
    effort_level: Option<String>,
    tool_calls: Option<String>,
    thinking_content: Option<String>,
    state: State<'_, AppState>,
) -> Result<AgentMessage, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::insert_agent_message(
        &conn,
        &task_id,
        &role,
        &content,
        model.as_deref(),
        effort_level.as_deref(),
        tool_calls.as_deref(),
        thinking_content.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// Get agent messages for a task
#[tauri::command(rename_all = "camelCase")]
pub async fn get_agent_messages(
    task_id: String,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<AgentMessage>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_agent_messages(&conn, &task_id, limit)
        .map_err(|e| e.to_string())
}

/// Clear agent messages for a task
#[tauri::command(rename_all = "camelCase")]
pub async fn clear_agent_messages(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_agent_messages(&conn, &task_id)
        .map_err(|e| e.to_string())
}
