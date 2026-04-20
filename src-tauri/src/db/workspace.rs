use rusqlite::{params, Connection, Result as SqlResult};

use super::models::Workspace;
use super::{new_id, now};

/// Shared SELECT columns for workspaces.
const WORKSPACE_COLUMNS: &str = "id, name, repo_path, tab_order, is_active, COALESCE((SELECT COUNT(*) FROM tasks WHERE workspace_id = workspaces.id AND column_id != (SELECT id FROM columns WHERE workspace_id = workspaces.id ORDER BY position DESC LIMIT 1)), 0) AS active_task_count, config, created_at, updated_at, discord_guild_id, discord_category_id, discord_chef_channel_id, discord_notifications_channel_id, discord_enabled";

/// Map a database row to a Workspace struct.
fn map_workspace_row(row: &rusqlite::Row) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get(0)?,
        name: row.get(1)?,
        repo_path: row.get(2)?,
        tab_order: row.get(3)?,
        is_active: row.get::<_, i64>(4)? != 0,
        active_task_count: row.get(5)?,
        config: row
            .get::<_, Option<String>>(6)?
            .unwrap_or_else(|| "{}".to_string()),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        discord_guild_id: row.get(9)?,
        discord_category_id: row.get(10)?,
        discord_chef_channel_id: row.get(11)?,
        discord_notifications_channel_id: row.get(12)?,
        discord_enabled: row.get(13)?,
    })
}

pub fn insert_workspace(conn: &Connection, name: &str, repo_path: &str) -> SqlResult<Workspace> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO workspaces (id, name, repo_path, tab_order, is_active, config, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, '{}', ?4, ?5)",
        params![id, name, repo_path, ts, ts],
    )?;
    get_workspace(conn, &id)
}

pub fn get_workspace(conn: &Connection, id: &str) -> SqlResult<Workspace> {
    conn.query_row(
        &format!("SELECT {} FROM workspaces WHERE id = ?1", WORKSPACE_COLUMNS),
        params![id],
        map_workspace_row,
    )
}

pub fn list_workspaces(conn: &Connection) -> SqlResult<Vec<Workspace>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM workspaces ORDER BY tab_order",
        WORKSPACE_COLUMNS
    ))?;
    let rows = stmt.query_map([], map_workspace_row)?;
    rows.collect()
}

pub fn update_workspace(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    repo_path: Option<&str>,
    tab_order: Option<i64>,
    is_active: Option<bool>,
    config: Option<&str>,
) -> SqlResult<Workspace> {
    let current = get_workspace(conn, id)?;
    let ts = now();
    conn.execute(
        "UPDATE workspaces SET name = ?1, repo_path = ?2, tab_order = ?3, is_active = ?4, config = ?5, updated_at = ?6 WHERE id = ?7",
        params![
            name.unwrap_or(&current.name),
            repo_path.unwrap_or(&current.repo_path),
            tab_order.unwrap_or(current.tab_order),
            is_active.unwrap_or(current.is_active) as i64,
            config.unwrap_or(&current.config),
            ts,
            id,
        ],
    )?;
    get_workspace(conn, id)
}

pub fn delete_workspace(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
    Ok(())
}
