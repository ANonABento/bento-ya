//! Pipeline commands for Tauri IPC

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::db::{self, AppState, Task};
use crate::error::AppError;
use crate::pipeline::{self, PipelineState};
use crate::process::agent_runner::AgentRunner;
use tauri::{AppHandle, Emitter, State};

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

/// Fire agent trigger - spawns agent and links session to task
/// Called by frontend after receiving pipeline:spawn_agent event
#[tauri::command(rename_all = "camelCase")]
pub async fn fire_agent_trigger(
    task_id: String,
    agent_type: String,
    env_vars: Option<HashMap<String, String>>,
    cli_path: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<Task, String> {
    // Get task and workspace to find working directory
    let (_task, workspace, column) = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let task = db::get_task(&conn, &task_id).map_err(|e| format!("Task not found: {}", e))?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)
            .map_err(|e| format!("Workspace not found: {}", e))?;
        let column = db::get_column(&conn, &task.column_id)
            .map_err(|e| format!("Column not found: {}", e))?;
        (task, workspace, column)
    };

    let working_dir = workspace.repo_path.clone();

    // Spawn the agent via agent_runner
    let session = {
        let mut runner = agent_runner
            .lock()
            .map_err(|e| format!("Agent runner lock error: {}", e))?;

        runner.start_agent(
            &task_id,
            &agent_type,
            &working_dir,
            env_vars,
            cli_path,
            app_handle.clone(),
        )?
    };

    // Update task: set pipeline state to running and link agent session
    let updated_task = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let ts = db::now();

        // Update pipeline state to running
        db::update_task_pipeline_state(
            &conn,
            &task_id,
            PipelineState::Running.as_str(),
            Some(&ts),
            None,
        )
        .map_err(|e| format!("Failed to update pipeline state: {}", e))?;

        // Link agent session to task
        db::update_task_agent_session(&conn, &task_id, Some(&session.task_id))
            .map_err(|e| format!("Failed to link agent session: {}", e))?
    };

    // Emit running event
    let _ = app_handle.emit(
        "pipeline:running",
        &pipeline::PipelineEvent {
            task_id: task_id.clone(),
            column_id: column.id.clone(),
            event_type: "running".to_string(),
            state: PipelineState::Running.as_str().to_string(),
            message: Some(format!("Agent spawned: {} (pid: {:?})", agent_type, session.pid)),
        },
    );

    Ok(updated_task)
}
