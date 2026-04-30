use crate::db::{self, AppState, UsageByModelDailySummary, UsageRecord, UsageSummary};
use crate::error::AppError;
use tauri::State;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
    column_name: Option<String>,
    duration_seconds: Option<i64>,
) -> Result<UsageRecord, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
        column_name.as_deref(),
        duration_seconds.unwrap_or(0),
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn get_workspace_usage(
    state: State<AppState>,
    workspace_id: String,
    limit: Option<i64>,
) -> Result<Vec<UsageRecord>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::list_usage_records(&conn, &workspace_id, limit).map_err(AppError::from)
}

#[tauri::command]
pub fn get_task_usage(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<UsageRecord>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::list_task_usage(&conn, &task_id).map_err(AppError::from)
}

#[tauri::command]
pub fn get_workspace_usage_summary(
    state: State<AppState>,
    workspace_id: String,
) -> Result<UsageSummary, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::get_workspace_usage_summary(&conn, &workspace_id).map_err(AppError::from)
}

#[tauri::command]
pub fn get_workspace_usage_by_model_for_date(
    state: State<AppState>,
    workspace_id: String,
    date: String,
) -> Result<Vec<UsageByModelDailySummary>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::get_workspace_usage_by_model_for_date(&conn, &workspace_id, &date)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn get_task_usage_summary(
    state: State<AppState>,
    task_id: String,
) -> Result<UsageSummary, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::get_task_usage_summary(&conn, &task_id).map_err(AppError::from)
}

#[tauri::command]
pub fn clear_workspace_usage(state: State<AppState>, workspace_id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_workspace_usage(&conn, &workspace_id).map_err(AppError::from)
}
