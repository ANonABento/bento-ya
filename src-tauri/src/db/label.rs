use rusqlite::{params, Connection, Result as SqlResult};
use std::collections::BTreeSet;

use super::models::{Label, TaskLabelAssignment};
use super::{new_id, now};

fn map_label_row(row: &rusqlite::Row) -> rusqlite::Result<Label> {
    Ok(Label {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        color: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub fn create_label(
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
        "SELECT id, workspace_id, name, color, created_at, updated_at FROM labels WHERE id = ?1",
        params![id],
        map_label_row,
    )
}

pub fn list_labels(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Label>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, name, color, created_at, updated_at FROM labels WHERE workspace_id = ?1 ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![workspace_id], map_label_row)?;
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

pub fn list_task_label_assignments(
    conn: &Connection,
    workspace_id: &str,
) -> SqlResult<Vec<TaskLabelAssignment>> {
    let mut stmt = conn.prepare(
        "SELECT tl.task_id, tl.label_id FROM task_labels tl INNER JOIN tasks t ON t.id = tl.task_id WHERE t.workspace_id = ?1 ORDER BY tl.task_id, tl.label_id",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
        Ok(TaskLabelAssignment {
            task_id: row.get(0)?,
            label_id: row.get(1)?,
        })
    })?;
    rows.collect()
}

pub fn list_label_ids_for_task(conn: &Connection, task_id: &str) -> SqlResult<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT label_id FROM task_labels WHERE task_id = ?1 ORDER BY label_id")?;
    let rows = stmt.query_map(params![task_id], |row| row.get(0))?;
    rows.collect()
}

pub fn set_task_labels(
    conn: &Connection,
    task_id: &str,
    label_ids: &[String],
) -> SqlResult<Vec<String>> {
    let workspace_id: String = conn.query_row(
        "SELECT workspace_id FROM tasks WHERE id = ?1",
        params![task_id],
        |row| row.get(0),
    )?;
    let mut unique_label_ids: Vec<String> = Vec::new();
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    for label_id in label_ids {
        if seen.insert(label_id.as_str()) {
            unique_label_ids.push(label_id.clone());
        }
    }

    for label_id in &unique_label_ids {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM labels WHERE id = ?1 AND workspace_id = ?2",
            params![label_id, workspace_id],
            |row| row.get(0),
        )?;
        if count == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
    }

    let ts = now();
    conn.execute(
        "DELETE FROM task_labels WHERE task_id = ?1",
        params![task_id],
    )?;
    for label_id in &unique_label_ids {
        conn.execute(
            "INSERT OR IGNORE INTO task_labels (task_id, label_id, created_at) VALUES (?1, ?2, ?3)",
            params![task_id, label_id, ts],
        )?;
    }
    Ok(unique_label_ids)
}
