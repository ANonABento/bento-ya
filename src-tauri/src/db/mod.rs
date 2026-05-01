//! Database layer: SQLite with WAL mode, 28 versioned migrations.
//!
//! Models are in `db/models.rs`. CRUD functions are split by domain:
//! workspace, column, task, agent_session, agent_message, chat_session,
//! chat_message, orchestrator_session, checklist, usage, history, script.

pub mod models;
pub mod schema;

// Domain modules
pub mod agent_message;
pub mod agent_session;
pub mod chat_message;
pub mod chat_session;
pub mod checklist;
pub mod column;
pub mod github_sync;
pub mod history;
pub mod orchestrator_session;
pub mod pipeline_timing;
pub mod script;
pub mod task;
pub mod usage;
pub mod workspace;

// Re-export all model types so callers can use db::Workspace, db::Task, etc.
pub use models::*;

// Re-export all domain functions so callers can use db::insert_task(), db::get_workspace(), etc.
pub use agent_message::*;
pub use agent_session::*;
pub use chat_message::*;
pub use chat_session::*;
pub use checklist::*;
pub use column::*;
pub use github_sync::*;
pub use history::*;
pub use orchestrator_session::*;
pub use pipeline_timing::*;
pub use script::*;
pub use task::*;
pub use usage::*;
pub use workspace::*;

use chrono::Utc;
use rusqlite::{params, Connection, Result as SqlResult};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

/// Application state holding the database connection.
pub struct AppState {
    pub db: Mutex<Connection>,
}

/// Returns the path to the Bento-ya data directory (~/.bentoya/).
pub fn data_dir() -> PathBuf {
    let home = dirs_home();
    home.join(".bentoya")
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// Returns the path to the SQLite database file.
pub fn db_path() -> PathBuf {
    data_dir().join("data.db")
}

/// Initialize the database: create directory, open connection, run migrations.
pub fn init() -> SqlResult<Connection> {
    let dir = data_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir).expect("Failed to create ~/.bentoya/ directory");
    }

    let path = db_path();
    let conn = Connection::open(&path)?;

    // Enable WAL mode for better concurrent read performance
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    // Enable foreign key constraints
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;
    // Busy timeout for concurrent access with bento-mcp
    conn.busy_timeout(std::time::Duration::from_secs(5))?;

    run_migrations(&conn)?;

    Ok(conn)
}

/// Initialize an in-memory database for testing.
#[cfg(test)]
pub fn init_test() -> SqlResult<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;
    run_migrations(&conn)?;
    Ok(conn)
}

