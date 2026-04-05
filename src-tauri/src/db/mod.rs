//! Database layer: SQLite with WAL mode, 27 versioned migrations.
//!
//! Models are in `db/models.rs`. CRUD functions are organized by domain
//! (workspace, column, task, agent, chat, checklist, usage, history).

pub mod models;
pub mod schema;

// Re-export all model types so callers can use db::Workspace, db::Task, etc.
pub use models::*;

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
fn data_dir() -> PathBuf {
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

// Data models are defined in db/models.rs and re-exported via `pub use models::*` above.

// ─── CRUD helpers: Workspace ───────────────────────────────────────────────

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
        "SELECT id, name, repo_path, tab_order, is_active, config, created_at, updated_at, discord_guild_id, discord_category_id, discord_chef_channel_id, discord_notifications_channel_id, discord_enabled FROM workspaces WHERE id = ?1",
        params![id],
        |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                repo_path: row.get(2)?,
                tab_order: row.get(3)?,
                is_active: row.get::<_, i64>(4)? != 0,
                config: row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "{}".to_string()),
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                discord_guild_id: row.get(8)?,
                discord_category_id: row.get(9)?,
                discord_chef_channel_id: row.get(10)?,
                discord_notifications_channel_id: row.get(11)?,
                discord_enabled: row.get(12)?,
            })
        },
    )
}

pub fn list_workspaces(conn: &Connection) -> SqlResult<Vec<Workspace>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, repo_path, tab_order, is_active, config, created_at, updated_at, discord_guild_id, discord_category_id, discord_chef_channel_id, discord_notifications_channel_id, discord_enabled FROM workspaces ORDER BY tab_order",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            repo_path: row.get(2)?,
            tab_order: row.get(3)?,
            is_active: row.get::<_, i64>(4)? != 0,
            config: row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "{}".to_string()),
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            discord_guild_id: row.get(8)?,
            discord_category_id: row.get(9)?,
            discord_chef_channel_id: row.get(10)?,
            discord_notifications_channel_id: row.get(11)?,
            discord_enabled: row.get(12)?,
        })
    })?;
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

// ─── CRUD helpers: Column ──────────────────────────────────────────────────

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
        "SELECT id, workspace_id, name, icon, position, color, visible, triggers, created_at, updated_at FROM columns WHERE id = ?1",
        params![id],
        |row| {
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
        },
    )
}

pub fn list_columns(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Column>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, name, icon, position, color, visible, triggers, created_at, updated_at FROM columns WHERE workspace_id = ?1 ORDER BY position",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
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
    })?;
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

// ─── CRUD helpers: Task ────────────────────────────────────────────────────

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

pub fn get_task(conn: &Connection, id: &str) -> SqlResult<Task> {
    conn.query_row(
        "SELECT id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, pipeline_state, pipeline_triggered_at, pipeline_error, agent_session_id, last_script_exit_code, review_status, pr_number, pr_url, siege_iteration, siege_active, siege_max_iterations, siege_last_checked, pr_mergeable, pr_ci_status, pr_review_decision, pr_comment_count, pr_is_draft, pr_labels, pr_last_fetched, pr_head_sha, notify_stakeholders, notification_sent_at, trigger_overrides, trigger_prompt, last_output, dependencies, blocked, created_at, updated_at, agent_status, queued_at, retry_count, model FROM tasks WHERE id = ?1",
        params![id],
        |row| {
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
                files_touched: row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
                checklist: row.get(10)?,
                pipeline_state: row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "idle".to_string()),
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
                pr_labels: row.get::<_, Option<String>>(28)?.unwrap_or_else(|| "[]".to_string()),
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
            })
        },
    )
}

