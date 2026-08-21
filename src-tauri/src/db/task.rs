use rusqlite::{params, Connection, Result as SqlResult};
use std::collections::HashMap;

use super::models::Task;
use super::{new_id, now, now_millis};

/// Shared SELECT columns for tasks (54 fields).
/// Order is load-bearing: `map_task_row` reads by index matching this list.
const TASK_COLUMNS: &str = "id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, pipeline_state, pipeline_triggered_at, pipeline_error, agent_session_id, last_script_exit_code, review_status, pr_number, pr_url, siege_iteration, siege_active, siege_max_iterations, siege_last_checked, pr_mergeable, pr_ci_status, pr_review_decision, pr_comment_count, pr_is_draft, pr_labels, pr_last_fetched, pr_head_sha, notify_stakeholders, notification_sent_at, trigger_overrides, trigger_prompt, last_output, dependencies, blocked, created_at, updated_at, agent_status, queued_at, retry_count, model, worktree_path, batch_id, github_issue_number, github_issue_commented, github_issue_pr_linked, archived_at, estimated_hours, actual_hours, last_user_input_at, held_by_user, runtime_mode_override, agent_paused_at, created_by_task_id, created_by_agent_session_id, recursion_depth, agent_done_signaled_at";

/// Generate a sortable task batch identifier for staging PR workflows.
pub fn generate_batch_id() -> String {
    format!("batch-{}", chrono::Utc::now().format("%Y%m%d%H%M%S%3f"))
}

/// Map a database row to a Task struct.
/// Indices MUST match `TASK_COLUMNS` order one-to-one.
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
        branch_name: row.get(8)?,
        files_touched: row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
        checklist: row.get(10)?,
        pipeline_state: row
            .get::<_, Option<String>>(11)?
            .unwrap_or_else(|| "idle".to_string()),
        pipeline_triggered_at: row.get(12)?,
        pipeline_error: row.get(13)?,
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
        created_at: row.get(38)?,
        updated_at: row.get(39)?,
        agent_status: row.get(40)?,
        queued_at: row.get(41)?,
        retry_count: row.get::<_, Option<i64>>(42)?.unwrap_or(0),
        model: row.get(43)?,
        worktree_path: row.get(44)?,
        batch_id: row.get(45)?,
        github_issue_number: row.get(46)?,
        github_issue_commented: row.get::<_, Option<i64>>(47)?.unwrap_or(0) != 0,
        github_issue_pr_linked: row.get::<_, Option<i64>>(48)?.unwrap_or(0) != 0,
        archived_at: row.get(49)?,
        estimated_hours: row.get(50)?,
        actual_hours: row.get::<_, Option<f64>>(51)?.unwrap_or(0.0),
        last_user_input_at: row.get(52)?,
        held_by_user: row.get::<_, Option<i64>>(53)?.unwrap_or(0) != 0,
        runtime_mode_override: row.get(54)?,
        agent_paused_at: row.get(55)?,
        created_by_task_id: row.get(56)?,
        created_by_agent_session_id: row.get(57)?,
        recursion_depth: row.get::<_, Option<i64>>(58)?.unwrap_or(0),
        agent_done_signaled_at: row.get(59)?,
        labels: Vec::new(),
    })
}

fn with_labels(conn: &Connection, mut task: Task) -> SqlResult<Task> {
    task.labels = super::list_task_labels(conn, &task.id)?;
    Ok(task)
}

fn with_labels_for_tasks(conn: &Connection, tasks: Vec<Task>) -> SqlResult<Vec<Task>> {
    let task_ids: Vec<String> = tasks.iter().map(|task| task.id.clone()).collect();
    let mut labels_by_task_id: HashMap<String, Vec<super::Label>> = HashMap::new();
    for (task_id, label) in super::list_labels_for_tasks(conn, &task_ids)? {
        labels_by_task_id.entry(task_id).or_default().push(label);
    }

    Ok(tasks
        .into_iter()
        .map(|mut task| {
            task.labels = labels_by_task_id.remove(&task.id).unwrap_or_default();
            task
        })
        .collect())
}

