use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Result as SqlResult};
use std::collections::BTreeSet;

use super::models::Label;
use super::{new_id, now};

const LABEL_COLUMNS: &str = "id, workspace_id, name, color, created_at, updated_at";

fn map_label_row_at(row: &rusqlite::Row, offset: usize) -> rusqlite::Result<Label> {
    Ok(Label {
        id: row.get(offset)?,
        workspace_id: row.get(offset + 1)?,
        name: row.get(offset + 2)?,
        color: row.get(offset + 3)?,
        created_at: row.get(offset + 4)?,
        updated_at: row.get(offset + 5)?,
    })
}

fn map_label_row(row: &rusqlite::Row) -> rusqlite::Result<Label> {
    map_label_row_at(row, 0)
}

pub fn insert_label(
    conn: &Connection,
    workspace_id: &str,
    name: &str,
    color: &str,
) -> SqlResult<Label> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO labels (id, workspace_id, name, color, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, workspace_id, name, color, ts, ts],
    )?;
    get_label(conn, &id)
}

pub fn get_label(conn: &Connection, id: &str) -> SqlResult<Label> {
    conn.query_row(
        &format!("SELECT {LABEL_COLUMNS} FROM labels WHERE id = ?1"),
        params![id],
        map_label_row,
    )
}

pub fn list_labels(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Label>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {LABEL_COLUMNS} FROM labels WHERE workspace_id = ?1 ORDER BY name COLLATE NOCASE ASC",
    ))?;
    let rows = stmt.query_map(params![workspace_id], map_label_row)?;
    rows.collect()
}

pub fn list_task_labels(conn: &Connection, task_id: &str) -> SqlResult<Vec<Label>> {
    let mut stmt = conn.prepare(
        "SELECT l.id, l.workspace_id, l.name, l.color, l.created_at, l.updated_at
         FROM labels l
         JOIN task_labels tl ON tl.label_id = l.id
         WHERE tl.task_id = ?1
         ORDER BY l.name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map(params![task_id], map_label_row)?;
    rows.collect()
}

pub fn list_labels_for_tasks(
    conn: &Connection,
    task_ids: &[String],
) -> SqlResult<Vec<(String, Label)>> {
    if task_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = vec!["?"; task_ids.len()].join(", ");
    let sql = format!(
        "SELECT tl.task_id, l.id, l.workspace_id, l.name, l.color, l.created_at, l.updated_at
         FROM task_labels tl
         JOIN labels l ON l.id = tl.label_id
         WHERE tl.task_id IN ({placeholders})
         ORDER BY tl.task_id ASC, l.name COLLATE NOCASE ASC",
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(task_ids), |row| {
        Ok((row.get::<_, String>(0)?, map_label_row_at(row, 1)?))
    })?;
    rows.collect()
}

pub fn update_label(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
) -> SqlResult<Label> {
    let current = get_label(conn, id)?;
    let ts = now();
    conn.execute(
        "UPDATE labels SET name = ?1, color = ?2, updated_at = ?3 WHERE id = ?4",
        params![
            name.unwrap_or(&current.name),
            color.unwrap_or(&current.color),
            ts,
            id,
        ],
    )?;
    get_label(conn, id)
}

pub fn delete_label(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM labels WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_task_labels(conn: &Connection, task_id: &str, label_ids: &[String]) -> SqlResult<()> {
    let workspace_id: String = conn.query_row(
        "SELECT workspace_id FROM tasks WHERE id = ?1",
        params![task_id],
        |row| row.get(0),
    )?;

    let unique_label_ids: Vec<&String> = label_ids
        .iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    for label_id in &unique_label_ids {
        let exists = conn
            .query_row(
                "SELECT 1 FROM labels WHERE id = ?1 AND workspace_id = ?2",
                params![label_id, workspace_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM task_labels WHERE task_id = ?1",
        params![task_id],
    )?;
    let ts = now();
    for label_id in unique_label_ids {
        tx.execute(
            "INSERT INTO task_labels (task_id, label_id, created_at) VALUES (?1, ?2, ?3)",
            params![task_id, label_id, ts],
        )?;
    }
    tx.commit()?;
    Ok(())
}
