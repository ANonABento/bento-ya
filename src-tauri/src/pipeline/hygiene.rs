//! Pipeline hygiene: periodic self-healing for Done tasks.
//!
//! Two responsibilities:
//! 1. Auto-archive tasks that have sat in Done for the workspace's grace period.
//! 2. Reconcile stale `agent_status='failed'` and `pipeline_error` on Done tasks
//!    (the work succeeded — the badge is lying), and delete failed
//!    `agent_sessions` rows so the UI stops showing red badges.

use rusqlite::{params, Connection};
use serde_json::Value;

use crate::db;

/// Default grace period before auto-archiving a Done task.
pub const DEFAULT_AUTO_ARCHIVE_GRACE_MINUTES: i64 = 5;

/// Read per-workspace auto-archive settings from the JSON `workspace.config` blob.
///
/// Returns `(enabled, grace_minutes)`. Defaults: enabled=true, grace=5m.
pub fn read_auto_archive_config(workspace_config: &str) -> (bool, i64) {
    let config: Value = serde_json::from_str(workspace_config).unwrap_or(Value::Null);
    let enabled = config["autoArchiveDone"].as_bool().unwrap_or(true);
    let grace = config["autoArchiveGraceMinutes"]
        .as_i64()
        .filter(|m| *m > 0)
        .unwrap_or(DEFAULT_AUTO_ARCHIVE_GRACE_MINUTES);
    (enabled, grace)
}

/// Auto-archive Done tasks for every workspace that has the toggle enabled.
///
/// A task is eligible when:
/// - it's in a column named "Done" (case-insensitive),
/// - `archived_at IS NULL`,
/// - `updated_at` is older than the workspace's grace period.
///
/// Returns the total number of tasks archived across all workspaces.
pub fn auto_archive_done_tasks(conn: &Connection) -> rusqlite::Result<i64> {
    let mut total = 0i64;

    for workspace in db::list_workspaces(conn)? {
        let (enabled, grace_minutes) = read_auto_archive_config(&workspace.config);
        if !enabled {
            continue;
        }
        total += archive_done_tasks_for_workspace(conn, &workspace.id, grace_minutes)?;
    }

    Ok(total)
}

/// Archive eligible Done tasks for a single workspace. Public for testing.
pub fn archive_done_tasks_for_workspace(
    conn: &Connection,
    workspace_id: &str,
    grace_minutes: i64,
) -> rusqlite::Result<i64> {
    let ts = db::now();
    let cutoff_modifier = format!("-{} minutes", grace_minutes);
    let n = conn.execute(
        "UPDATE tasks
         SET archived_at = ?1, updated_at = ?1
         WHERE workspace_id = ?2
           AND archived_at IS NULL
           AND datetime(updated_at) < datetime('now', ?3)
           AND column_id IN (
               SELECT id FROM columns
               WHERE workspace_id = ?2 AND LOWER(name) = 'done'
           )",
        params![ts, workspace_id, cutoff_modifier],
    )? as i64;
    Ok(n)
}

/// Reconcile stale failure markers on Done tasks.
///
/// For every task in a Done column with `pipeline_error` set or
/// `agent_status` of 'failed' / 'queued' / 'running':
/// - clear `pipeline_error`,
/// - reset `agent_status` to 'completed',
/// - delete any `agent_sessions` rows for the task whose `status` is 'failed'.
///
/// The PR is in main, the task is in Done — the failure flags are stale.
/// Returns `(tasks_reconciled, sessions_cleared)`.
pub fn reconcile_done_task_state(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    let ts = db::now();

    let stale_tasks: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT t.id
             FROM tasks t
             JOIN columns c ON c.id = t.column_id
             WHERE LOWER(c.name) = 'done'
               AND t.archived_at IS NULL
               AND (
                   t.pipeline_error IS NOT NULL
                   OR t.agent_status IN ('failed', 'queued', 'running')
               )",
        )?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };

    if stale_tasks.is_empty() {
        return Ok((0, 0));
    }

    let mut sessions_cleared = 0i64;
    let mut tasks_reconciled = 0i64;

    for task_id in &stale_tasks {
        let updated = conn.execute(
            "UPDATE tasks
             SET pipeline_error = NULL,
                 agent_status = 'completed',
                 queued_at = NULL,
                 updated_at = ?1
             WHERE id = ?2",
            params![ts, task_id],
        )?;
        tasks_reconciled += updated as i64;

        let cleared = conn.execute(
            "DELETE FROM agent_sessions WHERE task_id = ?1 AND status = 'failed'",
            params![task_id],
        )?;
        sessions_cleared += cleared as i64;
    }

    Ok((tasks_reconciled, sessions_cleared))
}