pub fn list_tasks(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, pipeline_state, pipeline_triggered_at, pipeline_error, agent_session_id, last_script_exit_code, review_status, pr_number, pr_url, siege_iteration, siege_active, siege_max_iterations, siege_last_checked, pr_mergeable, pr_ci_status, pr_review_decision, pr_comment_count, pr_is_draft, pr_labels, pr_last_fetched, pr_head_sha, notify_stakeholders, notification_sent_at, trigger_overrides, trigger_prompt, last_output, dependencies, blocked, created_at, updated_at, agent_status, queued_at, retry_count, model FROM tasks WHERE workspace_id = ?1 ORDER BY column_id, position",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
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
            files_touched: row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
            checklist: row.get(10)?,
            pipeline_state: row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "idle".to_string()),
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
            pr_labels: row.get::<_, Option<String>>(28)?.unwrap_or_else(|| "[]".to_string()),
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
        })
    })?;
    rows.collect()
}

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
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, pipeline_state, pipeline_triggered_at, pipeline_error, agent_session_id, last_script_exit_code, review_status, pr_number, pr_url, siege_iteration, siege_active, siege_max_iterations, siege_last_checked, pr_mergeable, pr_ci_status, pr_review_decision, pr_comment_count, pr_is_draft, pr_labels, pr_last_fetched, pr_head_sha, notify_stakeholders, notification_sent_at, trigger_overrides, trigger_prompt, last_output, dependencies, blocked, created_at, updated_at, agent_status, queued_at, retry_count, model FROM tasks WHERE column_id = ?1 ORDER BY position",
    )?;
    let rows = stmt.query_map(params![column_id], |row| {
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
            files_touched: row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
            checklist: row.get(10)?,
            pipeline_state: row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "idle".to_string()),
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
            pr_labels: row.get::<_, Option<String>>(28)?.unwrap_or_else(|| "[]".to_string()),
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
        })
    })?;
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
        "SELECT id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, pipeline_state, pipeline_triggered_at, pipeline_error, agent_session_id, last_script_exit_code, review_status, pr_number, pr_url, siege_iteration, siege_active, siege_max_iterations, siege_last_checked, pr_mergeable, pr_ci_status, pr_review_decision, pr_comment_count, pr_is_draft, pr_labels, pr_last_fetched, pr_head_sha, notify_stakeholders, notification_sent_at, trigger_overrides, trigger_prompt, last_output, dependencies, blocked, created_at, updated_at, agent_status, queued_at, retry_count, model FROM tasks WHERE workspace_id = ?1 AND agent_status = 'queued' ORDER BY queued_at ASC",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
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
            files_touched: row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
            checklist: row.get(10)?,
            pipeline_state: row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "idle".to_string()),
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
            pr_labels: row.get::<_, Option<String>>(28)?.unwrap_or_else(|| "[]".to_string()),
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
        })
    })?;
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
pub fn start_siege(
    conn: &Connection,
    id: &str,
    max_iterations: Option<i64>,
) -> SqlResult<Task> {
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

/// Get next column in workspace by position
pub fn get_next_column(conn: &Connection, workspace_id: &str, current_position: i64) -> SqlResult<Option<Column>> {
    let result = conn.query_row(
        "SELECT id, workspace_id, name, icon, position, color, visible, triggers, created_at, updated_at FROM columns WHERE workspace_id = ?1 AND position > ?2 ORDER BY position LIMIT 1",
        params![workspace_id, current_position],
        |row| {
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
        },
    );
    match result {
        Ok(col) => Ok(Some(col)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

// ─── CRUD helpers: AgentSession ────────────────────────────────────────────

pub fn insert_agent_session(
    conn: &Connection,
    task_id: &str,
    agent_type: &str,
    working_dir: Option<&str>,
) -> SqlResult<AgentSession> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO agent_sessions (id, task_id, agent_type, working_dir, status, pty_cols, pty_rows, resumable, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'idle', 80, 24, 0, ?5, ?6)",
        params![id, task_id, agent_type, working_dir, ts, ts],
    )?;
    get_agent_session(conn, &id)
}

pub fn get_agent_session(conn: &Connection, id: &str) -> SqlResult<AgentSession> {
    conn.query_row(
        "SELECT id, task_id, pid, status, pty_cols, pty_rows, last_output, exit_code, agent_type, working_dir, scrollback, resumable, cli_session_id, model, effort_level, created_at, updated_at FROM agent_sessions WHERE id = ?1",
        params![id],
        |row| {
            Ok(AgentSession {
                id: row.get(0)?,
                task_id: row.get(1)?,
                pid: row.get(2)?,
                status: row.get(3)?,
                pty_cols: row.get(4)?,
                pty_rows: row.get(5)?,
                last_output: row.get(6)?,
                exit_code: row.get(7)?,
                agent_type: row.get(8)?,
                working_dir: row.get(9)?,
                scrollback: row.get(10)?,
                resumable: row.get::<_, i64>(11)? != 0,
                cli_session_id: row.get(12)?,
                model: row.get(13)?,
                effort_level: row.get(14)?,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
            })
        },
    )
}

pub fn list_agent_sessions(conn: &Connection, task_id: &str) -> SqlResult<Vec<AgentSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, pid, status, pty_cols, pty_rows, last_output, exit_code, agent_type, working_dir, scrollback, resumable, cli_session_id, model, effort_level, created_at, updated_at FROM agent_sessions WHERE task_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        Ok(AgentSession {
            id: row.get(0)?,
            task_id: row.get(1)?,
            pid: row.get(2)?,
            status: row.get(3)?,
            pty_cols: row.get(4)?,
            pty_rows: row.get(5)?,
            last_output: row.get(6)?,
            exit_code: row.get(7)?,
            agent_type: row.get(8)?,
            working_dir: row.get(9)?,
            scrollback: row.get(10)?,
            resumable: row.get::<_, i64>(11)? != 0,
            cli_session_id: row.get(12)?,
            model: row.get(13)?,
            effort_level: row.get(14)?,
            created_at: row.get(15)?,
            updated_at: row.get(16)?,
        })
    })?;
    rows.collect()
}

/// List resumable sessions for a task
pub fn list_resumable_sessions(conn: &Connection, task_id: &str) -> SqlResult<Vec<AgentSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, pid, status, pty_cols, pty_rows, last_output, exit_code, agent_type, working_dir, scrollback, resumable, cli_session_id, model, effort_level, created_at, updated_at FROM agent_sessions WHERE task_id = ?1 AND resumable = 1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        Ok(AgentSession {
            id: row.get(0)?,
            task_id: row.get(1)?,
            pid: row.get(2)?,
            status: row.get(3)?,
            pty_cols: row.get(4)?,
            pty_rows: row.get(5)?,
            last_output: row.get(6)?,
            exit_code: row.get(7)?,
            agent_type: row.get(8)?,
            working_dir: row.get(9)?,
            scrollback: row.get(10)?,
            resumable: row.get::<_, i64>(11)? != 0,
            cli_session_id: row.get(12)?,
            model: row.get(13)?,
            effort_level: row.get(14)?,
            created_at: row.get(15)?,
            updated_at: row.get(16)?,
        })
    })?;
    rows.collect()
}

