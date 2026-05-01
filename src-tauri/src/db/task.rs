use rusqlite::{params, Connection, Result as SqlResult};

use super::models::Task;
use super::{new_id, now};

/// Shared SELECT columns for tasks (49 fields).
const TASK_COLUMNS: &str = "id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, pipeline_state, pipeline_triggered_at, pipeline_error, agent_session_id, last_script_exit_code, review_status, pr_number, pr_url, siege_iteration, siege_active, siege_max_iterations, siege_last_checked, pr_mergeable, pr_ci_status, pr_review_decision, pr_comment_count, pr_is_draft, pr_labels, pr_last_fetched, pr_head_sha, notify_stakeholders, notification_sent_at, trigger_overrides, trigger_prompt, last_output, dependencies, blocked, created_at, updated_at, agent_status, queued_at, retry_count, model, worktree_path, batch_id, github_issue_number, github_issue_commented, github_issue_pr_linked";

/// Generate a sortable task batch identifier for staging PR workflows.
pub fn generate_batch_id() -> String {
    format!("batch-{}", chrono::Utc::now().format("%Y%m%d%H%M%S%3f"))
}

/// Map a database row to a Task struct.
fn map_task_row(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        column_id: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        position: row.get(5)?,
        priority: row.get(6)?,
        agent_mode: row.get(7)?,
        agent_status: row.get(40)?,
        queued_at: row.get(41)?,
        branch_name: row.get(8)?,
        batch_id: row.get(45)?,
        files_touched: row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
        checklist: row.get(10)?,
        pipeline_state: row
            .get::<_, Option<String>>(11)?
            .unwrap_or_else(|| "idle".to_string()),
        pipeline_triggered_at: row.get(12)?,
        pipeline_error: row.get(13)?,
        retry_count: row.get::<_, Option<i64>>(42)?.unwrap_or(0),
        model: row.get(43)?,
        agent_session_id: row.get(14)?,
        last_script_exit_code: row.get(15)?,
        review_status: row.get(16)?,
        pr_number: row.get(17)?,
        pr_url: row.get(18)?,
        siege_iteration: row.get::<_, Option<i64>>(19)?.unwrap_or(0),
        siege_active: row.get::<_, Option<i64>>(20)?.unwrap_or(0) != 0,
        siege_max_iterations: row.get::<_, Option<i64>>(21)?.unwrap_or(5),
        siege_last_checked: row.get(22)?,
        pr_mergeable: row.get(23)?,
        pr_ci_status: row.get(24)?,
        pr_review_decision: row.get(25)?,
        pr_comment_count: row.get::<_, Option<i64>>(26)?.unwrap_or(0),
        pr_is_draft: row.get::<_, Option<i64>>(27)?.unwrap_or(0) != 0,
        pr_labels: row
            .get::<_, Option<String>>(28)?
            .unwrap_or_else(|| "[]".to_string()),
        pr_last_fetched: row.get(29)?,
        pr_head_sha: row.get(30)?,
        notify_stakeholders: row.get(31)?,
        notification_sent_at: row.get(32)?,
        trigger_overrides: row.get(33)?,
        trigger_prompt: row.get(34)?,
        last_output: row.get(35)?,
        dependencies: row.get(36)?,
        blocked: row.get::<_, Option<i64>>(37)?.unwrap_or(0) != 0,
        worktree_path: row.get(44)?,
        github_issue_number: row.get(46)?,
        github_issue_commented: row.get::<_, Option<i64>>(47)?.unwrap_or(0) != 0,
        github_issue_pr_linked: row.get::<_, Option<i64>>(48)?.unwrap_or(0) != 0,
        created_at: row.get(38)?,
        updated_at: row.get(39)?,
    })
}