/// Returns true when a dependencies JSON string represents at least one dependency.
/// Treats `None`, empty, and the empty-array literal `[]` as "no dependencies".
pub fn deps_imply_blocked(dependencies: Option<&str>) -> bool {
    dependencies
        .map(|d| {
            let trimmed = d.trim();
            !trimmed.is_empty() && trimmed != "[]"
        })
        .unwrap_or(false)
}

/// Rich, single-INSERT task creation input. This is the one shape every
/// task-creation surface (UI, HTTP API, chef/orchestrator, MCP) funnels through
/// so a task created from any path is byte-for-byte identical in the DB.
///
/// Fields default to the same values the legacy `insert_task` hardcoded, so a
/// bare `NewTask { workspace_id, column_id, title, ..Default::default() }`
/// reproduces the old behavior exactly.
#[derive(Debug, Default, Clone)]
pub struct NewTask<'a> {
    pub workspace_id: &'a str,
    pub column_id: &'a str,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub model: Option<&'a str>,
    pub trigger_prompt: Option<&'a str>,
    /// JSON array of task ids. Presence of any entry sets `blocked = true`.
    pub dependencies: Option<&'a str>,
    /// Defaults to "medium" when None.
    pub priority: Option<&'a str>,
    pub runtime_mode_override: Option<&'a str>,
    /// MCP source attribution (migration 046). Set only when a trigger-spawned
    /// agent creates the task via MCP; None/0 for human/UI creates.
    pub created_by_task_id: Option<&'a str>,
    pub created_by_agent_session_id: Option<&'a str>,
    pub recursion_depth: i64,
}

/// The single rich INSERT. Sets every caller-supplied column atomically in one
/// statement (no follow-up UPDATEs), derives `blocked` from `dependencies`, and
/// returns the freshly-loaded `Task`.
pub fn insert_task_full(conn: &Connection, new: &NewTask) -> SqlResult<Task> {
    let id = new_id();
    let ts = now();
    let blocked = deps_imply_blocked(new.dependencies) as i64;
    let priority = new.priority.unwrap_or("medium");
    // Get next position in column
    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
            params![new.column_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);
    conn.execute(
        "INSERT INTO tasks (id, workspace_id, column_id, title, description, position, priority, files_touched, pipeline_state, trigger_prompt, dependencies, blocked, model, runtime_mode_override, created_by_task_id, created_by_agent_session_id, recursion_depth, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '[]', 'idle', ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            id,
            new.workspace_id,
            new.column_id,
            new.title,
            new.description,
            max_pos + 1,
            priority,
            new.trigger_prompt,
            new.dependencies,
            blocked,
            new.model,
            new.runtime_mode_override,
            new.created_by_task_id,
            new.created_by_agent_session_id,
            new.recursion_depth,
            ts,
            ts
        ],
    )?;
    get_task(conn, &id)
}

/// Thin wrapper preserving the original 4-field signature. New callers should
/// prefer [`insert_task_full`] so they can set model/runtime_mode/deps/etc.
pub fn insert_task(
    conn: &Connection,
    workspace_id: &str,
    column_id: &str,
    title: &str,
    description: Option<&str>,
) -> SqlResult<Task> {
    insert_task_full(
        conn,
        &NewTask {
            workspace_id,
            column_id,
            title,
            description,
            ..Default::default()
        },
    )
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
    let task = conn.query_row(
        &format!("SELECT {} FROM tasks WHERE id = ?1", TASK_COLUMNS),
        params![id],
        map_task_row,
    )?;
    with_labels(conn, task)
}

pub fn list_tasks(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM tasks WHERE workspace_id = ?1 ORDER BY column_id, position",
        TASK_COLUMNS
    ))?;
    let rows = stmt.query_map(params![workspace_id], map_task_row)?;
    with_labels_for_tasks(conn, rows.collect::<SqlResult<Vec<_>>>()?)
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

pub fn update_task_time_tracking(
    conn: &Connection,
    id: &str,
    estimated_hours: Option<f64>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET estimated_hours = ?1, updated_at = ?2 WHERE id = ?3",
        params![estimated_hours, ts, id],
    )?;
    get_task(conn, id)
}

