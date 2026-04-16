//! Pipeline commands for Tauri IPC

use crate::db::{self, AppState, ColumnTimingAverage, PipelineTiming, Task};
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

/// Update script exit code for a task (called when script PTY exits)
#[tauri::command(rename_all = "camelCase")]
pub fn update_script_exit_code(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    exit_code: i64,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Update the exit code
    db::update_task_script_exit_code(&conn, &task_id, Some(exit_code))?;

    // Mark pipeline as complete with success based on exit code
    let success = exit_code == 0;
    pipeline::mark_complete(&conn, &app, &task_id, success)
}

/// Get pipeline timing breakdown for a task
#[tauri::command(rename_all = "camelCase")]
pub fn get_pipeline_timing(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<PipelineTiming>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_pipeline_timing(&conn, &task_id)?)
}

/// Get average pipeline timing per column for a workspace
#[tauri::command(rename_all = "camelCase")]
pub fn get_average_pipeline_timing(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Vec<ColumnTimingAverage>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_average_pipeline_timing(&conn, &workspace_id)?)
}
