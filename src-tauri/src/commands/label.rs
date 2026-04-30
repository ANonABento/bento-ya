use crate::db::{self, AppState, Label, TaskLabelAssignment};
use crate::error::AppError;
use crate::pipeline;
use tauri::{AppHandle, State};

fn normalize_color(color: &str) -> Result<&str, AppError> {
    let is_hex = color.len() == 7
        && color.starts_with('#')
        && color.chars().skip(1).all(|c| c.is_ascii_hexdigit());
    if is_hex {
        Ok(color)
    } else {
        Err(AppError::InvalidInput(
            "Label color must be a #RRGGBB hex value".to_string(),
        ))
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_label(
    state: State<AppState>,
    workspace_id: String,
    name: String,
    color: String,
) -> Result<Label, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput(
            "Label name cannot be empty".to_string(),
        ));
    }
    let color = normalize_color(color.trim())?;
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::create_label(&conn, &workspace_id, name, color)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_labels(state: State<AppState>, workspace_id: String) -> Result<Vec<Label>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_labels(&conn, &workspace_id)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_label(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<Label, AppError> {
    if let Some(ref n) = name {
        if n.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "Label name cannot be empty".to_string(),
            ));
        }
    }
    let color = color
        .as_deref()
        .map(str::trim)
        .map(normalize_color)
        .transpose()?;
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_label(
        &conn,
        &id,
        name.as_deref().map(str::trim),
        color,
    )?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_label(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_label(&conn, &id)?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_task_label_assignments(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Vec<TaskLabelAssignment>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_task_label_assignments(&conn, &workspace_id)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_task_labels(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    label_ids: Vec<String>,
) -> Result<Vec<String>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, &task_id)?;
    let ids = db::set_task_labels(&conn, &task_id, &label_ids)?;
    pipeline::emit_tasks_changed(&app, &task.workspace_id, "task_labels_updated");
    Ok(ids)
}
