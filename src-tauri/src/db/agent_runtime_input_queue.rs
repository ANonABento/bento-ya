use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};

use super::models::AgentRuntimeQueuedInput;
use super::{new_id, now};

pub const INPUT_QUEUE_STATUS_PENDING: &str = "pending";
pub const INPUT_QUEUE_STATUS_DELIVERED: &str = "delivered";

fn map_agent_runtime_queued_input_row(
    row: &rusqlite::Row,
) -> rusqlite::Result<AgentRuntimeQueuedInput> {
    Ok(AgentRuntimeQueuedInput {
        id: row.get(0)?,
        task_id: row.get(1)?,
        session_id: row.get(2)?,
        source: row.get(3)?,
        content: row.get(4)?,
        model: row.get(5)?,
        effort_level: row.get(6)?,
        delivery: row.get(7)?,
        status: row.get(8)?,
        sequence: row.get(9)?,
        created_at: row.get(10)?,
        delivered_at: row.get(11)?,
    })
}

const AGENT_RUNTIME_QUEUED_INPUT_COLUMNS: &str = "id, task_id, session_id, source, content, model, effort_level, delivery, status, sequence, created_at, delivered_at";

#[allow(clippy::too_many_arguments)]
pub fn enqueue_agent_runtime_input(
    conn: &Connection,
    task_id: &str,
    session_id: Option<&str>,
    source: &str,
    content: &str,
    model: Option<&str>,
    effort_level: Option<&str>,
    delivery: &str,
) -> SqlResult<AgentRuntimeQueuedInput> {
    let id = new_id();
    let ts = now();
    let tx = conn.unchecked_transaction()?;
    let next_sequence = next_queue_sequence_for_task(&tx, task_id)?;
    tx.execute(
        &format!(
            "INSERT INTO agent_runtime_input_queue ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL)",
            AGENT_RUNTIME_QUEUED_INPUT_COLUMNS
        ),
        params![
            id,
            task_id,
            session_id,
            source,
            content,
            model,
            effort_level,
            delivery,
            INPUT_QUEUE_STATUS_PENDING,
            next_sequence,
            ts,
        ],
    )?;
    tx.commit()?;
    get_agent_runtime_queued_input(conn, &id)
}

fn next_queue_sequence_for_task(conn: &Connection, task_id: &str) -> SqlResult<i64> {
    let current_max = conn
        .query_row(
            "SELECT MAX(sequence) FROM agent_runtime_input_queue WHERE task_id = ?1",
            params![task_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()?
        .flatten()
        .unwrap_or(0);
    Ok(current_max + 1)
}

pub fn get_agent_runtime_queued_input(
    conn: &Connection,
    id: &str,
) -> SqlResult<AgentRuntimeQueuedInput> {
    conn.query_row(
        &format!(
            "SELECT {} FROM agent_runtime_input_queue WHERE id = ?1",
            AGENT_RUNTIME_QUEUED_INPUT_COLUMNS
        ),
        params![id],
        map_agent_runtime_queued_input_row,
    )
}

pub fn list_pending_agent_runtime_inputs(
    conn: &Connection,
    task_id: &str,
) -> SqlResult<Vec<AgentRuntimeQueuedInput>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM agent_runtime_input_queue WHERE task_id = ?1 AND status = ?2 ORDER BY sequence ASC, created_at ASC",
        AGENT_RUNTIME_QUEUED_INPUT_COLUMNS
    ))?;
    let rows = stmt.query_map(
        params![task_id, INPUT_QUEUE_STATUS_PENDING],
        map_agent_runtime_queued_input_row,
    )?;
    rows.collect()
}

pub fn mark_agent_runtime_inputs_delivered(
    conn: &Connection,
    input_ids: &[String],
) -> SqlResult<usize> {
    if input_ids.is_empty() {
        return Ok(0);
    }

    let ts = now();
    let tx = conn.unchecked_transaction()?;
    let mut updated = 0;
    for id in input_ids {
        updated += tx.execute(
            "UPDATE agent_runtime_input_queue SET status = ?1, delivered_at = ?2 WHERE id = ?3 AND status = ?4",
            params![INPUT_QUEUE_STATUS_DELIVERED, ts, id, INPUT_QUEUE_STATUS_PENDING],
        )?;
    }
    tx.commit()?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn enqueue_list_and_mark_runtime_inputs() {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "WS", "/tmp").unwrap();
        let column = db::insert_column(&conn, &workspace.id, "Todo", 0).unwrap();
        let task = db::insert_task(&conn, &workspace.id, &column.id, "Task", None).unwrap();
        let session = db::insert_agent_session(&conn, &task.id, "claude", Some("/tmp")).unwrap();

        let first = enqueue_agent_runtime_input(
            &conn,
            &task.id,
            Some(&session.id),
            "user_chat",
            "first",
            Some("sonnet"),
            Some("medium"),
            "queued",
        )
        .unwrap();
        let second = enqueue_agent_runtime_input(
            &conn,
            &task.id,
            Some(&session.id),
            "user_chat",
            "second",
            None,
            None,
            "queued",
        )
        .unwrap();

        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);

        let pending = list_pending_agent_runtime_inputs(&conn, &task.id).unwrap();
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].content, "first");
        assert_eq!(pending[1].content, "second");

        let updated =
            mark_agent_runtime_inputs_delivered(&conn, &[first.id.clone(), second.id.clone()])
                .unwrap();
        assert_eq!(updated, 2);
        assert!(list_pending_agent_runtime_inputs(&conn, &task.id)
            .unwrap()
            .is_empty());

        let delivered = get_agent_runtime_queued_input(&conn, &first.id).unwrap();
        assert_eq!(delivered.status, INPUT_QUEUE_STATUS_DELIVERED);
        assert!(delivered.delivered_at.is_some());
    }
}
