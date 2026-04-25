use crate::chat::SharedSessionRegistry;
use crate::db::{self, AppState, ChatMessage, ChatSession, OrchestratorSession};
use crate::error::AppError;
use tauri::State;

use super::{
    db_conn, session_registry_key, types::OrchestratorContext, DEFAULT_CHAT_SESSION_TITLE,
};

pub(super) fn get_orchestrator_context(
    state: State<AppState>,
    workspace_id: String,
) -> Result<OrchestratorContext, AppError> {
    let conn = db_conn(&state)?;

    let workspace = db::get_workspace(&conn, &workspace_id)?;
    let columns = db::list_columns(&conn, &workspace_id)?;
    let tasks = db::list_tasks(&conn, &workspace_id)?;
    let recent_messages = db::list_chat_messages(&conn, &workspace_id, Some(20))?;

    Ok(OrchestratorContext {
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        columns,
        tasks,
        recent_messages,
    })
}

pub(super) fn get_orchestrator_session(
    state: State<AppState>,
    workspace_id: String,
) -> Result<OrchestratorSession, AppError> {
    let conn = db_conn(&state)?;
    Ok(db::get_or_create_orchestrator_session(
        &conn,
        &workspace_id,
    )?)
}

pub(super) fn list_chat_sessions(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Vec<ChatSession>, AppError> {
    let conn = db_conn(&state)?;
    Ok(db::list_chat_sessions(&conn, &workspace_id)?)
}

pub(super) fn get_active_chat_session(
    state: State<AppState>,
    workspace_id: String,
) -> Result<ChatSession, AppError> {
    let conn = db_conn(&state)?;
    Ok(db::get_or_create_active_session(&conn, &workspace_id)?)
}

pub(super) fn create_chat_session(
    state: State<AppState>,
    workspace_id: String,
    title: Option<String>,
) -> Result<ChatSession, AppError> {
    let conn = db_conn(&state)?;
    let title = title.unwrap_or_else(|| DEFAULT_CHAT_SESSION_TITLE.to_string());
    Ok(db::create_chat_session(&conn, &workspace_id, &title)?)
}

pub(super) async fn delete_chat_session(
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    session_id: String,
) -> Result<(), AppError> {
    let workspace_id = {
        let conn = db_conn(&state)?;
        db::get_chat_session(&conn, &session_id)
            .map(|s| s.workspace_id)
            .ok()
    };

    if let Some(ws_id) = &workspace_id {
        let registry_key = session_registry_key(ws_id, &session_id);
        let mut registry = session_registry.lock().await;
        registry.remove(&registry_key);
    }

    let conn = db_conn(&state)?;
    db::delete_chat_session(&conn, &session_id)?;
    Ok(())
}

pub(super) fn get_chat_history(
    state: State<AppState>,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, AppError> {
    let conn = db_conn(&state)?;
    Ok(db::list_chat_messages(&conn, &session_id, limit)?)
}

pub(super) fn clear_chat_history(
    state: State<AppState>,
    session_id: String,
) -> Result<(), AppError> {
    let conn = db_conn(&state)?;
    db::delete_chat_messages(&conn, &session_id)?;
    Ok(())
}

pub(super) async fn reset_cli_session(
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    session_id: String,
) -> Result<(), AppError> {
    let workspace_id = {
        let conn = db_conn(&state)?;
        db::get_chat_session(&conn, &session_id)
            .map(|s| s.workspace_id)
            .ok()
    };

    if let Some(ws_id) = &workspace_id {
        let registry_key = session_registry_key(ws_id, &session_id);
        let mut registry = session_registry.lock().await;
        if let Some(session) = registry.get_mut(&registry_key) {
            let _ = session.kill();
        }
    }

    {
        let conn = db_conn(&state)?;
        let _ = db::update_chat_session_cli_id(&conn, &session_id, None);
    }

    Ok(())
}
