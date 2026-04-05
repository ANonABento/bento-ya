use rusqlite::{params, Connection, Result as SqlResult};

use super::models::Column;
use super::{new_id, now};

/// Shared SELECT columns for columns.
const COLUMN_COLUMNS: &str = "id, workspace_id, name, icon, position, color, visible, triggers, created_at, updated_at";

/// Map a database row to a Column struct.
fn map_column_row(row: &rusqlite::Row) -> rusqlite::Result<Column> {
    Ok(Column {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        icon: row.get::<_, Option<String>>(3)?.unwrap_or_else(|| "list".to_string()),
        position: row.get(4)?,
        color: row.get(5)?,
        visible: row.get::<_, i64>(6)? != 0,
        triggers: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub fn insert_column(
    conn: &Connection,
    workspace_id: &str,
    name: &str,
    position: i64,
) -> SqlResult<Column> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO columns (id, workspace_id, name, icon, position, visible, created_at, updated_at) VALUES (?1, ?2, ?3, 'list', ?4, 1, ?5, ?6)",
        params![id, workspace_id, name, position, ts, ts],
    )?;
    get_column(conn, &id)
}

pub fn get_column(conn: &Connection, id: &str) -> SqlResult<Column> {
    conn.query_row(
        &format!("SELECT {} FROM columns WHERE id = ?1", COLUMN_COLUMNS),
        params![id],
        map_column_row,
    )
}

pub fn list_columns(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Column>> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM columns WHERE workspace_id = ?1 ORDER BY position", COLUMN_COLUMNS),
    )?;
    let rows = stmt.query_map(params![workspace_id], map_column_row)?;
    rows.collect()
}

pub fn update_column(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    icon: Option<&str>,
    position: Option<i64>,
    color: Option<Option<&str>>,
    visible: Option<bool>,
    triggers: Option<&str>,
) -> SqlResult<Column> {
    let current = get_column(conn, id)?;
    let ts = now();
    let new_color = match color {
        Some(c) => c.map(|s| s.to_string()),
        None => current.color.clone(),
    };
    let new_triggers = match triggers {
        Some(t) => Some(t.to_string()),
        None => current.triggers.clone(),
    };
    conn.execute(
        "UPDATE columns SET name = ?1, icon = ?2, position = ?3, color = ?4, visible = ?5, triggers = ?6, updated_at = ?7 WHERE id = ?8",
        params![
            name.unwrap_or(&current.name),
            icon.unwrap_or(&current.icon),
            position.unwrap_or(current.position),
            new_color,
            visible.unwrap_or(current.visible) as i64,
            new_triggers,
            ts,
            id,
        ],
    )?;
    get_column(conn, id)
}

pub fn delete_column(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM columns WHERE id = ?1", params![id])?;
    Ok(())
}

/// Get next column in workspace by position
pub fn get_next_column(conn: &Connection, workspace_id: &str, current_position: i64) -> SqlResult<Option<Column>> {
    let result = conn.query_row(
        &format!("SELECT {} FROM columns WHERE workspace_id = ?1 AND position > ?2 ORDER BY position LIMIT 1", COLUMN_COLUMNS),
        params![workspace_id, current_position],
        map_column_row,
    );
    match result {
        Ok(col) => Ok(Some(col)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}
