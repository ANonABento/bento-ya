use rusqlite::{params, Connection, Result as SqlResult};

use super::models::AgentMessage;
use super::{new_id, now};

/// Inline row mapping for AgentMessage (9 fields).
fn map_agent_message_row(row: &rusqlite::Row) -> rusqlite::Result<AgentMessage> {
    Ok(AgentMessage {
        id: row.get(0)?,
        task_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        model: row.get(4)?,
        effort_level: row.get(5)?,
        tool_calls: row.get(6)?,
        thinking_content: row.get(7)?,
        created_at: row.get(8)?,
    })
}

const AGENT_MESSAGE_COLUMNS: &str = "id, task_id, role, content, model, effort_level, tool_calls, thinking_content, created_at";

pub fn insert_agent_message(
    conn: &Connection,
    task_id: &str,
    role: &str,
    content: &str,
    model: Option<&str>,
    effort_level: Option<&str>,
    tool_calls: Option<&str>,
    thinking_content: Option<&str>,
) -> SqlResult<AgentMessage> {
    let id = new_id();
    let ts = now();
    conn.execute(
        &format!("INSERT INTO agent_messages ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)", AGENT_MESSAGE_COLUMNS),
        params![id, task_id, role, content, model, effort_level, tool_calls, thinking_content, ts],
    )?;
    get_agent_message(conn, &id)
}

pub fn get_agent_message(conn: &Connection, id: &str) -> SqlResult<AgentMessage> {
    conn.query_row(
        &format!("SELECT {} FROM agent_messages WHERE id = ?1", AGENT_MESSAGE_COLUMNS),
        params![id],
        map_agent_message_row,
    )
}

pub fn list_agent_messages(conn: &Connection, task_id: &str) -> SqlResult<Vec<AgentMessage>> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM agent_messages WHERE task_id = ?1 ORDER BY created_at ASC", AGENT_MESSAGE_COLUMNS),
    )?;
    let rows = stmt.query_map(params![task_id], map_agent_message_row)?;
    rows.collect()
}

pub fn clear_agent_messages(conn: &Connection, task_id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM agent_messages WHERE task_id = ?1", params![task_id])?;
    Ok(())
}