pub fn delete_task(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

/// Stamp user-originated input and hold auto-advance for this task.
pub fn stamp_task_user_input(conn: &Connection, id: &str) -> SqlResult<Task> {
    let ts = now();
    let input_at = now_millis();
    conn.execute(
        "UPDATE tasks SET last_user_input_at = ?1, held_by_user = 1, updated_at = ?2 WHERE id = ?3",
        params![input_at, ts, id],
    )?;
    get_task(conn, id)
}

/// Toggle the explicit user hold gate for auto-advance.
pub fn set_task_held_by_user(conn: &Connection, id: &str, held: bool) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET held_by_user = ?1, updated_at = ?2 WHERE id = ?3",
        params![if held { 1 } else { 0 }, ts, id],
    )?;
    get_task(conn, id)
}

/// List tasks by column ID
pub fn list_tasks_by_column(conn: &Connection, column_id: &str) -> SqlResult<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM tasks WHERE column_id = ?1 ORDER BY position",
        TASK_COLUMNS
    ))?;
    let rows = stmt.query_map(params![column_id], map_task_row)?;
    with_labels_for_tasks(conn, rows.collect::<SqlResult<Vec<_>>>()?)
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
    with_labels_for_tasks(conn, rows.collect::<SqlResult<Vec<_>>>()?)
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

/// Phase 4 (AGENT_PANEL_MODES) — set or clear the task-level runtime
/// mode override. Pass `None` to clear (back to inherit-from-column).
pub fn update_task_runtime_mode_override(
    conn: &Connection,
    id: &str,
    runtime_mode: Option<&str>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET runtime_mode_override = ?1, updated_at = ?2 WHERE id = ?3",
        params![runtime_mode, ts, id],
    )?;
    get_task(conn, id)
}

/// Phase 5 (AGENT_PANEL_MODES) — set or clear the pause timestamp.
/// `Some(epoch_ms)` marks the task as paused; `None` clears it.
pub fn update_task_agent_paused_at(
    conn: &Connection,
    id: &str,
    paused_at: Option<i64>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET agent_paused_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![paused_at, ts, id],
    )?;
    get_task(conn, id)
}

/// Set (or clear) the interactive "agent signaled done" advisory stamp.
///
/// Epoch ms when the sentinel was seen; `None` clears it. Cleared on advance
/// and on a fresh agent start so a stale badge can't outlive its run.
pub fn update_task_agent_done_signaled_at(
    conn: &Connection,
    id: &str,
    done_at: Option<i64>,
) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET agent_done_signaled_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![done_at, ts, id],
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
        &format!("SELECT {} FROM tasks WHERE workspace_id = ?1 AND agent_status = 'queued' AND archived_at IS NULL ORDER BY queued_at ASC", TASK_COLUMNS),
    )?;
    let rows = stmt.query_map(params![workspace_id], map_task_row)?;
    with_labels_for_tasks(conn, rows.collect::<SqlResult<Vec<_>>>()?)
}

/// Get tasks with `pipeline_state = 'setup_queued'` ordered by updated_at
/// (oldest first) — used to promote a setup-queued task when the workspace's
/// setup lock releases.
pub fn get_setup_queued_tasks(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM tasks WHERE workspace_id = ?1 AND pipeline_state = 'setup_queued' AND archived_at IS NULL ORDER BY updated_at ASC",
        TASK_COLUMNS
    ))?;
    let rows = stmt.query_map(params![workspace_id], map_task_row)?;
    with_labels_for_tasks(conn, rows.collect::<SqlResult<Vec<_>>>()?)
}

/// Count tasks with agent_status = 'running' in a workspace
pub fn get_running_agent_count(conn: &Connection, workspace_id: &str) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE workspace_id = ?1 AND agent_status = 'running'",
        params![workspace_id],
        |row| row.get(0),
    )
}

/// Reset a task's `agent_status` ONLY if it still references `session_id`.
///
/// Used when a stale completion handler discovers its task moved columns
/// mid-trigger. If the destination column spawned a fresh agent, the task's
/// `agent_session_id` has already advanced to the new session, so a blind
/// `agent_status='idle'` write would clobber the new agent's `running` state.
/// Guarding on the session id makes the slot-freeing reset a no-op in that case.
/// Returns the number of rows updated (0 if a newer session took over).
pub fn clear_task_agent_status_for_session(
    conn: &Connection,
    task_id: &str,
    session_id: &str,
    new_status: &str,
) -> SqlResult<usize> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET agent_status = ?1, updated_at = ?2 \
         WHERE id = ?3 AND agent_session_id = ?4",
        params![new_status, ts, task_id, session_id],
    )
}