/// Run all pending migrations.
fn run_migrations(conn: &Connection) -> SqlResult<()> {
    // Ensure migrations table exists
    conn.execute_batch(schema::CREATE_MIGRATIONS_TABLE)?;

    let migrations: Vec<(&str, &str)> = vec![
        ("001_initial", include_str!("migrations/001_initial.sql")),
        ("002_column_config", include_str!("migrations/002_column_config.sql")),
        ("003_pipeline_state", include_str!("migrations/003_pipeline_state.sql")),
        ("004_chat_messages", include_str!("migrations/004_chat_messages.sql")),
        ("005_checklists", include_str!("migrations/005_checklists.sql")),
        ("006_session_resume", include_str!("migrations/006_session_resume.sql")),
        ("007_cost_tracking", include_str!("migrations/007_cost_tracking.sql")),
        ("008_session_history", include_str!("migrations/008_session_history.sql")),
        ("009_chat_sessions", include_str!("migrations/009_chat_sessions.sql")),
        ("010_cli_sessions", include_str!("migrations/010_cli_sessions.sql")),
        ("011_workspace_config", include_str!("migrations/011_workspace_config.sql")),
        ("012_task_agent_session", include_str!("migrations/012_task_agent_session.sql")),
        ("013_task_script_exit_code", include_str!("migrations/013_task_script_exit_code.sql")),
        ("014_review_status", include_str!("migrations/014_review_status.sql")),
        ("015_pr_fields", include_str!("migrations/015_pr_fields.sql")),
        ("016_siege_fields", include_str!("migrations/016_siege_fields.sql")),
        ("017_pr_status_fields", include_str!("migrations/017_pr_status_fields.sql")),
        ("018_discord_integration", include_str!("migrations/018_discord_integration.sql")),
        ("019_checklist_autodetect", include_str!("migrations/019_checklist_autodetect.sql")),
        ("019_discord_agent_routes", include_str!("migrations/019_discord_agent_routes.sql")),
        ("020_notify_fields", include_str!("migrations/020_notify_fields.sql")),
        ("021_agent_messages", include_str!("migrations/021_agent_messages.sql")),
        ("022_agent_queue", include_str!("migrations/022_agent_queue.sql")),
        ("023_column_triggers", include_str!("migrations/023_column_triggers.sql")),
        ("024_drop_legacy_trigger_columns", include_str!("migrations/024_drop_legacy_trigger_columns.sql")),
        ("025_task_retry_count", include_str!("migrations/025_task_retry_count.sql")),
        ("026_remove_discord", include_str!("migrations/026_remove_discord.sql")),
        ("027_task_model", include_str!("migrations/027_task_model.sql")),
        ("028_scripts", include_str!("migrations/028_scripts.sql")),
        ("029_task_worktree", include_str!("migrations/029_task_worktree.sql")),
        ("030_pipeline_timing", include_str!("migrations/030_pipeline_timing.sql")),
        ("030_usage_column_duration", include_str!("migrations/030_usage_column_duration.sql")),
        ("031_task_batch_id", include_str!("migrations/031_task_batch_id.sql")),
        ("032_github_sync", include_str!("migrations/032_github_sync.sql")),
        ("033_github_issue_unique", include_str!("migrations/033_github_issue_unique.sql")),
        ("034_task_archive", include_str!("migrations/034_task_archive.sql")),
    ];

    for (name, sql) in migrations {
        let already_applied: bool = conn
            .prepare("SELECT COUNT(*) FROM _migrations WHERE name = ?1")?
            .query_row(params![name], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)?;

        if !already_applied {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO _migrations (name, applied_at) VALUES (?1, ?2)",
                params![name, now()],
            )?;
        }
    }

    Ok(())
}

/// Generate a new UUID v4 string.
pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

/// Current timestamp as ISO 8601 string.
pub fn now() -> String {
    Utc::now().to_rfc3339()
}

