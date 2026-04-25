use crate::db::{self, AppState, SessionSnapshot};
use crate::error::AppError;
use tauri::{Emitter, State};

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
pub fn get_snapshot(state: State<AppState>, id: String) -> Result<SessionSnapshot, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::get_session_snapshot(&conn, &id).map_err(AppError::from)
}

#[tauri::command]
pub fn get_session_history(
    state: State<AppState>,
    session_id: String,
) -> Result<Vec<SessionSnapshot>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::list_session_snapshots(&conn, &session_id).map_err(AppError::from)
}

#[tauri::command]
pub fn get_workspace_history(
    state: State<AppState>,
    workspace_id: String,
    limit: Option<i64>,
) -> Result<Vec<SessionSnapshot>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::list_workspace_history(&conn, &workspace_id, limit).map_err(AppError::from)
}

#[tauri::command]
pub fn get_task_history(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<SessionSnapshot>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::list_task_history(&conn, &task_id).map_err(AppError::from)
}

#[tauri::command]
pub fn clear_session_history(state: State<AppState>, session_id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_session_snapshots(&conn, &session_id).map_err(AppError::from)
}

/// Restore result with both snapshot and updated session
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub snapshot: SessionSnapshot,
    pub backup_id: String,
    pub session_updated: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreEventPayload {
    snapshot_id: String,
    session_id: String,
    task_id: Option<String>,
    session_updated: bool,
}

/// Restore a snapshot - creates a backup first, restores scrollback to session, returns result
#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub fn restore_snapshot(
    state: State<AppState>,
    app: tauri::AppHandle,
    snapshot_id: String,
    current_session_id: String,
    current_workspace_id: String,
    current_task_id: Option<String>,
    current_scrollback: Option<String>,
    current_command_history: String,
    current_files_modified: String,
    current_duration_ms: i64,
) -> Result<RestoreResult, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // First, create a backup snapshot of current state
    let backup = db::insert_session_snapshot(
        &conn,
        &current_session_id,
        &current_workspace_id,
        current_task_id.as_deref(),
        "backup",
        current_scrollback.as_deref(),
        &current_command_history,
        &current_files_modified,
        current_duration_ms,
    )
    .map_err(AppError::from)?;

    // Emit event with backup ID so frontend can notify user
    let _ = app.emit("history:backup-created", &backup.id);

    // Get the snapshot to restore
    let snapshot = db::get_session_snapshot(&conn, &snapshot_id).map_err(AppError::from)?;

    // Try to restore scrollback to the original session if it exists
    let session_updated = if let Ok(session) = db::get_agent_session(&conn, &snapshot.session_id) {
        // Update the session with restored scrollback and make it resumable
        let _ = db::update_agent_session(
            &conn,
            &session.id,
            None,                                          // pid
            Some("idle"),                                  // status
            None,                                          // exit_code
            None,                                          // last_output
            Some(snapshot.scrollback_snapshot.as_deref()), // scrollback
            Some(true),                                    // resumable
        );
        true
    } else if let Some(ref task_id) = snapshot.task_id {
        // Original session gone, try to create/update session for the task
        if let Ok(session) =
            db::get_or_create_agent_session_for_task(&conn, task_id, "claude", None)
        {
            let _ = db::update_agent_session(
                &conn,
                &session.id,
                None,
                Some("idle"),
                None,
                None,
                Some(snapshot.scrollback_snapshot.as_deref()),
                Some(true),
            );
            true
        } else {
            false
        }
    } else {
        false
    };

    // Emit restore complete event
    let _ = app.emit(
        "history:restored",
        RestoreEventPayload {
            snapshot_id: snapshot.id.clone(),
            session_id: snapshot.session_id.clone(),
            task_id: snapshot.task_id.clone(),
            session_updated,
        },
    );

    Ok(RestoreResult {
        snapshot,
        backup_id: backup.id,
        session_updated,
    })
}