/// Run a single hygiene cycle: auto-archive + reconciliation.
///
/// Logs counts at info level. Returns the totals so callers can emit events.
pub fn run_hygiene_cycle(conn: &Connection) -> rusqlite::Result<HygieneCycleResult> {
    let archived = auto_archive_done_tasks(conn).unwrap_or_else(|e| {
        log::warn!("[hygiene] auto-archive failed: {}", e);
        0
    });
    let (tasks_reconciled, sessions_cleared) = reconcile_done_task_state(conn).unwrap_or_else(|e| {
        log::warn!("[hygiene] reconcile failed: {}", e);
        (0, 0)
    });

    Ok(HygieneCycleResult {
        archived,
        tasks_reconciled,
        sessions_cleared,
    })
}

/// Aggregate counts from one hygiene cycle.
#[derive(Debug, Clone, Copy, Default)]
pub struct HygieneCycleResult {
    pub archived: i64,
    pub tasks_reconciled: i64,
    pub sessions_cleared: i64,
}

impl HygieneCycleResult {
    pub fn is_empty(&self) -> bool {
        self.archived == 0 && self.tasks_reconciled == 0 && self.sessions_cleared == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn done_column(conn: &Connection, workspace_id: &str, position: i64) -> db::Column {
        db::insert_column(conn, workspace_id, "Done", position).unwrap()
    }

    fn back_date_task(conn: &Connection, task_id: &str, minutes_ago: i64) {
        let sql = format!(
            "UPDATE tasks SET updated_at = datetime('now', '-{} minutes') WHERE id = ?1",
            minutes_ago
        );
        conn.execute(&sql, params![task_id]).unwrap();
    }

    #[test]
    fn read_auto_archive_config_defaults_when_missing() {
        let (enabled, grace) = read_auto_archive_config("{}");
        assert!(enabled);
        assert_eq!(grace, DEFAULT_AUTO_ARCHIVE_GRACE_MINUTES);
    }

    #[test]
    fn read_auto_archive_config_respects_disable_toggle() {
        let (enabled, grace) = read_auto_archive_config(r#"{"autoArchiveDone":false}"#);
        assert!(!enabled);
        assert_eq!(grace, DEFAULT_AUTO_ARCHIVE_GRACE_MINUTES);
    }

    #[test]
    fn read_auto_archive_config_uses_custom_grace() {
        let (_, grace) = read_auto_archive_config(r#"{"autoArchiveGraceMinutes":15}"#);
        assert_eq!(grace, 15);
    }

    #[test]
    fn read_auto_archive_config_rejects_non_positive_grace() {
        let (_, grace) = read_auto_archive_config(r#"{"autoArchiveGraceMinutes":0}"#);
        assert_eq!(grace, DEFAULT_AUTO_ARCHIVE_GRACE_MINUTES);
        let (_, grace) = read_auto_archive_config(r#"{"autoArchiveGraceMinutes":-1}"#);
        assert_eq!(grace, DEFAULT_AUTO_ARCHIVE_GRACE_MINUTES);
    }

    #[test]
    fn auto_archive_archives_only_old_done_tasks() {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "WS", "/tmp/ws").unwrap();
        let backlog = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let done = done_column(&conn, &ws.id, 1);

        let fresh_done = db::insert_task(&conn, &ws.id, &done.id, "Fresh", None).unwrap();
        let stale_done = db::insert_task(&conn, &ws.id, &done.id, "Stale", None).unwrap();
        let stale_backlog = db::insert_task(&conn, &ws.id, &backlog.id, "Other", None).unwrap();

        back_date_task(&conn, &stale_done.id, 30);
        back_date_task(&conn, &stale_backlog.id, 30);

        let n = archive_done_tasks_for_workspace(&conn, &ws.id, 5).unwrap();
        assert_eq!(n, 1);

        assert!(db::get_task(&conn, &stale_done.id).unwrap().archived_at.is_some());
        assert!(db::get_task(&conn, &fresh_done.id).unwrap().archived_at.is_none());
        assert!(db::get_task(&conn, &stale_backlog.id).unwrap().archived_at.is_none());
    }

    #[test]
    fn auto_archive_skips_already_archived() {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "WS", "/tmp/ws").unwrap();
        let done = done_column(&conn, &ws.id, 0);
        let task = db::insert_task(&conn, &ws.id, &done.id, "Already", None).unwrap();
        db::archive_task(&conn, &task.id).unwrap();
        let originally_archived_at = db::get_task(&conn, &task.id).unwrap().archived_at.unwrap();

        // Re-back-date so the freshly-set archived_at doesn't count as "fresh".
        back_date_task(&conn, &task.id, 30);

        let n = archive_done_tasks_for_workspace(&conn, &ws.id, 5).unwrap();
        assert_eq!(n, 0);

        let after = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(after.archived_at.as_deref(), Some(originally_archived_at.as_str()));
    }

    #[test]
    fn auto_archive_respects_per_workspace_disable_toggle() {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "WS", "/tmp/ws").unwrap();
        db::update_workspace(
            &conn,
            &ws.id,
            None,
            None,
            None,
            None,
            Some(r#"{"autoArchiveDone":false}"#),
        )
        .unwrap();
        let done = done_column(&conn, &ws.id, 0);
        let task = db::insert_task(&conn, &ws.id, &done.id, "Stale", None).unwrap();
        back_date_task(&conn, &task.id, 30);

        let n = auto_archive_done_tasks(&conn).unwrap();
        assert_eq!(n, 0);
        assert!(db::get_task(&conn, &task.id).unwrap().archived_at.is_none());
    }

    #[test]
    fn auto_archive_runs_across_workspaces() {
        let conn = db::init_test().unwrap();
        let ws_a = db::insert_workspace(&conn, "A", "/tmp/a").unwrap();
        let ws_b = db::insert_workspace(&conn, "B", "/tmp/b").unwrap();
        let done_a = done_column(&conn, &ws_a.id, 0);
        let done_b = done_column(&conn, &ws_b.id, 0);

        let t_a = db::insert_task(&conn, &ws_a.id, &done_a.id, "A", None).unwrap();
        let t_b = db::insert_task(&conn, &ws_b.id, &done_b.id, "B", None).unwrap();
        back_date_task(&conn, &t_a.id, 30);
        back_date_task(&conn, &t_b.id, 30);

        let n = auto_archive_done_tasks(&conn).unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn reconcile_clears_stale_failure_state_on_done_tasks() {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "WS", "/tmp/ws").unwrap();
        let done = done_column(&conn, &ws.id, 0);
        let task = db::insert_task(&conn, &ws.id, &done.id, "Stale", None).unwrap();

        db::update_task_pipeline_state(
            &conn,
            &task.id,
            "idle",
            None,
            Some("Pipeline failed: reviewer crashed"),
        )
        .unwrap();
        db::update_task_agent_status(&conn, &task.id, Some("failed"), None).unwrap();

        let session = db::insert_agent_session(&conn, &task.id, "claude", None).unwrap();
        db::update_agent_session(
            &conn,
            &session.id,
            None,
            Some("failed"),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let (tasks, sessions) = reconcile_done_task_state(&conn).unwrap();
        assert_eq!(tasks, 1);
        assert_eq!(sessions, 1);

        let after = db::get_task(&conn, &task.id).unwrap();
        assert!(after.pipeline_error.is_none());
        assert_eq!(after.agent_status.as_deref(), Some("completed"));
        assert!(db::list_agent_sessions(&conn, &task.id).unwrap().is_empty());
    }

    #[test]
    fn reconcile_skips_archived_done_tasks() {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "WS", "/tmp/ws").unwrap();
        let done = done_column(&conn, &ws.id, 0);
        let task = db::insert_task(&conn, &ws.id, &done.id, "Stale", None).unwrap();
        db::update_task_pipeline_state(&conn, &task.id, "idle", None, Some("err")).unwrap();
        db::archive_task(&conn, &task.id).unwrap();

        let (tasks, _) = reconcile_done_task_state(&conn).unwrap();
        assert_eq!(tasks, 0);

        let after = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(after.pipeline_error.as_deref(), Some("err"));
    }

    #[test]
    fn reconcile_leaves_active_tasks_alone() {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "WS", "/tmp/ws").unwrap();
        let backlog = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let _done = done_column(&conn, &ws.id, 1);
        let task = db::insert_task(&conn, &ws.id, &backlog.id, "Active", None).unwrap();
        db::update_task_pipeline_state(&conn, &task.id, "idle", None, Some("real failure")).unwrap();
        db::update_task_agent_status(&conn, &task.id, Some("failed"), None).unwrap();

        let (tasks, _) = reconcile_done_task_state(&conn).unwrap();
        assert_eq!(tasks, 0);

        let after = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(after.pipeline_error.as_deref(), Some("real failure"));
        assert_eq!(after.agent_status.as_deref(), Some("failed"));
    }

    #[test]
    fn run_hygiene_cycle_aggregates_counts() {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "WS", "/tmp/ws").unwrap();
        let done = done_column(&conn, &ws.id, 0);

        let archive_target = db::insert_task(&conn, &ws.id, &done.id, "Archive", None).unwrap();
        back_date_task(&conn, &archive_target.id, 30);

        let reconcile_target = db::insert_task(&conn, &ws.id, &done.id, "Reconcile", None).unwrap();
        db::update_task_pipeline_state(
            &conn,
            &reconcile_target.id,
            "idle",
            None,
            Some("stale"),
        )
        .unwrap();

        let result = run_hygiene_cycle(&conn).unwrap();
        // Reconcile happens after archive, so the reconcile target was untouched
        // by archiving (still updated_at = now()), and the archive target was
        // archived AND its pipeline_error was already null — so only one of each.
        assert_eq!(result.archived, 1);
        assert_eq!(result.tasks_reconciled, 1);
        assert!(!result.is_empty());
    }
}
