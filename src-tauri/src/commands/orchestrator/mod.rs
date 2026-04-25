mod actions;
mod sessions;
mod stream;
mod stream_api;
mod stream_cli;
mod types;

pub use types::{
    ApiStreamRegistry, OrchestratorAction, OrchestratorContext, OrchestratorEvent,
    OrchestratorResponse,
};

use crate::chat::SharedSessionRegistry;
use crate::db::{AppState, ChatMessage, ChatSession, OrchestratorSession};
use crate::error::AppError;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_orchestrator_context(
    state: State<AppState>,
    workspace_id: String,
) -> Result<OrchestratorContext, AppError> {
    sessions::get_orchestrator_context(state, workspace_id)
}

#[tauri::command]
pub fn get_orchestrator_session(
    state: State<AppState>,
    workspace_id: String,
) -> Result<OrchestratorSession, AppError> {
    sessions::get_orchestrator_session(state, workspace_id)
}

#[tauri::command]
pub fn list_chat_sessions(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Vec<ChatSession>, AppError> {
    sessions::list_chat_sessions(state, workspace_id)
}

#[tauri::command]
pub fn get_active_chat_session(
    state: State<AppState>,
    workspace_id: String,
) -> Result<ChatSession, AppError> {
    sessions::get_active_chat_session(state, workspace_id)
}

#[tauri::command]
pub fn create_chat_session(
    state: State<AppState>,
    workspace_id: String,
    title: Option<String>,
) -> Result<ChatSession, AppError> {
    sessions::create_chat_session(state, workspace_id, title)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_chat_session(
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    session_id: String,
) -> Result<(), AppError> {
    sessions::delete_chat_session(state, session_registry, session_id).await
}

#[tauri::command]
pub fn get_chat_history(
    state: State<AppState>,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, AppError> {
    sessions::get_chat_history(state, session_id, limit)
}

#[tauri::command]
pub fn clear_chat_history(state: State<AppState>, session_id: String) -> Result<(), AppError> {
    sessions::clear_chat_history(state, session_id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reset_cli_session(
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    session_id: String,
) -> Result<(), AppError> {
    sessions::reset_cli_session(state, session_registry, session_id).await
}

#[tauri::command]
pub fn process_orchestrator_response(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    response_text: String,
    actions: Vec<OrchestratorAction>,
) -> Result<OrchestratorResponse, AppError> {
    actions::process_orchestrator_response(app, state, workspace_id, response_text, actions)
}

#[tauri::command]
pub fn set_orchestrator_error(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    error_message: String,
) -> Result<OrchestratorSession, AppError> {
    actions::set_orchestrator_error(app, state, workspace_id, error_message)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
pub async fn stream_orchestrator_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    api_stream_registry: State<'_, ApiStreamRegistry>,
    workspace_id: String,
    session_id: String,
    message: String,
    connection_mode: String,
    api_key: Option<String>,
    api_key_env_var: Option<String>,
    model: Option<String>,
    cli_path: Option<String>,
) -> Result<(), AppError> {
    stream::stream_orchestrator_chat(
        app,
        state,
        session_registry,
        api_stream_registry,
        workspace_id,
        session_id,
        message,
        connection_mode,
        api_key,
        api_key_env_var,
        model,
        cli_path,
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cancel_orchestrator_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    api_stream_registry: State<'_, ApiStreamRegistry>,
    session_id: String,
    workspace_id: String,
) -> Result<(), AppError> {
    stream::cancel_orchestrator_chat(
        app,
        state,
        session_registry,
        api_stream_registry,
        session_id,
        workspace_id,
    )
    .await
}
