use rusqlite::{params, Connection, Result as SqlResult};

use super::models::{Task, TaskTemplate};
use super::{new_id, now};

const TASK_TEMPLATE_COLUMNS: &str =
    "id, workspace_id, title, description, labels, model, created_at, updated_at";

fn map_task_template_row(row: &rusqlite::Row) -> rusqlite::Result<TaskTemplate> {
    Ok(TaskTemplate {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        labels: row
            .get::<_, Option<String>>(4)?
            .unwrap_or_else(|| "[]".to_string()),
        model: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn insert_task_template(
    conn: &Connection,
    workspace_id: &str,
    title: &str,
    description: Option<&str>,
    labels: &str,
    model: Option<&str>,
) -> SqlResult<TaskTemplate> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO task_templates (id, workspace_id, title, description, labels, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, workspace_id, title, description, labels, model, ts, ts],
    )?;
    get_task_template(conn, &id)
}

pub fn insert_task_template_from_task(conn: &Connection, task: &Task) -> SqlResult<TaskTemplate> {
    insert_task_template(
        conn,
        &task.workspace_id,
        &task.title,
        task.description.as_deref(),
        &task.pr_labels,
        task.model.as_deref(),
    )
}

pub fn get_task_template(conn: &Connection, id: &str) -> SqlResult<TaskTemplate> {
    conn.query_row(
        &format!(
            "SELECT {} FROM task_templates WHERE id = ?1",
            TASK_TEMPLATE_COLUMNS
        ),
        params![id],
        map_task_template_row,
    )
}

pub fn list_task_templates(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<TaskTemplate>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM task_templates WHERE workspace_id = ?1 ORDER BY updated_at DESC, title",
        TASK_TEMPLATE_COLUMNS
    ))?;
    let rows = stmt.query_map(params![workspace_id], map_task_template_row)?;
    rows.collect()
}

pub fn update_task_template(
    conn: &Connection,
    id: &str,
    title: &str,
    description: Option<&str>,
    labels: &str,
    model: Option<&str>,
) -> SqlResult<TaskTemplate> {
    let ts = now();
    conn.execute(
        "UPDATE task_templates SET title = ?1, description = ?2, labels = ?3, model = ?4, updated_at = ?5 WHERE id = ?6",
        params![title, description, labels, model, ts, id],
    )?;
    get_task_template(conn, id)
}

pub fn delete_task_template(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM task_templates WHERE id = ?1", params![id])?;
    Ok(())
}