pub fn update_agent_session(
    conn: &Connection,
    id: &str,
    pid: Option<Option<i64>>,
    status: Option<&str>,
    exit_code: Option<Option<i64>>,
    last_output: Option<Option<&str>>,
    scrollback: Option<Option<&str>>,
    resumable: Option<bool>,
) -> SqlResult<AgentSession> {
    let current = get_agent_session(conn, id)?;
    let ts = now();
    let new_pid = match pid {
        Some(p) => p,
        None => current.pid,
    };
    let new_exit_code = match exit_code {
        Some(e) => e,
        None => current.exit_code,
    };
    let new_last_output = match last_output {
        Some(o) => o.map(|s| s.to_string()),
        None => current.last_output.clone(),
    };
    let new_scrollback = match scrollback {
        Some(s) => s.map(|t| t.to_string()),
        None => current.scrollback.clone(),
    };
    let new_resumable = resumable.unwrap_or(current.resumable);
    conn.execute(
        "UPDATE agent_sessions SET pid = ?1, status = ?2, exit_code = ?3, last_output = ?4, scrollback = ?5, resumable = ?6, updated_at = ?7 WHERE id = ?8",
        params![
            new_pid,
            status.unwrap_or(&current.status),
            new_exit_code,
            new_last_output,
            new_scrollback,
            if new_resumable { 1 } else { 0 },
            ts,
            id,
        ],
    )?;
    get_agent_session(conn, id)
}

pub fn delete_agent_session(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM agent_sessions WHERE id = ?1", params![id])?;
    Ok(())
}

/// Update CLI session fields for an agent session
pub fn update_agent_session_cli(
    conn: &Connection,
    id: &str,
    cli_session_id: Option<&str>,
    model: Option<&str>,
    effort_level: Option<&str>,
) -> SqlResult<AgentSession> {
    let ts = now();
    conn.execute(
        "UPDATE agent_sessions SET cli_session_id = ?1, model = ?2, effort_level = ?3, updated_at = ?4 WHERE id = ?5",
        params![cli_session_id, model, effort_level, ts, id],
    )?;
    get_agent_session(conn, id)
}

/// Count running agent sessions across all tasks
pub fn count_running_agent_sessions(conn: &Connection) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM agent_sessions WHERE status = 'running'",
        [],
        |row| row.get(0),
    )
}

/// Get or create agent session for a task
pub fn get_or_create_agent_session_for_task(
    conn: &Connection,
    task_id: &str,
    agent_type: &str,
    working_dir: Option<&str>,
) -> SqlResult<AgentSession> {
    // Try to find an existing idle session
    let existing: Result<AgentSession, _> = conn.query_row(
        "SELECT id, task_id, pid, status, pty_cols, pty_rows, last_output, exit_code, agent_type, working_dir, scrollback, resumable, cli_session_id, model, effort_level, created_at, updated_at FROM agent_sessions WHERE task_id = ?1 AND status = 'idle' ORDER BY created_at DESC LIMIT 1",
        params![task_id],
        |row| {
            Ok(AgentSession {
                id: row.get(0)?,
                task_id: row.get(1)?,
                pid: row.get(2)?,
                status: row.get(3)?,
                pty_cols: row.get(4)?,
                pty_rows: row.get(5)?,
                last_output: row.get(6)?,
                exit_code: row.get(7)?,
                agent_type: row.get(8)?,
                working_dir: row.get(9)?,
                scrollback: row.get(10)?,
                resumable: row.get::<_, i64>(11)? != 0,
                cli_session_id: row.get(12)?,
                model: row.get(13)?,
                effort_level: row.get(14)?,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
            })
        },
    );

    match existing {
        Ok(session) => Ok(session),
        Err(_) => insert_agent_session(conn, task_id, agent_type, working_dir),
    }
}

// ─── Agent Message CRUD ────────────────────────────────────────────────────

pub fn insert_agent_message(
    conn: &Connection,
    task_id: &str,
    role: &str,
    content: &str,
    model: Option<&str>,
    effort_level: Option<&str>,
    tool_calls: Option<&str>,
    thinking_content: Option<&str>,
) -> SqlResult<AgentMessage> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO agent_messages (id, task_id, role, content, model, effort_level, tool_calls, thinking_content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![id, task_id, role, content, model, effort_level, tool_calls, thinking_content, ts],
    )?;
    get_agent_message(conn, &id)
}

pub fn get_agent_message(conn: &Connection, id: &str) -> SqlResult<AgentMessage> {
    conn.query_row(
        "SELECT id, task_id, role, content, model, effort_level, tool_calls, thinking_content, created_at FROM agent_messages WHERE id = ?1",
        params![id],
        |row| {
            Ok(AgentMessage {
                id: row.get(0)?,
                task_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                model: row.get(4)?,
                effort_level: row.get(5)?,
                tool_calls: row.get(6)?,
                thinking_content: row.get(7)?,
                created_at: row.get(8)?,
            })
        },
    )
}

pub fn list_agent_messages(conn: &Connection, task_id: &str) -> SqlResult<Vec<AgentMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, role, content, model, effort_level, tool_calls, thinking_content, created_at FROM agent_messages WHERE task_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        Ok(AgentMessage {
            id: row.get(0)?,
            task_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            model: row.get(4)?,
            effort_level: row.get(5)?,
            tool_calls: row.get(6)?,
            thinking_content: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn clear_agent_messages(conn: &Connection, task_id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM agent_messages WHERE task_id = ?1", params![task_id])?;
    Ok(())
}

// ChatSession, ChatMessage, and OrchestratorSession are in db/models.rs

// ─── CRUD helpers: ChatSession ──────────────────────────────────────────────

pub fn create_chat_session(conn: &Connection, workspace_id: &str, title: &str) -> SqlResult<ChatSession> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO chat_sessions (id, workspace_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, workspace_id, title, ts, ts],
    )?;
    get_chat_session(conn, &id)
}

