use tauri::State;
use crate::db::{
    self, AppState, SessionSnapshot,
};
use crate::error::AppError;

#[tauri::command]
pub fn create_snapshot(
    state: State<AppState>,
    session_id: String,
    workspace_id: String,
    task_id: Option<String>,
    snapshot_type: String,
    scrollback_snapshot: Option<String>,
    command_history: String,
    files_modified: String,
    duration_ms: i64,
) -> Result<SessionSnapshot, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::insert_session_snapshot(
        &conn,
        &session_id,
        &workspace_id,
        task_id.as_deref(),
        &snapshot_type,
        scrollback_snapshot.as_deref(),
        &command_history,
        &files_modified,
        duration_ms,
    )
    .map_err(AppError::from)
}

#[tauri::command]
pub fn get_snapshot(
    state: State<AppState>,
    id: String,
) -> Result<SessionSnapshot, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::get_session_snapshot(&conn, &id).map_err(AppError::from)
}

#[tauri::command]
pub fn get_session_history(
    state: State<AppState>,
    session_id: String,
) -> Result<Vec<SessionSnapshot>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::list_session_snapshots(&conn, &session_id).map_err(AppError::from)
}

#[tauri::command]
pub fn get_workspace_history(
    state: State<AppState>,
    workspace_id: String,
    limit: Option<i64>,
) -> Result<Vec<SessionSnapshot>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::list_workspace_history(&conn, &workspace_id, limit).map_err(AppError::from)
}

#[tauri::command]
pub fn get_task_history(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<SessionSnapshot>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::list_task_history(&conn, &task_id).map_err(AppError::from)
}

#[tauri::command]
pub fn clear_session_history(
    state: State<AppState>,
    session_id: String,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_session_snapshots(&conn, &session_id).map_err(AppError::from)
}
