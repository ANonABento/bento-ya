use rusqlite::{params, Connection, Result as SqlResult};

use super::{new_id, now};

pub struct GithubSyncState {
    pub workspace_id: String,
    pub last_synced_at: Option<String>,
    pub created_at: String,
}

pub fn get_github_sync_state(conn: &Connection, workspace_id: &str) -> SqlResult<GithubSyncState> {
    conn.query_row(
        "SELECT workspace_id, last_synced_at, created_at FROM github_sync_state WHERE workspace_id = ?1",
        params![workspace_id],
        |row| {
            Ok(GithubSyncState {
                workspace_id: row.get(0)?,
                last_synced_at: row.get(1)?,
                created_at: row.get(2)?,
            })
        },
    )
}

pub fn upsert_github_sync_state(conn: &Connection, workspace_id: &str) -> SqlResult<()> {
    let ts = now();
    conn.execute(
        "INSERT INTO github_sync_state (workspace_id, last_synced_at, created_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(workspace_id) DO UPDATE SET last_synced_at = ?2",
        params![workspace_id, ts, ts],
    )?;
    Ok(())
}

/// Return all github_issue_numbers already linked to tasks in this workspace.
pub fn list_github_issue_numbers(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT github_issue_number FROM tasks WHERE workspace_id = ?1 AND github_issue_number IS NOT NULL",
    )?;
    stmt.query_map(params![workspace_id], |row| row.get(0))
        .and_then(|iter| iter.collect())
}

/// Create a task seeded from a GitHub issue.
pub fn insert_task_from_github_issue(
    conn: &Connection,
    workspace_id: &str,
    column_id: &str,
    title: &str,
    description: Option<&str>,
    issue_number: i64,
) -> SqlResult<()> {
    let id = new_id();
    let ts = now();
    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
            params![column_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);
    conn.execute(
        "INSERT OR IGNORE INTO tasks (id, workspace_id, column_id, title, description, position, priority, files_touched, pipeline_state, github_issue_number, github_issue_commented, github_issue_pr_linked, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'medium', '[]', 'idle', ?7, 0, 0, ?8, ?9)",
        params![id, workspace_id, column_id, title, description, max_pos + 1, issue_number, ts, ts],
    )?;
    Ok(())
}

/// Mark that a done-comment has been posted on the issue linked to this task.
pub fn set_task_github_issue_commented(conn: &Connection, task_id: &str) -> SqlResult<()> {
    conn.execute(
        "UPDATE tasks SET github_issue_commented = 1, updated_at = ?2 WHERE id = ?1",
        params![task_id, now()],
    )?;
    Ok(())
}

/// Mark that the PR-link comment has been posted on the issue linked to this task.
pub fn set_task_github_issue_pr_linked(conn: &Connection, task_id: &str) -> SqlResult<()> {
    conn.execute(
        "UPDATE tasks SET github_issue_pr_linked = 1, updated_at = ?2 WHERE id = ?1",
        params![task_id, now()],
    )?;
    Ok(())
}

/// Return tasks in a column with a linked issue that haven't had a done-comment posted yet.
pub fn list_tasks_pending_done_comment(
    conn: &Connection,
    workspace_id: &str,
    column_id: &str,
) -> SqlResult<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT id, github_issue_number FROM tasks
         WHERE workspace_id = ?1 AND column_id = ?2
           AND github_issue_number IS NOT NULL
           AND github_issue_commented = 0",
    )?;
    stmt.query_map(params![workspace_id, column_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })
    .and_then(|iter| iter.collect())
}

/// Return tasks in a column that have a PR URL and linked issue but no PR-link comment posted.
pub fn list_tasks_pending_pr_link(
    conn: &Connection,
    workspace_id: &str,
    column_id: &str,
) -> SqlResult<Vec<(String, i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, github_issue_number, pr_url FROM tasks
         WHERE workspace_id = ?1 AND column_id = ?2
           AND github_issue_number IS NOT NULL
           AND pr_url IS NOT NULL
           AND github_issue_pr_linked = 0",
    )?;
    stmt.query_map(params![workspace_id, column_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })
    .and_then(|iter| iter.collect())
}