pub fn get_chat_session(conn: &Connection, id: &str) -> SqlResult<ChatSession> {
    conn.query_row(
        "SELECT id, workspace_id, title, cli_session_id, created_at, updated_at FROM chat_sessions WHERE id = ?1",
        params![id],
        |row| {
            Ok(ChatSession {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                title: row.get(2)?,
                cli_session_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
}

pub fn list_chat_sessions(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<ChatSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, title, cli_session_id, created_at, updated_at FROM chat_sessions WHERE workspace_id = ?1 ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
        Ok(ChatSession {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            title: row.get(2)?,
            cli_session_id: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn update_chat_session(conn: &Connection, id: &str, title: Option<&str>) -> SqlResult<ChatSession> {
    let ts = now();
    if let Some(t) = title {
        conn.execute(
            "UPDATE chat_sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![t, ts, id],
        )?;
    } else {
        conn.execute(
            "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
            params![ts, id],
        )?;
    }
    get_chat_session(conn, id)
}

pub fn delete_chat_session(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM chat_sessions WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_or_create_active_session(conn: &Connection, workspace_id: &str) -> SqlResult<ChatSession> {
    // Get most recent session or create new one
    let existing = conn.query_row(
        "SELECT id, workspace_id, title, cli_session_id, created_at, updated_at FROM chat_sessions WHERE workspace_id = ?1 ORDER BY updated_at DESC LIMIT 1",
        params![workspace_id],
        |row| {
            Ok(ChatSession {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                title: row.get(2)?,
                cli_session_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    );

    match existing {
        Ok(session) => Ok(session),
        Err(_) => create_chat_session(conn, workspace_id, "New Chat"),
    }
}

/// Update the CLI session ID for a chat session (used for --resume fallback)
pub fn update_chat_session_cli_id(conn: &Connection, id: &str, cli_session_id: Option<&str>) -> SqlResult<()> {
    let ts = now();
    conn.execute(
        "UPDATE chat_sessions SET cli_session_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![cli_session_id, ts, id],
    )?;
    Ok(())
}

// ─── CRUD helpers: ChatMessage ──────────────────────────────────────────────

pub fn insert_chat_message(
    conn: &Connection,
    workspace_id: &str,
    session_id: &str,
    role: &str,
    content: &str,
) -> SqlResult<ChatMessage> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO chat_messages (id, workspace_id, session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, workspace_id, session_id, role, content, ts],
    )?;
    // Update session's updated_at
    let _ = update_chat_session(conn, session_id, None);
    get_chat_message(conn, &id)
}

pub fn get_chat_message(conn: &Connection, id: &str) -> SqlResult<ChatMessage> {
    conn.query_row(
        "SELECT id, workspace_id, session_id, role, content, created_at FROM chat_messages WHERE id = ?1",
        params![id],
        |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                session_id: row.get(2)?,
                role: row.get(3)?,
                content: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
}

pub fn list_chat_messages(conn: &Connection, session_id: &str, limit: Option<i64>) -> SqlResult<Vec<ChatMessage>> {
    let limit_val = limit.unwrap_or(100);
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, session_id, role, content, created_at FROM chat_messages WHERE session_id = ?1 ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![session_id, limit_val], |row| {
        Ok(ChatMessage {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            session_id: row.get(2)?,
            role: row.get(3)?,
            content: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    let mut messages: Vec<ChatMessage> = rows.collect::<SqlResult<Vec<_>>>()?;
    // Reverse to get chronological order
    messages.reverse();
    Ok(messages)
}

pub fn delete_chat_messages(conn: &Connection, session_id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM chat_messages WHERE session_id = ?1", params![session_id])?;
    Ok(())
}

// ─── CRUD helpers: OrchestratorSession ──────────────────────────────────────

pub fn get_or_create_orchestrator_session(conn: &Connection, workspace_id: &str) -> SqlResult<OrchestratorSession> {
    // Try to get existing session
    let existing = conn.query_row(
        "SELECT id, workspace_id, status, last_error, created_at, updated_at FROM orchestrator_sessions WHERE workspace_id = ?1",
        params![workspace_id],
        |row| {
            Ok(OrchestratorSession {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                status: row.get(2)?,
                last_error: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    );

    match existing {
        Ok(session) => Ok(session),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // Create new session
            let id = new_id();
            let ts = now();
            conn.execute(
                "INSERT INTO orchestrator_sessions (id, workspace_id, status, created_at, updated_at) VALUES (?1, ?2, 'idle', ?3, ?4)",
                params![id, workspace_id, ts, ts],
            )?;
            get_orchestrator_session(conn, &id)
        }
        Err(e) => Err(e),
    }
}

pub fn get_orchestrator_session(conn: &Connection, id: &str) -> SqlResult<OrchestratorSession> {
    conn.query_row(
        "SELECT id, workspace_id, status, last_error, created_at, updated_at FROM orchestrator_sessions WHERE id = ?1",
        params![id],
        |row| {
            Ok(OrchestratorSession {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                status: row.get(2)?,
                last_error: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
}

pub fn update_orchestrator_session(
    conn: &Connection,
    id: &str,
    status: Option<&str>,
    last_error: Option<Option<&str>>,
) -> SqlResult<OrchestratorSession> {
    let current = get_orchestrator_session(conn, id)?;
    let ts = now();
    let new_error = match last_error {
        Some(e) => e.map(|s| s.to_string()),
        None => current.last_error.clone(),
    };
    conn.execute(
        "UPDATE orchestrator_sessions SET status = ?1, last_error = ?2, updated_at = ?3 WHERE id = ?4",
        params![
            status.unwrap_or(&current.status),
            new_error,
            ts,
            id,
        ],
    )?;
    get_orchestrator_session(conn, id)
}

// Checklist, ChecklistCategory, ChecklistItem are in db/models.rs

// ─── Checklist CRUD ────────────────────────────────────────────────────────

pub fn insert_checklist(
    conn: &Connection,
    workspace_id: &str,
    name: &str,
    description: Option<&str>,
) -> SqlResult<Checklist> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO checklists (id, workspace_id, name, description, progress, total_items, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6)",
        params![id, workspace_id, name, description, ts, ts],
    )?;
    get_checklist(conn, &id)
}

pub fn get_checklist(conn: &Connection, id: &str) -> SqlResult<Checklist> {
    conn.query_row(
        "SELECT id, workspace_id, name, description, progress, total_items, created_at, updated_at FROM checklists WHERE id = ?1",
        params![id],
        |row| Ok(Checklist {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            progress: row.get(4)?,
            total_items: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }),
    )
}

pub fn get_workspace_checklist(conn: &Connection, workspace_id: &str) -> SqlResult<Option<Checklist>> {
    match conn.query_row(
        "SELECT id, workspace_id, name, description, progress, total_items, created_at, updated_at FROM checklists WHERE workspace_id = ?1",
        params![workspace_id],
        |row| Ok(Checklist {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            progress: row.get(4)?,
            total_items: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }),
    ) {
        Ok(c) => Ok(Some(c)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn delete_checklist(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM checklists WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn insert_checklist_category(
    conn: &Connection,
    checklist_id: &str,
    name: &str,
    icon: &str,
    position: i64,
) -> SqlResult<ChecklistCategory> {
    let id = new_id();
    conn.execute(
        "INSERT INTO checklist_categories (id, checklist_id, name, icon, position, progress, total_items, collapsed) VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 0)",
        params![id, checklist_id, name, icon, position],
    )?;
    // Update checklist total
    recalculate_checklist_progress(conn, checklist_id)?;
    get_checklist_category(conn, &id)
}

pub fn get_checklist_category(conn: &Connection, id: &str) -> SqlResult<ChecklistCategory> {
    conn.query_row(
        "SELECT id, checklist_id, name, icon, position, progress, total_items, collapsed FROM checklist_categories WHERE id = ?1",
        params![id],
        |row| Ok(ChecklistCategory {
            id: row.get(0)?,
            checklist_id: row.get(1)?,
            name: row.get(2)?,
            icon: row.get(3)?,
            position: row.get(4)?,
            progress: row.get(5)?,
            total_items: row.get(6)?,
            collapsed: row.get::<_, i64>(7)? != 0,
        }),
    )
}

pub fn list_checklist_categories(conn: &Connection, checklist_id: &str) -> SqlResult<Vec<ChecklistCategory>> {
    let mut stmt = conn.prepare(
        "SELECT id, checklist_id, name, icon, position, progress, total_items, collapsed FROM checklist_categories WHERE checklist_id = ?1 ORDER BY position"
    )?;
    let rows = stmt.query_map(params![checklist_id], |row| {
        Ok(ChecklistCategory {
            id: row.get(0)?,
            checklist_id: row.get(1)?,
            name: row.get(2)?,
            icon: row.get(3)?,
            position: row.get(4)?,
            progress: row.get(5)?,
            total_items: row.get(6)?,
            collapsed: row.get::<_, i64>(7)? != 0,
        })
    })?;
    rows.collect()
}

pub fn update_checklist_category(
    conn: &Connection,
    id: &str,
    collapsed: Option<bool>,
) -> SqlResult<ChecklistCategory> {
    if let Some(c) = collapsed {
        conn.execute(
            "UPDATE checklist_categories SET collapsed = ?1 WHERE id = ?2",
            params![if c { 1 } else { 0 }, id],
        )?;
    }
    get_checklist_category(conn, id)
}

pub fn insert_checklist_item(
    conn: &Connection,
    category_id: &str,
    text: &str,
    position: i64,
) -> SqlResult<ChecklistItem> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO checklist_items (id, category_id, text, checked, notes, position, created_at, updated_at) VALUES (?1, ?2, ?3, 0, NULL, ?4, ?5, ?6)",
        params![id, category_id, text, position, ts, ts],
    )?;
    // Update category and checklist totals
    let cat = get_checklist_category(conn, category_id)?;
    recalculate_category_progress(conn, category_id)?;
    recalculate_checklist_progress(conn, &cat.checklist_id)?;
    get_checklist_item(conn, &id)
}

pub fn get_checklist_item(conn: &Connection, id: &str) -> SqlResult<ChecklistItem> {
    conn.query_row(
        "SELECT id, category_id, text, checked, notes, position, detect_type, detect_config, auto_detected, linked_task_id, created_at, updated_at FROM checklist_items WHERE id = ?1",
        params![id],
        |row| Ok(ChecklistItem {
            id: row.get(0)?,
            category_id: row.get(1)?,
            text: row.get(2)?,
            checked: row.get::<_, i64>(3)? != 0,
            notes: row.get(4)?,
            position: row.get(5)?,
            detect_type: row.get(6)?,
            detect_config: row.get(7)?,
            auto_detected: row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0,
            linked_task_id: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        }),
    )
}

pub fn list_checklist_items(conn: &Connection, category_id: &str) -> SqlResult<Vec<ChecklistItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, category_id, text, checked, notes, position, detect_type, detect_config, auto_detected, linked_task_id, created_at, updated_at FROM checklist_items WHERE category_id = ?1 ORDER BY position"
    )?;
    let rows = stmt.query_map(params![category_id], |row| {
        Ok(ChecklistItem {
            id: row.get(0)?,
            category_id: row.get(1)?,
            text: row.get(2)?,
            checked: row.get::<_, i64>(3)? != 0,
            notes: row.get(4)?,
            position: row.get(5)?,
            detect_type: row.get(6)?,
            detect_config: row.get(7)?,
            auto_detected: row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0,
            linked_task_id: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn update_checklist_item(
    conn: &Connection,
    id: &str,
    checked: Option<bool>,
    notes: Option<Option<&str>>,
) -> SqlResult<ChecklistItem> {
    let current = get_checklist_item(conn, id)?;
    let ts = now();

    let new_checked = checked.unwrap_or(current.checked);
    let new_notes = match notes {
        Some(n) => n.map(|s| s.to_string()),
        None => current.notes.clone(),
    };

    conn.execute(
        "UPDATE checklist_items SET checked = ?1, notes = ?2, updated_at = ?3 WHERE id = ?4",
        params![if new_checked { 1 } else { 0 }, new_notes, ts, id],
    )?;

    // Update category and checklist progress
    let cat = get_checklist_category(conn, &current.category_id)?;
    recalculate_category_progress(conn, &current.category_id)?;
    recalculate_checklist_progress(conn, &cat.checklist_id)?;

    get_checklist_item(conn, id)
}

fn recalculate_category_progress(conn: &Connection, category_id: &str) -> SqlResult<()> {
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM checklist_items WHERE category_id = ?1",
        params![category_id],
        |row| row.get(0),
    )?;
    let checked: i64 = conn.query_row(
        "SELECT COUNT(*) FROM checklist_items WHERE category_id = ?1 AND checked = 1",
        params![category_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "UPDATE checklist_categories SET progress = ?1, total_items = ?2 WHERE id = ?3",
        params![checked, total, category_id],
    )?;
    Ok(())
}

fn recalculate_checklist_progress(conn: &Connection, checklist_id: &str) -> SqlResult<()> {
    let total: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_items), 0) FROM checklist_categories WHERE checklist_id = ?1",
        params![checklist_id],
        |row| row.get(0),
    )?;
    let checked: i64 = conn.query_row(
        "SELECT COALESCE(SUM(progress), 0) FROM checklist_categories WHERE checklist_id = ?1",
        params![checklist_id],
        |row| row.get(0),
    )?;
    let ts = now();
    conn.execute(
        "UPDATE checklists SET progress = ?1, total_items = ?2, updated_at = ?3 WHERE id = ?4",
        params![checked, total, ts, checklist_id],
    )?;
    Ok(())
}

/// Create a checklist item with detection configuration (used for templates)
pub fn create_checklist_item_with_detect(
    conn: &Connection,
    category_id: &str,
    text: &str,
    position: i64,
    detect_type: Option<&str>,
    detect_config: Option<&str>,
) -> SqlResult<ChecklistItem> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO checklist_items (id, category_id, text, checked, notes, position, detect_type, detect_config, auto_detected, linked_task_id, created_at, updated_at) VALUES (?1, ?2, ?3, 0, NULL, ?4, ?5, ?6, 0, NULL, ?7, ?8)",
        params![id, category_id, text, position, detect_type, detect_config, ts, ts],
    )?;
    // Update category and checklist totals
    let cat = get_checklist_category(conn, category_id)?;
    recalculate_category_progress(conn, category_id)?;
    recalculate_checklist_progress(conn, &cat.checklist_id)?;
    get_checklist_item(conn, &id)
}

/// Update the auto-detected status of a checklist item
pub fn update_checklist_item_auto_detect(
    conn: &Connection,
    id: &str,
    auto_detected: bool,
    checked: bool,
) -> SqlResult<ChecklistItem> {
    let ts = now();
    conn.execute(
        "UPDATE checklist_items SET auto_detected = ?1, checked = ?2, updated_at = ?3 WHERE id = ?4",
        params![if auto_detected { 1 } else { 0 }, if checked { 1 } else { 0 }, ts, id],
    )?;

    // Update category and checklist progress
    let item = get_checklist_item(conn, id)?;
    let cat = get_checklist_category(conn, &item.category_id)?;
    recalculate_category_progress(conn, &item.category_id)?;
    recalculate_checklist_progress(conn, &cat.checklist_id)?;

    get_checklist_item(conn, id)
}

/// Link a checklist item to a task (for "Fix this" feature)
pub fn link_checklist_item_to_task(
    conn: &Connection,
    id: &str,
    task_id: Option<&str>,
) -> SqlResult<ChecklistItem> {
    let ts = now();
    conn.execute(
        "UPDATE checklist_items SET linked_task_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![task_id, ts, id],
    )?;
    get_checklist_item(conn, id)
}

// UsageRecord, UsageSummary are in db/models.rs

// ─── Usage tracking CRUD ───────────────────────────────────────────────────

pub fn insert_usage_record(
    conn: &Connection,
    workspace_id: &str,
    task_id: Option<&str>,
    session_id: Option<&str>,
    provider: &str,
    model: &str,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
) -> SqlResult<UsageRecord> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO usage_records (id, workspace_id, task_id, session_id, provider, model, input_tokens, output_tokens, cost_usd, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, workspace_id, task_id, session_id, provider, model, input_tokens, output_tokens, cost_usd, ts],
    )?;
    get_usage_record(conn, &id)
}

pub fn get_usage_record(conn: &Connection, id: &str) -> SqlResult<UsageRecord> {
    conn.query_row(
        "SELECT id, workspace_id, task_id, session_id, provider, model, input_tokens, output_tokens, cost_usd, created_at FROM usage_records WHERE id = ?1",
        params![id],
        |row| Ok(UsageRecord {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            task_id: row.get(2)?,
            session_id: row.get(3)?,
            provider: row.get(4)?,
            model: row.get(5)?,
            input_tokens: row.get(6)?,
            output_tokens: row.get(7)?,
            cost_usd: row.get(8)?,
            created_at: row.get(9)?,
        }),
    )
}

pub fn list_usage_records(conn: &Connection, workspace_id: &str, limit: Option<i64>) -> SqlResult<Vec<UsageRecord>> {
    let limit_val = limit.unwrap_or(100);
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, task_id, session_id, provider, model, input_tokens, output_tokens, cost_usd, created_at FROM usage_records WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![workspace_id, limit_val], |row| {
        Ok(UsageRecord {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            task_id: row.get(2)?,
            session_id: row.get(3)?,
            provider: row.get(4)?,
            model: row.get(5)?,
            input_tokens: row.get(6)?,
            output_tokens: row.get(7)?,
            cost_usd: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn list_task_usage(conn: &Connection, task_id: &str) -> SqlResult<Vec<UsageRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, task_id, session_id, provider, model, input_tokens, output_tokens, cost_usd, created_at FROM usage_records WHERE task_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        Ok(UsageRecord {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            task_id: row.get(2)?,
            session_id: row.get(3)?,
            provider: row.get(4)?,
            model: row.get(5)?,
            input_tokens: row.get(6)?,
            output_tokens: row.get(7)?,
            cost_usd: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn get_workspace_usage_summary(conn: &Connection, workspace_id: &str) -> SqlResult<UsageSummary> {
    conn.query_row(
        "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(cost_usd), 0.0), COUNT(*) FROM usage_records WHERE workspace_id = ?1",
        params![workspace_id],
        |row| Ok(UsageSummary {
            total_input_tokens: row.get(0)?,
            total_output_tokens: row.get(1)?,
            total_cost_usd: row.get(2)?,
            record_count: row.get(3)?,
        }),
    )
}

pub fn get_task_usage_summary(conn: &Connection, task_id: &str) -> SqlResult<UsageSummary> {
    conn.query_row(
        "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(cost_usd), 0.0), COUNT(*) FROM usage_records WHERE task_id = ?1",
        params![task_id],
        |row| Ok(UsageSummary {
            total_input_tokens: row.get(0)?,
            total_output_tokens: row.get(1)?,
            total_cost_usd: row.get(2)?,
            record_count: row.get(3)?,
        }),
    )
}

pub fn delete_workspace_usage(conn: &Connection, workspace_id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM usage_records WHERE workspace_id = ?1", params![workspace_id])?;
    Ok(())
}

// SessionSnapshot is in db/models.rs

// ─── Session history CRUD ──────────────────────────────────────────────────

pub fn insert_session_snapshot(
    conn: &Connection,
    session_id: &str,
    workspace_id: &str,
    task_id: Option<&str>,
    snapshot_type: &str,
    scrollback_snapshot: Option<&str>,
    command_history: &str,
    files_modified: &str,
    duration_ms: i64,
) -> SqlResult<SessionSnapshot> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO session_snapshots (id, session_id, workspace_id, task_id, snapshot_type, scrollback_snapshot, command_history, files_modified, duration_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, session_id, workspace_id, task_id, snapshot_type, scrollback_snapshot, command_history, files_modified, duration_ms, ts],
    )?;
    get_session_snapshot(conn, &id)
}

pub fn get_session_snapshot(conn: &Connection, id: &str) -> SqlResult<SessionSnapshot> {
    conn.query_row(
        "SELECT id, session_id, workspace_id, task_id, snapshot_type, scrollback_snapshot, command_history, files_modified, duration_ms, created_at FROM session_snapshots WHERE id = ?1",
        params![id],
        |row| Ok(SessionSnapshot {
            id: row.get(0)?,
            session_id: row.get(1)?,
            workspace_id: row.get(2)?,
            task_id: row.get(3)?,
            snapshot_type: row.get(4)?,
            scrollback_snapshot: row.get(5)?,
            command_history: row.get(6)?,
            files_modified: row.get(7)?,
            duration_ms: row.get(8)?,
            created_at: row.get(9)?,
        }),
    )
}

pub fn list_session_snapshots(conn: &Connection, session_id: &str) -> SqlResult<Vec<SessionSnapshot>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, workspace_id, task_id, snapshot_type, scrollback_snapshot, command_history, files_modified, duration_ms, created_at FROM session_snapshots WHERE session_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(SessionSnapshot {
            id: row.get(0)?,
            session_id: row.get(1)?,
            workspace_id: row.get(2)?,
            task_id: row.get(3)?,
            snapshot_type: row.get(4)?,
            scrollback_snapshot: row.get(5)?,
            command_history: row.get(6)?,
            files_modified: row.get(7)?,
            duration_ms: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn list_workspace_history(conn: &Connection, workspace_id: &str, limit: Option<i64>) -> SqlResult<Vec<SessionSnapshot>> {
    let limit_val = limit.unwrap_or(50);
    let mut stmt = conn.prepare(
        "SELECT id, session_id, workspace_id, task_id, snapshot_type, scrollback_snapshot, command_history, files_modified, duration_ms, created_at FROM session_snapshots WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![workspace_id, limit_val], |row| {
        Ok(SessionSnapshot {
            id: row.get(0)?,
            session_id: row.get(1)?,
            workspace_id: row.get(2)?,
            task_id: row.get(3)?,
            snapshot_type: row.get(4)?,
            scrollback_snapshot: row.get(5)?,
            command_history: row.get(6)?,
            files_modified: row.get(7)?,
            duration_ms: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn list_task_history(conn: &Connection, task_id: &str) -> SqlResult<Vec<SessionSnapshot>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, workspace_id, task_id, snapshot_type, scrollback_snapshot, command_history, files_modified, duration_ms, created_at FROM session_snapshots WHERE task_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![task_id], |row| {
        Ok(SessionSnapshot {
            id: row.get(0)?,
            session_id: row.get(1)?,
            workspace_id: row.get(2)?,
            task_id: row.get(3)?,
            snapshot_type: row.get(4)?,
            scrollback_snapshot: row.get(5)?,
            command_history: row.get(6)?,
            files_modified: row.get(7)?,
            duration_ms: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn delete_session_snapshots(conn: &Connection, session_id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM session_snapshots WHERE session_id = ?1", params![session_id])?;
    Ok(())
}

// ─── Notification Functions ────────────────────────────────────────────────

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

/// Clear the notification sent timestamp
pub fn clear_task_notification_sent(conn: &Connection, id: &str) -> SqlResult<Task> {
    let ts = now();
    conn.execute(
        "UPDATE tasks SET notification_sent_at = NULL, updated_at = ?1 WHERE id = ?2",
        params![ts, id],
    )?;
    get_task(conn, id)
}

// ─── CRUD helpers: Script ─────────────────────────────────────────────────

pub fn insert_script(
    conn: &Connection,
    id: &str,
    name: &str,
    description: &str,
    steps: &str,
    is_built_in: bool,
) -> SqlResult<Script> {
    let ts = now();
    conn.execute(
        "INSERT INTO scripts (id, name, description, steps, is_built_in, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, name, description, steps, is_built_in as i64, ts, ts],
    )?;
    get_script(conn, id)
}

pub fn get_script(conn: &Connection, id: &str) -> SqlResult<Script> {
    conn.query_row(
        "SELECT id, name, description, steps, is_built_in, created_at, updated_at FROM scripts WHERE id = ?1",
        params![id],
        |row| {
            Ok(Script {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                steps: row.get(3)?,
                is_built_in: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
}

pub fn list_scripts(conn: &Connection) -> SqlResult<Vec<Script>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, steps, is_built_in, created_at, updated_at FROM scripts ORDER BY is_built_in DESC, name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Script {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            steps: row.get(3)?,
            is_built_in: row.get::<_, i64>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn update_script(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    steps: Option<&str>,
) -> SqlResult<Script> {
    let current = get_script(conn, id)?;
    let ts = now();
    conn.execute(
        "UPDATE scripts SET name = ?1, description = ?2, steps = ?3, updated_at = ?4 WHERE id = ?5",
        params![
            name.unwrap_or(&current.name),
            description.unwrap_or(&current.description),
            steps.unwrap_or(&current.steps),
            ts,
            id,
        ],
    )?;
    get_script(conn, id)
}

pub fn delete_script(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM scripts WHERE id = ?1", params![id])?;
    Ok(())
}

/// Seed built-in scripts if they don't already exist.
pub fn seed_built_in_scripts(conn: &Connection) -> SqlResult<()> {
    let built_ins = vec![
        (
            "code-check",
            "Code Check",
            "Run type-check and linter",
            r#"[{"type":"bash","name":"Type check","command":"npm run type-check"},{"type":"bash","name":"Lint","command":"npm run lint"}]"#,
        ),
        (
            "run-tests",
            "Run Tests",
            "Run the test suite",
            r#"[{"type":"bash","name":"Run tests","command":"npm test"}]"#,
        ),
        (
            "create-pr",
            "Create PR",
            "Create a pull request from the task branch",
            r#"[{"type":"bash","name":"Push branch","command":"git push -u origin HEAD"},{"type":"bash","name":"Create PR","command":"gh pr create --title '{task.title}' --fill"}]"#,
        ),
        (
            "ai-code-review",
            "AI Code Review",
            "Agent reviews the diff and suggests improvements",
            r#"[{"type":"agent","name":"Review code","prompt":"Review the changes on this branch. Check for bugs, security issues, and code quality. Suggest improvements.\n\nTask: {task.title}\n{task.description}","model":"sonnet"}]"#,
        ),
        (
            "full-pipeline",
            "Full Pipeline",
            "Implement, test, review, and create PR",
            r#"[{"type":"agent","name":"Implement","prompt":"{task.title}\n\n{task.description}","command":"/start-task"},{"type":"bash","name":"Type check","command":"npm run type-check"},{"type":"bash","name":"Tests","command":"npm test"},{"type":"check","name":"All green","command":"npm run lint","failMessage":"Lint errors found"},{"type":"bash","name":"Create PR","command":"gh pr create --title '{task.title}' --fill"}]"#,
        ),
    ];

    for (id, name, description, steps) in built_ins {
        // Only insert if not already present (idempotent)
        let exists: bool = conn
            .prepare("SELECT COUNT(*) FROM scripts WHERE id = ?1")?
            .query_row(params![id], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)?;

        if !exists {
            let ts = now();
            conn.execute(
                "INSERT INTO scripts (id, name, description, steps, is_built_in, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
                params![id, name, description, steps, ts, ts],
            )?;
        }
    }

    Ok(())
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
        // We have 28 migrations: 001-028
        assert_eq!(count, 28);
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
        assert_eq!(scripts.len(), 5);
        assert!(scripts.iter().all(|s| s.is_built_in));

        // Idempotent — running again doesn't duplicate
        seed_built_in_scripts(&conn).unwrap();
        let scripts = list_scripts(&conn).unwrap();
        assert_eq!(scripts.len(), 5);
    }
}
