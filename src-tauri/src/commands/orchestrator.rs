//! Orchestrator commands for Tauri IPC
//!
//! The orchestrator is a dedicated agent that interprets natural language
//! and creates/manages tasks on the board.

use crate::db::{self, AppState, ChatMessage, OrchestratorSession, Column, Task};
use crate::error::AppError;
use tauri::{AppHandle, Emitter, State};
use serde::{Deserialize, Serialize};

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorContext {
    pub workspace_id: String,
    pub workspace_name: String,
    pub columns: Vec<Column>,
    pub tasks: Vec<Task>,
    pub recent_messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorAction {
    pub action_type: String, // create_task, update_task, split_task, etc.
    pub title: Option<String>,
    pub description: Option<String>,
    pub column_id: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrchestratorResponse {
    pub message: String,
    pub actions: Vec<OrchestratorAction>,
    pub tasks_created: Vec<Task>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrchestratorEvent {
    pub workspace_id: String,
    pub event_type: String,
    pub message: Option<String>,
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// Get the orchestrator context for a workspace
#[tauri::command]
pub fn get_orchestrator_context(
    state: State<AppState>,
    workspace_id: String,
) -> Result<OrchestratorContext, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
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

/// Get or create the orchestrator session for a workspace
#[tauri::command]
pub fn get_orchestrator_session(
    state: State<AppState>,
    workspace_id: String,
) -> Result<OrchestratorSession, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_or_create_orchestrator_session(&conn, &workspace_id)?)
}

/// Send a message to the orchestrator
#[tauri::command]
pub fn send_orchestrator_message(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    message: String,
) -> Result<ChatMessage, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    // Store user message
    let user_msg = db::insert_chat_message(&conn, &workspace_id, "user", &message)?;
    
    // Update session status to processing
    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let _ = db::update_orchestrator_session(&conn, &session.id, Some("processing"), None);
    
    // Emit event
    let _ = app.emit("orchestrator:processing", &OrchestratorEvent {
        workspace_id: workspace_id.clone(),
        event_type: "processing".to_string(),
        message: Some(message.clone()),
    });
    
    Ok(user_msg)
}

/// Get chat history for a workspace
#[tauri::command]
pub fn get_chat_history(
    state: State<AppState>,
    workspace_id: String,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_chat_messages(&conn, &workspace_id, limit)?)
}

/// Clear chat history for a workspace
#[tauri::command]
pub fn clear_chat_history(
    state: State<AppState>,
    workspace_id: String,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_chat_messages(&conn, &workspace_id)?;
    Ok(())
}

/// Process orchestrator response (creates tasks based on parsed actions)
/// This is called by the frontend after receiving structured output from the LLM
#[tauri::command]
pub fn process_orchestrator_response(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    response_text: String,
    actions: Vec<OrchestratorAction>,
) -> Result<OrchestratorResponse, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    // Store assistant message
    let _ = db::insert_chat_message(&conn, &workspace_id, "assistant", &response_text)?;
    
    // Process actions
    let mut tasks_created = Vec::new();
    
    for action in &actions {
        match action.action_type.as_str() {
            "create_task" => {
                if let (Some(title), Some(column_id)) = (&action.title, &action.column_id) {
                    let task = db::insert_task(
                        &conn,
                        &workspace_id,
                        column_id,
                        title,
                        action.description.as_deref(),
                    )?;
                    tasks_created.push(task);
                }
            }
            "update_task" => {
                if let Some(task_id) = &action.task_id {
                    let _ = db::update_task(
                        &conn,
                        task_id,
                        action.title.as_deref(),
                        action.description.as_ref().map(|d| Some(d.as_str())),
                        action.column_id.as_deref(),
                        None,
                        None,
                        None,
                    );
                }
            }
            _ => {}
        }
    }
    
    // Update session status to idle
    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let _ = db::update_orchestrator_session(&conn, &session.id, Some("idle"), None);
    
    // Emit completion event
    let _ = app.emit("orchestrator:complete", &OrchestratorEvent {
        workspace_id: workspace_id.clone(),
        event_type: "complete".to_string(),
        message: Some(format!("Created {} task(s)", tasks_created.len())),
    });
    
    Ok(OrchestratorResponse {
        message: response_text,
        actions: actions.clone(),
        tasks_created,
    })
}

/// Set orchestrator error state
#[tauri::command]
pub fn set_orchestrator_error(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    error_message: String,
) -> Result<OrchestratorSession, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let updated = db::update_orchestrator_session(&conn, &session.id, Some("error"), Some(Some(&error_message)))?;
    
    // Emit error event
    let _ = app.emit("orchestrator:error", &OrchestratorEvent {
        workspace_id,
        event_type: "error".to_string(),
        message: Some(error_message),
    });
    
    Ok(updated)
}