pub fn insert_task(
    conn: &Connection,
    workspace_id: &str,
    column_id: &str,
    title: &str,
    description: Option<&str>,
) -> SqlResult<Task> {
    let id = new_id();
    let ts = now();
    // Get next position in column
    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
            params![column_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);
    conn.execute(
        "INSERT INTO tasks (id, workspace_id, column_id, title, description, position, priority, files_touched, pipeline_state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'medium', '[]', 'idle', ?7, ?8)",
        params![id, workspace_id, column_id, title, description, max_pos + 1, ts, ts],
    )?;
    get_task(conn, &id)
}

/// Duplicate a task immediately after the source task in the same column.
pub fn duplicate_task(conn: &Connection, id: &str) -> SqlResult<Task> {
    let source_task = get_task(conn, id)?;
    let new_id = new_id();
    let ts = now();
    let new_title = format!("{} (copy)", source_task.title);
    let duplicate_position = source_task.position + 1;

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "UPDATE tasks SET position = position + 1, updated_at = ?3 WHERE column_id = ?1 AND position >= ?2",
        params![source_task.column_id, duplicate_position, ts],
    )?;

    tx.execute(
        "INSERT INTO tasks (
            id,
            workspace_id,
            column_id,
            title,
            description,
            position,
            priority,
            agent_mode,
            branch_name,
            files_touched,
            checklist,
            pipeline_state,
            pipeline_triggered_at,
            pipeline_error,
            agent_session_id,
            last_script_exit_code,
            review_status,
            pr_number,
            pr_url,
            siege_iteration,
            siege_active,
            siege_max_iterations,
            siege_last_checked,
            pr_mergeable,
            pr_ci_status,
            pr_review_decision,
            pr_comment_count,
            pr_is_draft,
            pr_labels,
            pr_last_fetched,
            pr_head_sha,
            notify_stakeholders,
            notification_sent_at,
            trigger_overrides,
            trigger_prompt,
            last_output,
            dependencies,
            blocked,
            created_at,
            updated_at,
            agent_status,
            queued_at,
            retry_count,
            model,
            worktree_path,
            batch_id,
            github_issue_number,
            github_issue_commented,
            github_issue_pr_linked
        ) SELECT
            ?1,
            workspace_id,
            column_id,
            ?2,
            description,
            ?3,
            priority,
            agent_mode,
            NULL,
            '[]',
            checklist,
            'idle',
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            0,
            siege_max_iterations,
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            0,
            '[]',
            NULL,
            NULL,
            notify_stakeholders,
            NULL,
            trigger_overrides,
            trigger_prompt,
            NULL,
            dependencies,
            blocked,
            ?4,
            ?4,
            NULL,
            NULL,
            0,
            model,
            NULL,
            NULL,
            NULL,
            0,
            0
        FROM tasks WHERE id = ?5",
        params![new_id, new_title, duplicate_position, ts, source_task.id],
    )?;

    tx.commit()?;
    get_task(conn, &new_id)
}

/// Move a task to the end of a column, resetting its pipeline state to idle.
pub fn append_task_to_column(conn: &Connection, task_id: &str, column_id: &str) -> SqlResult<Task> {
    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
            params![column_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);
    let ts = now();
    conn.execute(
        "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', pipeline_triggered_at = NULL, pipeline_error = NULL, updated_at = ?3 WHERE id = ?4",
        params![column_id, max_pos + 1, ts, task_id],
    )?;
    get_task(conn, task_id)
}

pub fn get_task(conn: &Connection, id: &str) -> SqlResult<Task> {
    conn.query_row(
        &format!("SELECT {} FROM tasks WHERE id = ?1", TASK_COLUMNS),
        params![id],
        map_task_row,
    )
}

pub fn list_tasks(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM tasks WHERE workspace_id = ?1 ORDER BY column_id, position",
        TASK_COLUMNS
    ))?;
    let rows = stmt.query_map(params![workspace_id], map_task_row)?;
    rows.collect()
}

