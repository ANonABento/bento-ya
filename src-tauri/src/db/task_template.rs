use rusqlite::{params, Connection, Result as SqlResult};

use super::models::TaskTemplate;
use super::now;

const TASK_TEMPLATE_COLUMNS: &str = "id, workspace_id, title, description, labels, model, created_at, updated_at";

fn map_task_template_row(row: &rusqlite::Row) -> rusqlite::Result<TaskTemplate> {
    Ok(TaskTemplate {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        labels: row.get(4)?,
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
    let id = super::new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO task_templates (id, workspace_id, title, description, labels, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, workspace_id, title, description, labels, model, ts, ts],
    )?;
    get_task_template(conn, &id)
}

pub fn get_task_template(conn: &Connection, id: &str) -> SqlResult<TaskTemplate> {
    conn.query_row(
        &format!("SELECT {} FROM task_templates WHERE id = ?1", TASK_TEMPLATE_COLUMNS),
        params![id],
        map_task_template_row,
    )
}

pub fn list_task_templates(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<TaskTemplate>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM task_templates WHERE workspace_id = ?1 ORDER BY updated_at DESC",
        TASK_TEMPLATE_COLUMNS,
    ))?;
    let rows = stmt.query_map(params![workspace_id], map_task_template_row)?;
    rows.collect()
}

pub fn update_task_template(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    description: Option<Option<&str>>,
    labels: Option<&str>,
    model: Option<Option<&str>>,
) -> SqlResult<TaskTemplate> {
    let current = get_task_template(conn, id)?;

    let next_title = title.unwrap_or(&current.title);
    let next_description = match description {
        Some(Some(text)) => Some(text.to_string()),
        Some(None) => None,
        None => current.description.clone(),
    };
    let next_labels = labels.unwrap_or(&current.labels);
    let next_model = match model {
        Some(Some(value)) => Some(value.to_string()),
        Some(None) => None,
        None => current.model,
    };
    let ts = now();

    conn.execute(
        "UPDATE task_templates SET title = ?1, description = ?2, labels = ?3, model = ?4, updated_at = ?5 WHERE id = ?6",
        params![next_title, next_description, next_labels, next_model, ts, id],
    )?;
    get_task_template(conn, id)
}

pub fn delete_task_template(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM task_templates WHERE id = ?1", params![id])?;
    Ok(())
}
