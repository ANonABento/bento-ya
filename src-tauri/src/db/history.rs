use rusqlite::{params, Connection, Result as SqlResult};

use super::models::SessionSnapshot;
use super::{new_id, now};

/// Inline row mapping for SessionSnapshot (10 fields).
fn map_session_snapshot_row(row: &rusqlite::Row) -> rusqlite::Result<SessionSnapshot> {
    Ok(SessionSnapshot {
        id: row.get(0)?,
        session_id: row.get(1)?,
        workspace_id: row.get(2)?,
        task_id: row.get(3)?,
        snapshot_type: row.get(4)?,
        scrollback_snapshot: row.get(5)?,
        command_history: row.get(6)?,
        files_modified: row.get(7)?,
        duration_ms: row.get(8)?,
        created_at: row.get(9)?,
    })
}

const SESSION_SNAPSHOT_COLUMNS: &str = "id, session_id, workspace_id, task_id, snapshot_type, scrollback_snapshot, command_history, files_modified, duration_ms, created_at";

#[allow(clippy::too_many_arguments)]
pub fn insert_session_snapshot(
    conn: &Connection,
    session_id: &str,
    workspace_id: &str,
    task_id: Option<&str>,
    snapshot_type: &str,
    scrollback_snapshot: Option<&str>,
    command_history: &str,
    files_modified: &str,
    duration_ms: i64,
) -> SqlResult<SessionSnapshot> {
    let id = new_id();
    let ts = now();
    conn.execute(
        &format!(
            "INSERT INTO session_snapshots ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            SESSION_SNAPSHOT_COLUMNS
        ),
        params![
            id,
            session_id,
            workspace_id,
            task_id,
            snapshot_type,
            scrollback_snapshot,
            command_history,
            files_modified,
            duration_ms,
            ts
        ],
    )?;
    get_session_snapshot(conn, &id)
}

pub fn get_session_snapshot(conn: &Connection, id: &str) -> SqlResult<SessionSnapshot> {
    conn.query_row(
        &format!(
            "SELECT {} FROM session_snapshots WHERE id = ?1",
            SESSION_SNAPSHOT_COLUMNS
        ),
        params![id],
        map_session_snapshot_row,
    )
}

pub fn list_session_snapshots(
    conn: &Connection,
    session_id: &str,
) -> SqlResult<Vec<SessionSnapshot>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM session_snapshots WHERE session_id = ?1 ORDER BY created_at DESC",
        SESSION_SNAPSHOT_COLUMNS
    ))?;
    let rows = stmt.query_map(params![session_id], map_session_snapshot_row)?;
    rows.collect()
}

pub fn list_workspace_history(
    conn: &Connection,
    workspace_id: &str,
    limit: Option<i64>,
) -> SqlResult<Vec<SessionSnapshot>> {
    let limit_val = limit.unwrap_or(50);
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM session_snapshots WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2", SESSION_SNAPSHOT_COLUMNS),
    )?;
    let rows = stmt.query_map(params![workspace_id, limit_val], map_session_snapshot_row)?;
    rows.collect()
}

pub fn list_task_history(conn: &Connection, task_id: &str) -> SqlResult<Vec<SessionSnapshot>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM session_snapshots WHERE task_id = ?1 ORDER BY created_at DESC",
        SESSION_SNAPSHOT_COLUMNS
    ))?;
    let rows = stmt.query_map(params![task_id], map_session_snapshot_row)?;
    rows.collect()
}

pub fn delete_session_snapshots(conn: &Connection, session_id: &str) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM session_snapshots WHERE session_id = ?1",
        params![session_id],
    )?;
    Ok(())
}