#[allow(clippy::too_many_arguments)]
pub fn update_task(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    description: Option<Option<&str>>,
    column_id: Option<&str>,
    position: Option<i64>,
    agent_mode: Option<Option<&str>>,
    priority: Option<&str>,
) -> SqlResult<Task> {
    let current = get_task(conn, id)?;
    let ts = now();
    let new_desc = match description {
        Some(d) => d.map(|s| s.to_string()),
        None => current.description.clone(),
    };
    let new_agent_mode = match agent_mode {
        Some(m) => m.map(|s| s.to_string()),
        None => current.agent_mode.clone(),
    };
    conn.execute(
        "UPDATE tasks SET title = ?1, description = ?2, column_id = ?3, position = ?4, agent_mode = ?5, priority = ?6, updated_at = ?7 WHERE id = ?8",
        params![
            title.unwrap_or(&current.title),
            new_desc,
            column_id.unwrap_or(&current.column_id),
            position.unwrap_or(current.position),
            new_agent_mode,
            priority.unwrap_or(&current.priority),
            ts,
            id,
        ],
    )?;
    get_task(conn, id)
}

pub fn delete_task(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

/// List tasks by column ID
pub fn list_tasks_by_column(conn: &Connection, column_id: &str) -> SqlResult<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM tasks WHERE column_id = ?1 ORDER BY position",
        TASK_COLUMNS
    ))?;
    let rows = stmt.query_map(params![column_id], map_task_row)?;
    rows.collect()
}

/// Update pipeline state for a task
pub fn update_task_pipeline_state(
    conn: &Connection,
    id: &str,
    state: &str,
    triggered_at: Option<&str>,
    error: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET pipeline_state = ?1, pipeline_triggered_at = ?2, pipeline_error = ?3, updated_at = ?4 WHERE id = ?5",
        params![state, triggered_at, error, ts, id],
    )?;
    get_task(conn, id)
}

/// Update agent_session_id for a task (links spawned agent to task)
pub fn update_task_agent_session(
    conn: &Connection,
    id: &str,
    agent_session_id: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET agent_session_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![agent_session_id, ts, id],
    )?;
    get_task(conn, id)
}

/// Update last_script_exit_code for a task (stores script trigger exit code)
pub fn update_task_script_exit_code(
    conn: &Connection,
    id: &str,
    exit_code: Option<i64>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET last_script_exit_code = ?1, updated_at = ?2 WHERE id = ?3",
        params![exit_code, ts, id],
    )?;
    get_task(conn, id)
}

/// Update review_status for a task (for manual approval workflow)
pub fn update_task_review_status(
    conn: &Connection,
    id: &str,
    review_status: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET review_status = ?1, updated_at = ?2 WHERE id = ?3",
        params![review_status, ts, id],
    )?;
    get_task(conn, id)
}

/// Update branch_name for a task
pub fn update_task_branch(
    conn: &Connection,
    id: &str,
    branch_name: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET branch_name = ?1, updated_at = ?2 WHERE id = ?3",
        params![branch_name, ts, id],
    )?;
    get_task(conn, id)
}

/// Update batch_id for a task.
pub fn update_task_batch_id(
    conn: &Connection,
    id: &str,
    batch_id: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET batch_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![batch_id, ts, id],
    )?;
    get_task(conn, id)
}

/// List tasks in a batch.
pub fn list_tasks_by_batch_id(
    conn: &Connection,
    workspace_id: &str,
    batch_id: &str,
) -> SqlResult<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM tasks WHERE workspace_id = ?1 AND batch_id = ?2 ORDER BY created_at ASC",
        TASK_COLUMNS
    ))?;
    let rows = stmt.query_map(params![workspace_id, batch_id], map_task_row)?;
    rows.collect()
}

/// Update worktree_path for a task
pub fn update_task_worktree_path(
    conn: &Connection,
    id: &str,
    worktree_path: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET worktree_path = ?1, updated_at = ?2 WHERE id = ?3",
        params![worktree_path, ts, id],
    )?;
    get_task(conn, id)
}

/// Update agent_status and optionally queued_at for a task
pub fn update_task_agent_status(
    conn: &Connection,
    id: &str,
    agent_status: Option<&str>,
    queued_at: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET agent_status = ?1, queued_at = ?2, updated_at = ?3 WHERE id = ?4",
        params![agent_status, queued_at, ts, id],
    )?;
    get_task(conn, id)
}

