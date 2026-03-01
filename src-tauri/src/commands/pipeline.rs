//! Pipeline commands for Tauri IPC

use crate::db::{self, AppState, Task};
use crate::error::AppError;
use crate::pipeline;
use tauri::{AppHandle, State};

/// Mark a pipeline execution as complete
#[tauri::command]
pub fn mark_pipeline_complete(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    success: bool,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    pipeline::mark_complete(&conn, &app, &task_id, success)
}

/// Get the pipeline state for a task
#[tauri::command]
pub fn get_pipeline_state(
    state: State<AppState>,
    task_id: String,
) -> Result<String, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, &task_id)?;
    Ok(task.pipeline_state)
}

/// Try to advance a task to the next column
#[tauri::command]
pub fn try_advance_task(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> Result<Option<Task>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, &task_id)?;
    let column = db::get_column(&conn, &task.column_id)?;
    pipeline::try_auto_advance(&conn, &app, &task, &column)
}

/// Set pipeline error state for a task
#[tauri::command]
pub fn set_pipeline_error(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    error_message: String,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, &task_id)?;
    let column = db::get_column(&conn, &task.column_id)?;
    pipeline::handle_trigger_failure(&conn, &app, &task, &column, &error_message)
}
