use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};

use super::models::AgentTranscriptEvent;
use super::{new_id, now};

pub const EVENT_SESSION_STARTED: &str = "session_started";
pub const EVENT_USER_INPUT: &str = "user_input";
pub const EVENT_AGENT_STARTED: &str = "agent_started";
pub const EVENT_AGENT_TEXT_DELTA: &str = "agent_text_delta";
pub const EVENT_AGENT_THINKING_DELTA: &str = "agent_thinking_delta";
pub const EVENT_TOOL_STARTED: &str = "tool_started";
pub const EVENT_TOOL_OUTPUT: &str = "tool_output";
pub const EVENT_TOOL_COMPLETED: &str = "tool_completed";
pub const EVENT_COMMAND_STARTED: &str = "command_started";
pub const EVENT_COMMAND_OUTPUT: &str = "command_output";
pub const EVENT_COMMAND_COMPLETED: &str = "command_completed";
pub const EVENT_AGENT_COMPLETED: &str = "agent_completed";
pub const EVENT_AGENT_FAILED: &str = "agent_failed";
pub const EVENT_AGENT_CANCELLED: &str = "agent_cancelled";

fn map_agent_transcript_event_row(row: &rusqlite::Row) -> rusqlite::Result<AgentTranscriptEvent> {
    Ok(AgentTranscriptEvent {
        id: row.get(0)?,
        task_id: row.get(1)?,
        session_id: row.get(2)?,
        event_type: row.get(3)?,
        content: row.get(4)?,
        metadata_json: row.get(5)?,
        sequence: row.get(6)?,
        created_at: row.get(7)?,
    })
}

const AGENT_TRANSCRIPT_EVENT_COLUMNS: &str =
    "id, task_id, session_id, event_type, content, metadata_json, sequence, created_at";

pub fn insert_agent_transcript_event(
    conn: &Connection,
    task_id: &str,
    session_id: Option<&str>,
    event_type: &str,
    content: Option<&str>,
    metadata_json: Option<&str>,
) -> SqlResult<AgentTranscriptEvent> {
    let id = new_id();
    let ts = now();
    let tx = conn.unchecked_transaction()?;
    let next_sequence = next_sequence_for_task(&tx, task_id)?;
    tx.execute(
        &format!(
            "INSERT INTO agent_transcript_events ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            AGENT_TRANSCRIPT_EVENT_COLUMNS
        ),
        params![
            id,
            task_id,
            session_id,
            event_type,
            content,
            metadata_json,
            next_sequence,
            ts
        ],
    )?;
    tx.commit()?;
    get_agent_transcript_event(conn, &id)
}

fn next_sequence_for_task(conn: &Connection, task_id: &str) -> SqlResult<i64> {
    let current_max = conn
        .query_row(
            "SELECT MAX(sequence) FROM agent_transcript_events WHERE task_id = ?1",
            params![task_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()?
        .flatten()
        .unwrap_or(0);
    Ok(current_max + 1)
}

pub fn get_agent_transcript_event(conn: &Connection, id: &str) -> SqlResult<AgentTranscriptEvent> {
    conn.query_row(
        &format!(
            "SELECT {} FROM agent_transcript_events WHERE id = ?1",
            AGENT_TRANSCRIPT_EVENT_COLUMNS
        ),
        params![id],
        map_agent_transcript_event_row,
    )
}

pub fn list_agent_transcript_events(
    conn: &Connection,
    task_id: &str,
) -> SqlResult<Vec<AgentTranscriptEvent>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM agent_transcript_events WHERE task_id = ?1 ORDER BY sequence ASC, created_at ASC",
        AGENT_TRANSCRIPT_EVENT_COLUMNS
    ))?;
    let rows = stmt.query_map(params![task_id], map_agent_transcript_event_row)?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn insert_and_list_transcript_events_in_sequence() {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "WS", "/tmp").unwrap();
        let column = db::insert_column(&conn, &workspace.id, "Todo", 0).unwrap();
        let task = db::insert_task(&conn, &workspace.id, &column.id, "Task", None).unwrap();
        let session = db::insert_agent_session(&conn, &task.id, "claude", Some("/tmp")).unwrap();

        let first = insert_agent_transcript_event(
            &conn,
            &task.id,
            Some(&session.id),
            EVENT_SESSION_STARTED,
            None,
            Some(r#"{"cli":"claude"}"#),
        )
        .unwrap();
        let second = insert_agent_transcript_event(
            &conn,
            &task.id,
            Some(&session.id),
            EVENT_USER_INPUT,
            Some("hello"),
            None,
        )
        .unwrap();

        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);

        let events = list_agent_transcript_events(&conn, &task.id).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_type, EVENT_SESSION_STARTED);
        assert_eq!(events[1].content.as_deref(), Some("hello"));
        assert_eq!(events[1].session_id.as_deref(), Some(session.id.as_str()));
    }

    #[test]
    fn old_tasks_without_transcript_events_list_safely() {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "WS", "/tmp").unwrap();
        let column = db::insert_column(&conn, &workspace.id, "Todo", 0).unwrap();
        let task = db::insert_task(&conn, &workspace.id, &column.id, "Task", None).unwrap();

        let events = list_agent_transcript_events(&conn, &task.id).unwrap();
        assert!(events.is_empty());
    }
}