/// Get tasks with agent_status = 'queued' ordered by queued_at (oldest first)
pub fn get_queued_tasks(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Task>> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM tasks WHERE workspace_id = ?1 AND agent_status = 'queued' ORDER BY queued_at ASC", TASK_COLUMNS),
    )?;
    let rows = stmt.query_map(params![workspace_id], map_task_row)?;
    rows.collect()
}

/// Count tasks with agent_status = 'running' in a workspace
pub fn get_running_agent_count(conn: &Connection, workspace_id: &str) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE workspace_id = ?1 AND agent_status = 'running'",
        params![workspace_id],
        |row| row.get(0),
    )
}

/// Update PR info for a task (pr_number and pr_url)
pub fn update_task_pr_info(
    conn: &Connection,
    id: &str,
    pr_number: Option<i64>,
    pr_url: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET pr_number = ?1, pr_url = ?2, updated_at = ?3 WHERE id = ?4",
        params![pr_number, pr_url, ts, id],
    )?;
    get_task(conn, id)
}

/// Update PR/CI status fields for a task (from GitHub API)
#[allow(clippy::too_many_arguments)]
pub fn update_task_pr_status(
    conn: &Connection,
    id: &str,
    pr_mergeable: Option<&str>,
    pr_ci_status: Option<&str>,
    pr_review_decision: Option<&str>,
    pr_comment_count: Option<i64>,
    pr_is_draft: Option<bool>,
    pr_labels: Option<&str>,
    pr_head_sha: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET pr_mergeable = ?1, pr_ci_status = ?2, pr_review_decision = ?3, pr_comment_count = ?4, pr_is_draft = ?5, pr_labels = ?6, pr_last_fetched = ?7, pr_head_sha = ?8, updated_at = ?9 WHERE id = ?10",
        params![
            pr_mergeable,
            pr_ci_status,
            pr_review_decision,
            pr_comment_count.unwrap_or(0),
            pr_is_draft.map(|b| if b { 1 } else { 0 }).unwrap_or(0),
            pr_labels.unwrap_or("[]"),
            ts,
            pr_head_sha,
            ts,
            id,
        ],
    )?;
    get_task(conn, id)
}

/// Start or update siege loop for a task
pub fn start_siege(conn: &Connection, id: &str, max_iterations: Option<i64>) -> SqlResult<Task> {
    let ts = now();
    let max_iter = max_iterations.unwrap_or(5);
    conn.execute(
        "UPDATE tasks SET siege_active = 1, siege_iteration = 0, siege_max_iterations = ?1, siege_last_checked = ?2, updated_at = ?3 WHERE id = ?4",
        params![max_iter, ts, ts, id],
    )?;
    get_task(conn, id)
}

/// Stop siege loop for a task
pub fn stop_siege(conn: &Connection, id: &str) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET siege_active = 0, updated_at = ?1 WHERE id = ?2",
        params![ts, id],
    )?;
    get_task(conn, id)
}

/// Increment siege iteration counter for a task
pub fn increment_siege_iteration(conn: &Connection, id: &str) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET siege_iteration = siege_iteration + 1, siege_last_checked = ?1, updated_at = ?2 WHERE id = ?3",
        params![ts, ts, id],
    )?;
    get_task(conn, id)
}

/// Update siege last checked timestamp
pub fn update_siege_last_checked(conn: &Connection, id: &str) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET siege_last_checked = ?1, updated_at = ?2 WHERE id = ?3",
        params![ts, ts, id],
    )?;
    get_task(conn, id)
}

/// Update the stakeholders to notify for a task
pub fn update_task_stakeholders(
    conn: &Connection,
    id: &str,
    stakeholders: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET notify_stakeholders = ?1, updated_at = ?2 WHERE id = ?3",
        params![stakeholders, ts, id],
    )?;
    get_task(conn, id)
}