/// Count tasks with agent_status = 'running' in a single column of a workspace.
/// Used for per-column concurrency caps (e.g. serialize Merge main).
pub fn get_running_agent_count_in_column(
    conn: &Connection,
    workspace_id: &str,
    column_id: &str,
) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM tasks WHERE workspace_id = ?1 AND column_id = ?2 AND agent_status = 'running'",
        params![workspace_id, column_id],
        |row| row.get(0),
    )
}

/// Count active, non-queued task executions across the whole workspace,
/// excluding one task.
///
/// The workspace concurrency gate needs this broader count for the same reason
/// the column gate does: a terminal-/interactive-mode agent sits in
/// `pipeline_state='triggered'`/`'running'` before its `agent_status` is set to
/// `'running'` (that write happens asynchronously inside the spawned task). A
/// gate that only counts `agent_status='running'` therefore undercounts during
/// a burst of simultaneous fires and over-spawns past the cap. Excludes the
/// task currently being evaluated so it isn't counted against its own slot.
pub fn get_active_execution_count_excluding(
    conn: &Connection,
    workspace_id: &str,
    excluded_task_id: &str,
) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM tasks \
         WHERE workspace_id = ?1 \
           AND id != ?2 \
           AND archived_at IS NULL \
           AND COALESCE(agent_status, '') != 'queued' \
           AND (agent_status = 'running' \
                OR pipeline_state IN ('triggered', 'running', 'evaluating', 'advancing', 'rate_limited'))",
        params![workspace_id, excluded_task_id],
        |row| row.get(0),
    )
}

/// Count active, non-queued task executions in a single column.
///
/// Column caps need this broader count because a terminal-mode agent can be
/// in `pipeline_state='triggered'` or `pipeline_state='running'` before its
/// `agent_status` is updated to `running`.
pub fn get_active_execution_count_in_column_excluding(
    conn: &Connection,
    workspace_id: &str,
    column_id: &str,
    excluded_task_id: &str,
) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM tasks \
         WHERE workspace_id = ?1 \
           AND column_id = ?2 \
           AND id != ?3 \
           AND archived_at IS NULL \
           AND COALESCE(agent_status, '') != 'queued' \
           AND (agent_status = 'running' \
                OR pipeline_state IN ('triggered', 'running', 'evaluating', 'advancing', 'rate_limited'))",
        params![workspace_id, column_id, excluded_task_id],
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
            "SELECT {} FROM tasks WHERE workspace_id = ?1 AND queued_at IS NOT NULL AND pipeline_state = 'idle' AND archived_at IS NULL AND column_id IN (SELECT id FROM columns WHERE name = 'Backlog' AND workspace_id = ?1) ORDER BY position LIMIT 1",
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

/// Soft-archive a task by setting archived_at timestamp.
pub fn archive_task(conn: &Connection, id: &str) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET archived_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![ts, ts, id],
    )?;
    get_task(conn, id)
}

