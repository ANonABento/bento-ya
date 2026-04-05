use rusqlite::{params, Connection, Result as SqlResult};

use super::chat_session::update_chat_session;
use super::models::ChatMessage;
use super::{new_id, now};

/// Inline row mapping for ChatMessage (6 fields).
fn map_chat_message_row(row: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        session_id: row.get(2)?,
        role: row.get(3)?,
        content: row.get(4)?,
        created_at: row.get(5)?,
    })
}

const CHAT_MESSAGE_COLUMNS: &str = "id, workspace_id, session_id, role, content, created_at";

pub fn insert_chat_message(
    conn: &Connection,
    workspace_id: &str,
    session_id: &str,
    role: &str,
    content: &str,
) -> SqlResult<ChatMessage> {
    let id = new_id();
    let ts = now();
    conn.execute(
        &format!("INSERT INTO chat_messages ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", CHAT_MESSAGE_COLUMNS),
        params![id, workspace_id, session_id, role, content, ts],
    )?;
    // Update session's updated_at
    let _ = update_chat_session(conn, session_id, None);
    get_chat_message(conn, &id)
}

pub fn get_chat_message(conn: &Connection, id: &str) -> SqlResult<ChatMessage> {
    conn.query_row(
        &format!("SELECT {} FROM chat_messages WHERE id = ?1", CHAT_MESSAGE_COLUMNS),
        params![id],
        map_chat_message_row,
    )
}

pub fn list_chat_messages(conn: &Connection, session_id: &str, limit: Option<i64>) -> SqlResult<Vec<ChatMessage>> {
    let limit_val = limit.unwrap_or(100);
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM chat_messages WHERE session_id = ?1 ORDER BY created_at DESC LIMIT ?2", CHAT_MESSAGE_COLUMNS),
    )?;
    let rows = stmt.query_map(params![session_id, limit_val], map_chat_message_row)?;
    let mut messages: Vec<ChatMessage> = rows.collect::<SqlResult<Vec<_>>>()?;
    // Reverse to get chronological order
    messages.reverse();
    Ok(messages)
}

pub fn delete_chat_messages(conn: &Connection, session_id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM chat_messages WHERE session_id = ?1", params![session_id])?;
    Ok(())
}
