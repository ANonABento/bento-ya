use crate::db::{self, AppState, OrchestratorSession};
use crate::error::AppError;
use tauri::{AppHandle, Emitter, State};

use super::types::{OrchestratorAction, OrchestratorEvent, OrchestratorResponse};

pub(super) fn process_orchestrator_response(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    response_text: String,
    actions: Vec<OrchestratorAction>,
) -> Result<OrchestratorResponse, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let chat_session = db::get_or_create_active_session(&conn, &workspace_id)?;

    let _ = db::insert_chat_message(
        &conn,
        &workspace_id,
        &chat_session.id,
        "assistant",
        &response_text,
    )?;

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

    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let _ = db::update_orchestrator_session(&conn, &session.id, Some("idle"), None);

    let _ = app.emit(
        "orchestrator:complete",
        &OrchestratorEvent {
            workspace_id: workspace_id.clone(),
            event_type: "complete".to_string(),
            message: Some(format!("Created {} task(s)", tasks_created.len())),
        },
    );

    Ok(OrchestratorResponse {
        message: response_text,
        actions: actions.clone(),
        tasks_created,
    })
}

pub(super) fn set_orchestrator_error(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    error_message: String,
) -> Result<OrchestratorSession, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let updated = db::update_orchestrator_session(
        &conn,
        &session.id,
        Some("error"),
        Some(Some(&error_message)),
    )?;

    let _ = app.emit(
        "orchestrator:error",
        &OrchestratorEvent {
            workspace_id,
            event_type: "error".to_string(),
            message: Some(error_message),
        },
    );

    Ok(updated)
}
