use crate::db::{self, AppState, Column};
use crate::error::AppError;
use crate::pipeline::triggers::ColumnTriggersV2;
use tauri::State;

#[tauri::command]
pub fn create_column(
    state: State<AppState>,
    workspace_id: String,
    name: String,
    position: i64,
) -> Result<Column, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Column name cannot be empty".to_string(),
        ));
    }
    if position < 0 {
        return Err(AppError::InvalidInput(
            "Position must be non-negative".to_string(),
        ));
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::insert_column(
        &conn,
        &workspace_id,
        name.trim(),
        position,
    )?)
}

#[tauri::command]
pub fn list_columns(state: State<AppState>, workspace_id: String) -> Result<Vec<Column>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_columns(&conn, &workspace_id)?)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_column(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    icon: Option<String>,
    position: Option<i64>,
    color: Option<Option<String>>,
    visible: Option<bool>,
    triggers: Option<String>,
) -> Result<Column, AppError> {
    if let Some(ref n) = name {
        if n.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "Column name cannot be empty".to_string(),
            ));
        }
    }
    if let Some(pos) = position {
        if pos < 0 {
            return Err(AppError::InvalidInput(
                "Position must be non-negative".to_string(),
            ));
        }
    }

    // Validate trigger JSON if provided
    if let Some(ref t) = triggers {
        if !t.is_empty() && t != "{}" {
            match serde_json::from_str::<ColumnTriggersV2>(t) {
                Ok(_) => {} // Valid
                Err(e) => {
                    return Err(AppError::InvalidInput(format!(
                        "Invalid trigger configuration: {}. Check that trigger types match: auto_setup, spawn_cli, move_column, trigger_task, run_script (requires script_id), create_pr, none.",
                        e
                    )));
                }
            }
        }
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let color_ref = color.as_ref().map(|c| c.as_deref());
    Ok(db::update_column(
        &conn,
        &id,
        name.as_deref(),
        icon.as_deref(),
        position,
        color_ref,
        visible,
        triggers.as_deref(),
    )?)
}

#[tauri::command]
pub fn reorder_columns(
    state: State<AppState>,
    workspace_id: String,
    column_ids: Vec<String>,
) -> Result<Vec<Column>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let existing_columns = db::list_columns(&conn, &workspace_id)?;
    let mut ordered_ids = column_ids;
    for column in existing_columns {
        if !ordered_ids.contains(&column.id) {
            ordered_ids.push(column.id);
        }
    }

    for (i, col_id) in ordered_ids.iter().enumerate() {
        db::update_column(&conn, col_id, None, None, Some(i as i64), None, None, None)?;
    }

    Ok(db::list_columns(&conn, &workspace_id)?)
}

#[tauri::command]
pub fn delete_column(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db::delete_column(&conn, &id)?;
    Ok(())
}
