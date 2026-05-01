use crate::db::{self, AppState, Label, Task};
use crate::error::AppError;
use crate::pipeline;
use tauri::{AppHandle, State};

const DEFAULT_LABEL_COLOR: &str = "#64748b";

fn clean_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput(
            "Label name cannot be empty".to_string(),
        ));
    }
    if name.len() > 48 {
        return Err(AppError::InvalidInput(
            "Label name must be 48 characters or fewer".to_string(),
        ));
    }
    Ok(name.to_string())
}

fn clean_color(color: &str) -> Result<String, AppError> {
    let color = color.trim();
    let valid = color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if !valid {
        return Err(AppError::InvalidInput(
            "Label color must be a hex color like #64748b".to_string(),
        ));
    }
    Ok(color.to_ascii_lowercase())
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
pub fn create_label(
    state: State<AppState>,
    workspace_id: String,
    name: String,
    color: Option<String>,
) -> Result<Label, AppError> {
    let name = clean_name(&name)?;
    let color = clean_color(color.as_deref().unwrap_or(DEFAULT_LABEL_COLOR))?;
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::insert_label(&conn, &workspace_id, &name, &color)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_label(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<Label, AppError> {
    let name = name.as_deref().map(clean_name).transpose()?;
    let color = color.as_deref().map(clean_color).transpose()?;
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_label(
        &conn,
        &id,
        name.as_deref(),
        color.as_deref(),
    )?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_label(app: AppHandle, state: State<AppState>, id: String) -> Result<(), AppError> {
    let workspace_id = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let label = db::get_label(&conn, &id)?;
        let workspace_id = label.workspace_id.clone();
        db::delete_label(&conn, &id)?;
        workspace_id
    };
    pipeline::emit_tasks_changed(&app, &workspace_id, "label_deleted");
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_task_labels(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    label_ids: Vec<String>,
) -> Result<Task, AppError> {
    let (workspace_id, task) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::set_task_labels(&conn, &task_id, &label_ids)?;
        let task = db::get_task(&conn, &task_id)?;
        (task.workspace_id.clone(), task)
    };
    pipeline::emit_tasks_changed(&app, &workspace_id, "task_labels_updated");
    Ok(task)
}
