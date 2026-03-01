use tauri::State;
use crate::db::{
    self, AppState, UsageRecord, UsageSummary,
};
use crate::error::AppError;

#[tauri::command]
pub fn record_usage(
    state: State<AppState>,
    workspace_id: String,
    task_id: Option<String>,
    session_id: Option<String>,
    provider: String,
    model: String,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
) -> Result<UsageRecord, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::insert_usage_record(
        &conn,
        &workspace_id,
        task_id.as_deref(),
        session_id.as_deref(),
        &provider,
        &model,
        input_tokens,
        output_tokens,
        cost_usd,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn get_workspace_usage(
    state: State<AppState>,
    workspace_id: String,
    limit: Option<i64>,
) -> Result<Vec<UsageRecord>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::list_usage_records(&conn, &workspace_id, limit).map_err(AppError::from)
}

#[tauri::command]
pub fn get_task_usage(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<UsageRecord>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::list_task_usage(&conn, &task_id).map_err(AppError::from)
}

#[tauri::command]
pub fn get_workspace_usage_summary(
    state: State<AppState>,
    workspace_id: String,
) -> Result<UsageSummary, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::get_workspace_usage_summary(&conn, &workspace_id).map_err(AppError::from)
}

#[tauri::command]
pub fn get_task_usage_summary(
    state: State<AppState>,
    task_id: String,
) -> Result<UsageSummary, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::get_task_usage_summary(&conn, &task_id).map_err(AppError::from)
}

#[tauri::command]
pub fn clear_workspace_usage(
    state: State<AppState>,
    workspace_id: String,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_workspace_usage(&conn, &workspace_id).map_err(AppError::from)
}