// ─── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schema_creation() {
        let conn = init_test().unwrap();
        // Verify tables exist by querying sqlite_master
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(tables.contains(&"workspaces".to_string()));
        assert!(tables.contains(&"columns".to_string()));
        assert!(tables.contains(&"tasks".to_string()));
        assert!(tables.contains(&"agent_sessions".to_string()));
        assert!(tables.contains(&"_migrations".to_string()));
    }

    #[test]
    fn test_migrations_idempotent() {
        let conn = init_test().unwrap();
        // Running migrations again should not fail
        run_migrations(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        // We have 35 migrations, including split 019 and 030 migration files.
        assert_eq!(count, 35);
    }

    #[test]
    fn test_workspace_crud() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "Test Project", "/tmp/test").unwrap();
        assert_eq!(ws.name, "Test Project");
        assert_eq!(ws.repo_path, "/tmp/test");
        assert!(!ws.is_active);

        let fetched = get_workspace(&conn, &ws.id).unwrap();
        assert_eq!(fetched.id, ws.id);

        let updated = update_workspace(&conn, &ws.id, Some("Renamed"), None, None, Some(true), None).unwrap();
        assert_eq!(updated.name, "Renamed");
        assert!(updated.is_active);

        let all = list_workspaces(&conn).unwrap();
        assert_eq!(all.len(), 1);

        delete_workspace(&conn, &ws.id).unwrap();
        let all = list_workspaces(&conn).unwrap();
        assert_eq!(all.len(), 0);
    }

    #[test]
    fn test_column_crud() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let col = insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        assert_eq!(col.name, "Backlog");
        assert_eq!(col.position, 0);
        assert!(col.visible);

        let updated = update_column(&conn, &col.id, Some("Todo"), None, Some(1), None, None, None).unwrap();
        assert_eq!(updated.name, "Todo");
        assert_eq!(updated.position, 1);

        let cols = list_columns(&conn, &ws.id).unwrap();
        assert_eq!(cols.len(), 1);

        delete_column(&conn, &col.id).unwrap();
        let cols = list_columns(&conn, &ws.id).unwrap();
        assert_eq!(cols.len(), 0);
    }

    #[test]
    fn test_task_crud() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let col = insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task = insert_task(&conn, &ws.id, &col.id, "Fix bug", Some("Critical issue")).unwrap();
        assert_eq!(task.title, "Fix bug");
        assert_eq!(task.description.as_deref(), Some("Critical issue"));
        assert_eq!(task.position, 0);
        assert_eq!(task.priority, "medium");

        // Second task gets position 1
        let task2 = insert_task(&conn, &ws.id, &col.id, "Add feature", None).unwrap();
        assert_eq!(task2.position, 1);

        let updated = update_task(&conn, &task.id, Some("Fix critical bug"), None, None, None, None, Some("high")).unwrap();
        assert_eq!(updated.title, "Fix critical bug");
        assert_eq!(updated.priority, "high");

        let tasks = list_tasks(&conn, &ws.id).unwrap();
        assert_eq!(tasks.len(), 2);

        delete_task(&conn, &task.id).unwrap();
        let tasks = list_tasks(&conn, &ws.id).unwrap();
        assert_eq!(tasks.len(), 1);
    }

    #[test]
    fn test_agent_session_crud() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let col = insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let task = insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();
        let session = insert_agent_session(&conn, &task.id, "claude", Some("/tmp")).unwrap();
        assert_eq!(session.status, "idle");
        assert_eq!(session.pty_cols, 80);
        assert_eq!(session.pty_rows, 24);
        assert_eq!(session.agent_type, "claude");
        assert_eq!(session.working_dir, Some("/tmp".to_string()));

        let updated = update_agent_session(&conn, &session.id, Some(Some(12345)), Some("running"), None, None, None, None).unwrap();
        assert_eq!(updated.pid, Some(12345));
        assert_eq!(updated.status, "running");

        let sessions = list_agent_sessions(&conn, &task.id).unwrap();
        assert_eq!(sessions.len(), 1);

        delete_agent_session(&conn, &session.id).unwrap();
        let sessions = list_agent_sessions(&conn, &task.id).unwrap();
        assert_eq!(sessions.len(), 0);
    }

    #[test]
    fn test_cascade_delete() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let col = insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task = insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();
        insert_agent_session(&conn, &task.id, "claude", None).unwrap();

        // Deleting workspace should cascade to columns, tasks, sessions
        delete_workspace(&conn, &ws.id).unwrap();
        assert!(get_column(&conn, &col.id).is_err());
        assert!(get_task(&conn, &task.id).is_err());
    }

    #[test]
    fn test_foreign_key_enforcement() {
        let conn = init_test().unwrap();
        // Inserting a column with a non-existent workspace should fail
        let result = insert_column(&conn, "nonexistent-id", "Bad Column", 0);
        assert!(result.is_err());
    }

    #[test]
    fn test_retry_count_default_and_increment() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let col = insert_column(&conn, &ws.id, "Test", 0).unwrap();
        let task = insert_task(&conn, &ws.id, &col.id, "Task 1", None).unwrap();
        assert_eq!(task.retry_count, 0);

        // Increment
        conn.execute(
            "UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?1",
            params![task.id],
        )
        .unwrap();
        let updated = get_task(&conn, &task.id).unwrap();
        assert_eq!(updated.retry_count, 1);

        // Increment again
        conn.execute(
            "UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?1",
            params![task.id],
        )
        .unwrap();
        let updated = get_task(&conn, &task.id).unwrap();
        assert_eq!(updated.retry_count, 2);
    }

    #[test]
    fn test_retry_count_reset_on_success() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let col = insert_column(&conn, &ws.id, "Test", 0).unwrap();
        let task = insert_task(&conn, &ws.id, &col.id, "Task 1", None).unwrap();

        // Increment to 3
        conn.execute(
            "UPDATE tasks SET retry_count = 3 WHERE id = ?1",
            params![task.id],
        )
        .unwrap();
        let updated = get_task(&conn, &task.id).unwrap();
        assert_eq!(updated.retry_count, 3);

        // Reset (simulating mark_complete success)
        conn.execute(
            "UPDATE tasks SET retry_count = 0 WHERE id = ?1",
            params![task.id],
        )
        .unwrap();
        let updated = get_task(&conn, &task.id).unwrap();
        assert_eq!(updated.retry_count, 0);
    }

    #[test]
    fn test_script_crud() {
        let conn = init_test().unwrap();

        // Create
        let script = insert_script(&conn, "test-1", "My Script", "Does stuff", "[]", false).unwrap();
        assert_eq!(script.name, "My Script");
        assert_eq!(script.description, "Does stuff");
        assert!(!script.is_built_in);

        // Read
        let fetched = get_script(&conn, "test-1").unwrap();
        assert_eq!(fetched.id, "test-1");

        // Update
        let updated = update_script(&conn, "test-1", Some("Renamed"), None, Some("[{\"type\":\"bash\"}]")).unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.description, "Does stuff"); // unchanged

        // List
        let all = list_scripts(&conn).unwrap();
        assert_eq!(all.len(), 1);

        // Delete
        delete_script(&conn, "test-1").unwrap();
        let all = list_scripts(&conn).unwrap();
        assert!(all.is_empty());
    }

    #[test]
    fn test_seed_built_in_scripts() {
        let conn = init_test().unwrap();

        // Seed
        seed_built_in_scripts(&conn).unwrap();
        let scripts = list_scripts(&conn).unwrap();
        assert_eq!(scripts.len(), 7);
        assert!(scripts.iter().all(|s| s.is_built_in));

        // Idempotent — running again doesn't duplicate
        seed_built_in_scripts(&conn).unwrap();
        let scripts = list_scripts(&conn).unwrap();
        assert_eq!(scripts.len(), 7);
    }

    #[test]
    fn test_script_update_preserves_unchanged_fields() {
        let conn = init_test().unwrap();
        let script = insert_script(&conn, "s1", "Original", "Desc", "[{\"type\":\"bash\",\"command\":\"echo hi\"}]", false).unwrap();
        assert_eq!(script.name, "Original");
        assert_eq!(script.description, "Desc");

        // Update only name — description and steps should be preserved
        let updated = update_script(&conn, "s1", Some("New Name"), None, None).unwrap();
        assert_eq!(updated.name, "New Name");
        assert_eq!(updated.description, "Desc");
        assert!(updated.steps.contains("echo hi"));
    }

    #[test]
    fn test_script_get_nonexistent_returns_error() {
        let conn = init_test().unwrap();
        let result = get_script(&conn, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_script_delete_nonexistent_succeeds() {
        let conn = init_test().unwrap();
        // DELETE on nonexistent row succeeds (0 rows affected, no error)
        let result = delete_script(&conn, "nonexistent");
        assert!(result.is_ok());
    }

    #[test]
    fn test_script_list_ordering() {
        let conn = init_test().unwrap();
        // Seed built-ins first
        seed_built_in_scripts(&conn).unwrap();
        // Add a custom script
        insert_script(&conn, "custom-1", "Zebra Script", "Custom", "[]", false).unwrap();
        insert_script(&conn, "custom-2", "Alpha Script", "Custom", "[]", false).unwrap();

        let scripts = list_scripts(&conn).unwrap();
        // Built-in scripts come first (is_built_in DESC), then by name
        assert_eq!(scripts.len(), 9);
        assert!(scripts[0].is_built_in, "Built-ins should come first");
        // Custom scripts should be last, sorted by name
        let custom: Vec<&str> = scripts.iter().filter(|s| !s.is_built_in).map(|s| s.name.as_str()).collect();
        assert_eq!(custom, vec!["Alpha Script", "Zebra Script"]);
    }

    #[test]
    fn test_script_built_in_steps_are_valid_json() {
        let conn = init_test().unwrap();
        seed_built_in_scripts(&conn).unwrap();
        let scripts = list_scripts(&conn).unwrap();

        for script in &scripts {
            let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&script.steps);
            assert!(parsed.is_ok(), "Built-in '{}' has invalid steps JSON: {}", script.name, script.steps);
            let steps = parsed.unwrap();
            assert!(!steps.is_empty(), "Built-in '{}' has no steps", script.name);
        }
    }
}