/// Mark a task's notification as sent
pub fn mark_task_notification_sent(conn: &Connection, id: &str) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET notification_sent_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![ts, ts, id],
    )?;
    get_task(conn, id)
}

/// Get the next queued task in a workspace (lowest position, idle, in Backlog column)
pub fn get_next_queued_task(conn: &Connection, workspace_id: &str) -> SqlResult<Option<Task>> {
    let result = conn.query_row(
        &format!(
            "SELECT {} FROM tasks WHERE workspace_id = ?1 AND queued_at IS NOT NULL AND pipeline_state = 'idle' AND column_id IN (SELECT id FROM columns WHERE name = 'Backlog' AND workspace_id = ?1) ORDER BY position LIMIT 1",
            TASK_COLUMNS
        ),
        params![workspace_id],
        map_task_row,
    );
    match result {
        Ok(task) => Ok(Some(task)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Clear the notification sent timestamp
pub fn clear_task_notification_sent(conn: &Connection, id: &str) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET notification_sent_at = NULL, updated_at = ?1 WHERE id = ?2",
        params![ts, id],
    )?;
    get_task(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn duplicate_task_copies_metadata_after_source_without_agent_session() {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let column = db::insert_column(&conn, &workspace.id, "Backlog", 0).unwrap();
        let source = insert_task(
            &conn,
            &workspace.id,
            &column.id,
            "Original",
            Some("details"),
        )
        .unwrap();
        let after = insert_task(&conn, &workspace.id, &column.id, "After", None).unwrap();
        let session = db::insert_agent_session(&conn, &source.id, "codex", Some("/tmp")).unwrap();

        db::update_task_agent_session(&conn, &source.id, Some(&session.id)).unwrap();
        conn.execute(
            "UPDATE tasks SET pr_labels = ?1, checklist = ?2, trigger_overrides = ?3, trigger_prompt = ?4, dependencies = ?5, blocked = 1, branch_name = ?6, files_touched = ?7, batch_id = ?8 WHERE id = ?9",
            params![
                r#"["bug","ui"]"#,
                r#"[{"id":"one","text":"Check","checked":false}]"#,
                r#"{"skip_triggers":true}"#,
                "custom prompt",
                r#"[{"taskId":"dep"}]"#,
                "bentoya/source-branch",
                r#"["src/main.rs"]"#,
                "batch-source",
                source.id,
            ],
        )
        .unwrap();

        let duplicated = duplicate_task(&conn, &source.id).unwrap();
        let shifted = get_task(&conn, &after.id).unwrap();

        assert_ne!(duplicated.id, source.id);
        assert_eq!(duplicated.title, "Original (copy)");
        assert_eq!(duplicated.description.as_deref(), Some("details"));
        assert_eq!(duplicated.workspace_id, workspace.id);
        assert_eq!(duplicated.column_id, column.id);
        assert_eq!(duplicated.position, source.position + 1);
        assert_eq!(shifted.position, source.position + 2);
        assert_eq!(duplicated.pr_labels, "[]");
        assert_eq!(
            duplicated.checklist.as_deref(),
            Some(r#"[{"id":"one","text":"Check","checked":false}]"#)
        );
        assert_eq!(
            duplicated.trigger_overrides.as_deref(),
            Some(r#"{"skip_triggers":true}"#)
        );
        assert_eq!(duplicated.trigger_prompt.as_deref(), Some("custom prompt"));
        assert_eq!(
            duplicated.dependencies.as_deref(),
            Some(r#"[{"taskId":"dep"}]"#)
        );
        assert!(duplicated.blocked);
        assert!(duplicated.agent_session_id.is_none());
        assert!(duplicated.branch_name.is_none());
        assert_eq!(duplicated.files_touched, "[]");
        assert!(duplicated.batch_id.is_none());
        assert_eq!(duplicated.pipeline_state, "idle");
        assert!(duplicated.worktree_path.is_none());
    }
}
