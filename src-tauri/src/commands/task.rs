use crate::db::{self, AppState, Task};
use crate::error::AppError;
use crate::pipeline;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn create_task(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    column_id: String,
    title: String,
    description: Option<String>,
) -> Result<Task, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::InvalidInput("Task title cannot be empty".to_string()));
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::insert_task(
        &conn,
        &workspace_id,
        &column_id,
        title.trim(),
        description.as_deref(),
    )?;

    // Fire column trigger for the initial column
    let column = db::get_column(&conn, &column_id)?;
    let task = pipeline::fire_trigger(&conn, &app, &task, &column)?;

    Ok(task)
}

#[tauri::command]
pub fn get_task(state: State<AppState>, id: String) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_task(&conn, &id)?)
}

#[tauri::command]
pub fn list_tasks(state: State<AppState>, workspace_id: String) -> Result<Vec<Task>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_tasks(&conn, &workspace_id)?)
}

#[tauri::command]
pub fn update_task(
    state: State<AppState>,
    id: String,
    title: Option<String>,
    description: Option<Option<String>>,
    column_id: Option<String>,
    position: Option<i64>,
    agent_mode: Option<Option<String>>,
    priority: Option<String>,
) -> Result<Task, AppError> {
    if let Some(ref t) = title {
        if t.trim().is_empty() {
            return Err(AppError::InvalidInput("Task title cannot be empty".to_string()));
        }
    }
    if let Some(pos) = position {
        if pos < 0 {
            return Err(AppError::InvalidInput("Position must be non-negative".to_string()));
        }
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let desc_ref = description.as_ref().map(|d| d.as_deref());
    let mode_ref = agent_mode.as_ref().map(|m| m.as_deref());
    Ok(db::update_task(
        &conn,
        &id,
        title.as_deref(),
        desc_ref,
        column_id.as_deref(),
        position,
        mode_ref,
        priority.as_deref(),
    )?)
}

#[tauri::command]
pub fn move_task(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    target_column_id: String,
    position: i64,
) -> Result<Task, AppError> {
    if position < 0 {
        return Err(AppError::InvalidInput("Position must be non-negative".to_string()));
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get the task's current column to check if it changed
    let task_before = db::get_task(&conn, &id)?;
    let column_changed = task_before.column_id != target_column_id;

    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Update column and position atomically
    // Also reset pipeline state when moving to a new column
    let ts = db::now();
    if column_changed {
        conn.execute(
            "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', pipeline_triggered_at = NULL, pipeline_error = NULL, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![target_column_id, position, ts, id],
        )
        .map_err(AppError::from)?;
    } else {
        conn.execute(
            "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![target_column_id, position, ts, id],
        )
        .map_err(AppError::from)?;
    }

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let task = db::get_task(&conn, &id)?;

    // Fire column trigger if task moved to a new column
    if column_changed {
        let target_column = db::get_column(&conn, &target_column_id)?;
        let task = pipeline::fire_trigger(&conn, &app, &task, &target_column)?;
        return Ok(task);
    }

    Ok(task)
}

#[tauri::command]
pub fn reorder_tasks(
    state: State<AppState>,
    column_id: String,
    task_ids: Vec<String>,
) -> Result<Vec<Task>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let ts = db::now();

    for (i, task_id) in task_ids.iter().enumerate() {
        conn.execute(
            "UPDATE tasks SET position = ?1, updated_at = ?2 WHERE id = ?3 AND column_id = ?4",
            rusqlite::params![i as i64, ts, task_id, column_id],
        )
        .map_err(AppError::from)?;
    }

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get the workspace_id from the column to list tasks
    let col = db::get_column(&conn, &column_id)?;
    Ok(db::list_tasks(&conn, &col.workspace_id)?)
}

#[tauri::command]
pub fn delete_task(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_task(&conn, &id)?;
    Ok(())
}
