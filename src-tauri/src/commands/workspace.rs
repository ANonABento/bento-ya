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

/// Clone an existing workspace with all its columns and tasks
#[tauri::command]
pub fn clone_workspace(
    state: State<AppState>,
    source_id: String,
    new_name: String,
) -> Result<Workspace, AppError> {
    if new_name.trim().is_empty() {
        return Err(AppError::InvalidInput("New workspace name cannot be empty".to_string()));
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get source workspace
    let source = db::get_workspace(&conn, &source_id)?;

    // Create new workspace with same repo path
    let new_ws = db::insert_workspace(&conn, new_name.trim(), &source.repo_path)?;

    // Copy columns
    let columns = db::list_columns(&conn, &source_id)?;
    let mut column_id_map = std::collections::HashMap::new();

    for col in &columns {
        let new_col = db::insert_column(&conn, &new_ws.id, &col.name, col.position)?;
        // Update the column with all properties
        db::update_column(
            &conn,
            &new_col.id,
            Some(&col.name),
            Some(&col.icon),
            Some(col.position),
            Some(col.color.as_deref()),
            Some(col.visible),
            Some(&col.trigger_config),
            Some(&col.exit_config),
            Some(col.auto_advance),
        )?;
        column_id_map.insert(col.id.clone(), new_col.id);
    }

    // Copy tasks
    for col in &columns {
        let tasks = db::list_tasks_by_column(&conn, &col.id)?;
        let new_col_id = column_id_map.get(&col.id).unwrap();

        for task in tasks {
            let new_task = db::insert_task(
                &conn,
                &new_ws.id,
                new_col_id,
                &task.title,
                task.description.as_deref(),
            )?;
            // Update task position and priority
            db::update_task(
                &conn,
                &new_task.id,
                Some(&task.title),
                Some(task.description.as_deref()),
                None, // column_id stays the same
                Some(task.position),
                Some(task.agent_mode.as_deref()),
                Some(&task.priority),
            )?;
        }
    }

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(new_ws)
}
