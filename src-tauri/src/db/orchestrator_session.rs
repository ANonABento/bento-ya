use rusqlite::{params, Connection, Result as SqlResult};

use super::models::OrchestratorSession;
use super::{new_id, now};

/// Inline row mapping for OrchestratorSession (6 fields).
fn map_orchestrator_session_row(row: &rusqlite::Row) -> rusqlite::Result<OrchestratorSession> {
    Ok(OrchestratorSession {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        status: row.get(2)?,
        last_error: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

const ORCHESTRATOR_SESSION_COLUMNS: &str = "id, workspace_id, status, last_error, created_at, updated_at";

pub fn get_or_create_orchestrator_session(conn: &Connection, workspace_id: &str) -> SqlResult<OrchestratorSession> {
    // Try to get existing session
    let existing = conn.query_row(
        &format!("SELECT {} FROM orchestrator_sessions WHERE workspace_id = ?1", ORCHESTRATOR_SESSION_COLUMNS),
        params![workspace_id],
        map_orchestrator_session_row,
    );

    match existing {
        Ok(session) => Ok(session),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // Create new session
            let id = new_id();
            let ts = now();
            conn.execute(
                "INSERT INTO orchestrator_sessions (id, workspace_id, status, created_at, updated_at) VALUES (?1, ?2, 'idle', ?3, ?4)",
                params![id, workspace_id, ts, ts],
            )?;
            get_orchestrator_session(conn, &id)
        }
        Err(e) => Err(e),
    }
}

pub fn get_orchestrator_session(conn: &Connection, id: &str) -> SqlResult<OrchestratorSession> {
    conn.query_row(
        &format!("SELECT {} FROM orchestrator_sessions WHERE id = ?1", ORCHESTRATOR_SESSION_COLUMNS),
        params![id],
        map_orchestrator_session_row,
    )
}

pub fn update_orchestrator_session(
    conn: &Connection,
    id: &str,
    status: Option<&str>,
    last_error: Option<Option<&str>>,
) -> SqlResult<OrchestratorSession> {
    let current = get_orchestrator_session(conn, id)?;
    let ts = now();
    let new_error = match last_error {
        Some(e) => e.map(|s| s.to_string()),
        None => current.last_error.clone(),
    };
    conn.execute(
        "UPDATE orchestrator_sessions SET status = ?1, last_error = ?2, updated_at = ?3 WHERE id = ?4",
        params![
            status.unwrap_or(&current.status),
            new_error,
            ts,
            id,
        ],
    )?;
    get_orchestrator_session(conn, id)
}
