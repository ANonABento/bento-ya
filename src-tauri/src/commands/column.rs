use crate::db::{self, AppState, Column};
use crate::error::AppError;
use tauri::State;

#[tauri::command]
pub fn create_column(
    state: State<AppState>,
    workspace_id: String,
    name: String,
    position: i64,
) -> Result<Column, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidInput("Column name cannot be empty".to_string()));
    }
    if position < 0 {
        return Err(AppError::InvalidInput("Position must be non-negative".to_string()));
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::insert_column(&conn, &workspace_id, name.trim(), position)?)
}

#[tauri::command]
pub fn list_columns(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Vec<Column>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_columns(&conn, &workspace_id)?)
}

#[tauri::command]
pub fn update_column(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    icon: Option<String>,
    position: Option<i64>,
    color: Option<Option<String>>,
    visible: Option<bool>,
    trigger_config: Option<String>,
    exit_config: Option<String>,
    auto_advance: Option<bool>,
) -> Result<Column, AppError> {
    if let Some(ref n) = name {
        if n.trim().is_empty() {
            return Err(AppError::InvalidInput("Column name cannot be empty".to_string()));
        }
    }
    if let Some(pos) = position {
        if pos < 0 {
            return Err(AppError::InvalidInput("Position must be non-negative".to_string()));
        }
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let color_ref = color.as_ref().map(|c| c.as_deref());
    Ok(db::update_column(
        &conn,
        &id,
        name.as_deref(),
        icon.as_deref(),
        position,
        color_ref,
        visible,
        trigger_config.as_deref(),
        exit_config.as_deref(),
        auto_advance,
    )?)
}

#[tauri::command]
pub fn reorder_columns(
    state: State<AppState>,
    workspace_id: String,
    column_ids: Vec<String>,
) -> Result<Vec<Column>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    for (i, col_id) in column_ids.iter().enumerate() {
        db::update_column(&conn, col_id, None, None, Some(i as i64), None, None, None, None, None)?;
    }

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_columns(&conn, &workspace_id)?)
}

#[tauri::command]
pub fn delete_column(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Check if column has tasks
    let task_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tasks WHERE column_id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;

    if task_count > 0 {
        return Err(AppError::InvalidInput(format!(
            "Column has {} task(s). Move or delete them first.",
            task_count
        )));
    }

    db::delete_column(&conn, &id)?;
    Ok(())
}