/// Restore an archived task by clearing archived_at.
pub fn unarchive_task(conn: &Connection, id: &str) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET archived_at = NULL, updated_at = ?1 WHERE id = ?2",
        params![ts, id],
    )?;
    get_task(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_task(conn: &Connection) -> Task {
        let workspace = crate::db::insert_workspace(conn, "WS", "/tmp/ws").unwrap();
        let column = crate::db::insert_column(conn, &workspace.id, "Backlog", 0).unwrap();
        insert_task(conn, &workspace.id, &column.id, "Task", None).unwrap()
    }

    #[test]
    fn clear_agent_status_for_session_frees_slot_when_session_matches() {
        let conn = crate::db::init_test().unwrap();
        let task = seed_task(&conn);
        update_task_agent_session(&conn, &task.id, Some("sess-A")).unwrap();
        update_task_agent_status(&conn, &task.id, Some("running"), None).unwrap();

        let rows =
            clear_task_agent_status_for_session(&conn, &task.id, "sess-A", "idle").unwrap();

        assert_eq!(rows, 1, "matching session should update exactly one row");
        let reloaded = get_task(&conn, &task.id).unwrap();
        assert_eq!(reloaded.agent_status.as_deref(), Some("idle"));
    }

    #[test]
    fn clear_agent_status_for_session_is_noop_when_a_newer_session_took_over() {
        // Regression: a stale completion handler must NOT clobber the `running`
        // status of a fresh agent that took over the task in another column.
        let conn = crate::db::init_test().unwrap();
        let task = seed_task(&conn);
        // A new agent (session B) now owns the task and is running.
        update_task_agent_session(&conn, &task.id, Some("sess-B")).unwrap();
        update_task_agent_status(&conn, &task.id, Some("running"), None).unwrap();

        // The OLD handler (session A) tries to free the slot.
        let rows =
            clear_task_agent_status_for_session(&conn, &task.id, "sess-A", "idle").unwrap();

        assert_eq!(rows, 0, "stale session must not match the new owner");
        let reloaded = get_task(&conn, &task.id).unwrap();
        assert_eq!(
            reloaded.agent_status.as_deref(),
            Some("running"),
            "the new agent's running status must be preserved"
        );
    }

    #[test]
    fn inserted_task_defaults_to_no_user_hold() {
        let conn = crate::db::init_test().unwrap();
        let task = seed_task(&conn);

        assert_eq!(task.last_user_input_at, None);
        assert!(!task.held_by_user);
    }

    #[test]
    fn stamp_task_user_input_records_activity_and_holds_auto_advance() {
        let conn = crate::db::init_test().unwrap();
        let task = seed_task(&conn);

        let stamped = stamp_task_user_input(&conn, &task.id).unwrap();

        assert!(stamped.last_user_input_at.is_some());
        assert!(stamped.held_by_user);
    }

    #[test]
    fn agent_done_signaled_at_round_trips_and_clears() {
        let conn = crate::db::init_test().unwrap();
        let task = seed_task(&conn);
        // A fresh task has not signaled done.
        assert_eq!(task.agent_done_signaled_at, None);

        let signaled = update_task_agent_done_signaled_at(&conn, &task.id, Some(1_700_000_000_123))
            .unwrap();
        assert_eq!(signaled.agent_done_signaled_at, Some(1_700_000_000_123));

        // Re-reading goes through TASK_COLUMNS + map_task_row, so this also
        // pins the column-order/index pairing that a new column can silently
        // shift.
        let reread = get_task(&conn, &task.id).unwrap();
        assert_eq!(reread.agent_done_signaled_at, Some(1_700_000_000_123));

        let cleared = update_task_agent_done_signaled_at(&conn, &task.id, None).unwrap();
        assert_eq!(cleared.agent_done_signaled_at, None);
    }

    #[test]
    fn set_task_held_by_user_toggles_gate_without_clearing_activity_stamp() {
        let conn = crate::db::init_test().unwrap();
        let task = seed_task(&conn);
        let stamped = stamp_task_user_input(&conn, &task.id).unwrap();

        let released = set_task_held_by_user(&conn, &task.id, false).unwrap();

        assert_eq!(released.last_user_input_at, stamped.last_user_input_at);
        assert!(!released.held_by_user);
    }

    #[test]
    fn active_execution_count_in_column_counts_pipeline_states_but_not_queued() {
        let conn = crate::db::init_test().unwrap();
        let workspace = crate::db::insert_workspace(&conn, "WS", "/tmp/ws").unwrap();
        let column = crate::db::insert_column(&conn, &workspace.id, "Verify", 0).unwrap();
        let active = insert_task(&conn, &workspace.id, &column.id, "Active", None).unwrap();
        let queued = insert_task(&conn, &workspace.id, &column.id, "Queued", None).unwrap();
        let current = insert_task(&conn, &workspace.id, &column.id, "Current", None).unwrap();

        update_task_pipeline_state(&conn, &active.id, "triggered", None, None).unwrap();
        update_task_pipeline_state(&conn, &queued.id, "triggered", None, None).unwrap();
        update_task_agent_status(&conn, &queued.id, Some("queued"), Some(&now())).unwrap();
        update_task_pipeline_state(&conn, &current.id, "triggered", None, None).unwrap();

        let count = get_active_execution_count_in_column_excluding(
            &conn,
            &workspace.id,
            &column.id,
            &current.id,
        )
        .unwrap();

        assert_eq!(count, 1);
    }
}
