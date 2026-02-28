use crate::db::{self, AppState, Column, Workspace};
use crate::error::AppError;
use tauri::State;

const DEFAULT_COLUMNS: &[&str] = &["Backlog", "Working", "Review", "Done"];

#[tauri::command]
pub fn create_workspace(
    state: State<AppState>,
    name: String,
    repo_path: String,
) -> Result<Workspace, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidInput("Workspace name cannot be empty".to_string()));
    }
    if repo_path.trim().is_empty() {
        return Err(AppError::InvalidInput("Repository path cannot be empty".to_string()));
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let ws = db::insert_workspace(&conn, name.trim(), repo_path.trim())?;

    // Auto-create default columns
    for (i, col_name) in DEFAULT_COLUMNS.iter().enumerate() {
        db::insert_column(&conn, &ws.id, col_name, i as i64)?;
    }

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(ws)
}

#[tauri::command]
pub fn get_workspace(state: State<AppState>, id: String) -> Result<Workspace, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_workspace(&conn, &id)?)
}

#[tauri::command]
pub fn list_workspaces(state: State<AppState>) -> Result<Vec<Workspace>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_workspaces(&conn)?)
}

#[tauri::command]
pub fn update_workspace(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    repo_path: Option<String>,
    tab_order: Option<i64>,
    is_active: Option<bool>,
) -> Result<Workspace, AppError> {
    if let Some(ref n) = name {
        if n.trim().is_empty() {
            return Err(AppError::InvalidInput("Workspace name cannot be empty".to_string()));
        }
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_workspace(
        &conn,
        &id,
        name.as_deref(),
        repo_path.as_deref(),
        tab_order,
        is_active,
    )?)
}

#[tauri::command]
pub fn delete_workspace(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    // CASCADE handles associated columns/tasks
    db::delete_workspace(&conn, &id)?;
    Ok(())
}

/// List columns for a workspace (used internally, also exposed as command).
pub fn get_default_columns(
    state: &State<AppState>,
    workspace_id: &str,
) -> Result<Vec<Column>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_columns(&conn, workspace_id)?)
}
