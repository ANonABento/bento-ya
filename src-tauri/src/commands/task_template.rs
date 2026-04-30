use crate::db::{self, AppState, Task, TaskTemplate};
use crate::error::AppError;
use crate::pipeline;
use tauri::{AppHandle, State};

fn validate_template(title: &str, labels: &str) -> Result<(), AppError> {
    if title.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Template title cannot be empty".to_string(),
        ));
    }
    serde_json::from_str::<Vec<String>>(labels)
        .map_err(|e| AppError::InvalidInput(format!("Invalid labels JSON: {}", e)))?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_task_templates(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Vec<TaskTemplate>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_task_templates(&conn, &workspace_id)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_task_template_from_task(
    state: State<AppState>,
    task_id: String,
) -> Result<TaskTemplate, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, &task_id)?;
    Ok(db::insert_task_template_from_task(&conn, &task)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_task_template(
    state: State<AppState>,
    id: String,
    title: String,
    description: Option<String>,
    labels: String,
    model: Option<String>,
) -> Result<TaskTemplate, AppError> {
    validate_template(&title, &labels)?;
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_task_template(
        &conn,
        &id,
        title.trim(),
        description.as_deref(),
        &labels,
        model.as_deref(),
    )?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_task_template(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::delete_task_template(&conn, &id)?)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_task_from_template(
    app: AppHandle,
    state: State<'_, AppState>,
    template_id: String,
    column_id: String,
) -> Result<Task, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let template = db::get_task_template(&conn, &template_id)?;
    let column = db::get_column(&conn, &column_id)?;
    if column.workspace_id != template.workspace_id {
        return Err(AppError::InvalidInput(
            "Template and target column must belong to the same workspace".to_string(),
        ));
    }

    let task = db::insert_task(
        &conn,
        &template.workspace_id,
        &column_id,
        &template.title,
        template.description.as_deref(),
    )?;

    let ts = db::now();
    conn.execute(
        "UPDATE tasks SET pr_labels = ?1, model = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![template.labels, template.model, ts, task.id],
    )
    .map_err(AppError::from)?;

    let task = db::get_task(&conn, &task.id)?;
    let task = pipeline::fire_trigger(&conn, &app, &task, &column)?;
    pipeline::emit_tasks_changed(&app, &template.workspace_id, "task_created_from_template");

    Ok(task)
}
