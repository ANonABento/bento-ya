use rusqlite::{params, Connection, Result as SqlResult};

use super::models::ChatSession;
use super::{new_id, now};

/// Inline row mapping for ChatSession (6 fields).
fn map_chat_session_row(row: &rusqlite::Row) -> rusqlite::Result<ChatSession> {
    Ok(ChatSession {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        title: row.get(2)?,
        cli_session_id: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

const CHAT_SESSION_COLUMNS: &str = "id, workspace_id, title, cli_session_id, created_at, updated_at";

pub fn create_chat_session(conn: &Connection, workspace_id: &str, title: &str) -> SqlResult<ChatSession> {
    let id = new_id();
    let ts = now();
    conn.execute(
        &format!("INSERT INTO chat_sessions ({}) VALUES (?1, ?2, ?3, ?4, ?5)", "id, workspace_id, title, created_at, updated_at"),
        params![id, workspace_id, title, ts, ts],
    )?;
    get_chat_session(conn, &id)
}

pub fn get_chat_session(conn: &Connection, id: &str) -> SqlResult<ChatSession> {
    conn.query_row(
        &format!("SELECT {} FROM chat_sessions WHERE id = ?1", CHAT_SESSION_COLUMNS),
        params![id],
        map_chat_session_row,
    )
}

pub fn list_chat_sessions(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<ChatSession>> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM chat_sessions WHERE workspace_id = ?1 ORDER BY updated_at DESC", CHAT_SESSION_COLUMNS),
    )?;
    let rows = stmt.query_map(params![workspace_id], map_chat_session_row)?;
    rows.collect()
}

pub fn update_chat_session(conn: &Connection, id: &str, title: Option<&str>) -> SqlResult<ChatSession> {
    let ts = now();
    if let Some(t) = title {
        conn.execute(
            "UPDATE chat_sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![t, ts, id],
        )?;
    } else {
        conn.execute(
            "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
            params![ts, id],
        )?;
    }
    get_chat_session(conn, id)
}

pub fn delete_chat_session(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM chat_sessions WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_or_create_active_session(conn: &Connection, workspace_id: &str) -> SqlResult<ChatSession> {
    // Get most recent session or create new one
    let existing = conn.query_row(
        &format!("SELECT {} FROM chat_sessions WHERE workspace_id = ?1 ORDER BY updated_at DESC LIMIT 1", CHAT_SESSION_COLUMNS),
        params![workspace_id],
        map_chat_session_row,
    );

    match existing {
        Ok(session) => Ok(session),
        Err(_) => create_chat_session(conn, workspace_id, "New Chat"),
    }
}

/// Update the CLI session ID for a chat session (used for --resume fallback)
pub fn update_chat_session_cli_id(conn: &Connection, id: &str, cli_session_id: Option<&str>) -> SqlResult<()> {
    let ts = now();
    conn.execute(
        "UPDATE chat_sessions SET cli_session_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![cli_session_id, ts, id],
    )?;
    Ok(())
}
