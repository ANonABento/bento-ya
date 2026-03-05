pub mod schema;

use chrono::Utc;
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
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

// ─── Data models ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    pub tab_order: i64,
    pub is_active: bool,
    pub config: String,
    pub created_at: String,
    pub updated_at: String,
    // Discord integration fields
    pub discord_guild_id: Option<String>,
    pub discord_category_id: Option<String>,
    pub discord_chef_channel_id: Option<String>,
    pub discord_notifications_channel_id: Option<String>,
    pub discord_enabled: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub icon: String,
    pub position: i64,
    pub color: Option<String>,
    pub visible: bool,
    pub trigger_config: String,
    pub exit_config: String,
    pub auto_advance: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub workspace_id: String,
    pub column_id: String,
    pub title: String,
    pub description: Option<String>,
    pub position: i64,
    pub priority: String,
    pub agent_mode: Option<String>,
    pub branch_name: Option<String>,
    pub files_touched: String,
    pub checklist: Option<String>,
    pub pipeline_state: String,
    pub pipeline_triggered_at: Option<String>,
    pub pipeline_error: Option<String>,
    pub agent_session_id: Option<String>,
    pub last_script_exit_code: Option<i64>,
    pub review_status: Option<String>,
    pub pr_number: Option<i64>,
    pub pr_url: Option<String>,
    // Siege loop fields
    pub siege_iteration: i64,
    pub siege_active: bool,
    pub siege_max_iterations: i64,
    pub siege_last_checked: Option<String>,
    // PR/CI status fields (from GitHub API)
    pub pr_mergeable: Option<String>,
    pub pr_ci_status: Option<String>,
    pub pr_review_decision: Option<String>,
    pub pr_comment_count: i64,
    pub pr_is_draft: bool,
    pub pr_labels: String,
    pub pr_last_fetched: Option<String>,
    pub pr_head_sha: Option<String>,
    // Notification fields
    pub notify_stakeholders: Option<String>,
    pub notification_sent_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub task_id: String,
    pub pid: Option<i64>,
    pub status: String,
    pub pty_cols: i64,
    pub pty_rows: i64,
    pub last_output: Option<String>,
    pub exit_code: Option<i64>,
    pub agent_type: String,
    pub working_dir: Option<String>,
    pub scrollback: Option<String>,
    pub resumable: bool,
    pub cli_session_id: Option<String>,
    pub model: Option<String>,
    pub effort_level: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub task_id: String,
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub effort_level: Option<String>,
    pub tool_calls: Option<String>,
    pub thinking_content: Option<String>,
    pub created_at: String,
}

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
    let default_trigger = r#"{"type":"none","config":{}}"#;
    let default_exit = r#"{"type":"manual","config":{}}"#;
    conn.execute(
        "INSERT INTO columns (id, workspace_id, name, icon, position, visible, trigger_config, exit_config, auto_advance, created_at, updated_at) VALUES (?1, ?2, ?3, 'list', ?4, 1, ?5, ?6, 0, ?7, ?8)",
        params![id, workspace_id, name, position, default_trigger, default_exit, ts, ts],
    )?;
    get_column(conn, &id)
}

pub fn get_column(conn: &Connection, id: &str) -> SqlResult<Column> {
    conn.query_row(
        "SELECT id, workspace_id, name, icon, position, color, visible, trigger_config, exit_config, auto_advance, created_at, updated_at FROM columns WHERE id = ?1",
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
                trigger_config: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| r#"{"type":"none","config":{}}"#.to_string()),
                exit_config: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| r#"{"type":"manual","config":{}}"#.to_string()),
                auto_advance: row.get::<_, i64>(9).unwrap_or(0) != 0,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        },
    )
}

pub fn list_columns(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Column>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, name, icon, position, color, visible, trigger_config, exit_config, auto_advance, created_at, updated_at FROM columns WHERE workspace_id = ?1 ORDER BY position",
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
            trigger_config: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| r#"{"type":"none","config":{}}"#.to_string()),
            exit_config: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| r#"{"type":"manual","config":{}}"#.to_string()),
            auto_advance: row.get::<_, i64>(9).unwrap_or(0) != 0,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
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
    trigger_config: Option<&str>,
    exit_config: Option<&str>,
    auto_advance: Option<bool>,
) -> SqlResult<Column> {
    let current = get_column(conn, id)?;
    let ts = now();
    let new_color = match color {
        Some(c) => c.map(|s| s.to_string()),
        None => current.color.clone(),
    };
    conn.execute(
        "UPDATE columns SET name = ?1, icon = ?2, position = ?3, color = ?4, visible = ?5, trigger_config = ?6, exit_config = ?7, auto_advance = ?8, updated_at = ?9 WHERE id = ?10",
        params![
            name.unwrap_or(&current.name),
            icon.unwrap_or(&current.icon),
            position.unwrap_or(current.position),
            new_color,
            visible.unwrap_or(current.visible) as i64,
            trigger_config.unwrap_or(&current.trigger_config),
            exit_config.unwrap_or(&current.exit_config),
            auto_advance.unwrap_or(current.auto_advance) as i64,
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
        "SELECT id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, pipeline_state, pipeline_triggered_at, pipeline_error, agent_session_id, last_script_exit_code, review_status, pr_number, pr_url, siege_iteration, siege_active, siege_max_iterations, siege_last_checked, pr_mergeable, pr_ci_status, pr_review_decision, pr_comment_count, pr_is_draft, pr_labels, pr_last_fetched, pr_head_sha, notify_stakeholders, notification_sent_at, created_at, updated_at FROM tasks WHERE id = ?1",
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
                branch_name: row.get(8)?,
                files_touched: row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
                checklist: row.get(10)?,
                pipeline_state: row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "idle".to_string()),
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
                pr_labels: row.get::<_, Option<String>>(28)?.unwrap_or_else(|| "[]".to_string()),
                pr_last_fetched: row.get(29)?,
                pr_head_sha: row.get(30)?,
                notify_stakeholders: row.get(31)?,
                notification_sent_at: row.get(32)?,
                created_at: row.get(33)?,
                updated_at: row.get(34)?,
            })
        },
    )
}

pub fn list_tasks(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, pipeline_state, pipeline_triggered_at, pipeline_error, agent_session_id, last_script_exit_code, review_status, pr_number, pr_url, siege_iteration, siege_active, siege_max_iterations, siege_last_checked, pr_mergeable, pr_ci_status, pr_review_decision, pr_comment_count, pr_is_draft, pr_labels, pr_last_fetched, pr_head_sha, notify_stakeholders, notification_sent_at, created_at, updated_at FROM tasks WHERE workspace_id = ?1 ORDER BY column_id, position",
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
            branch_name: row.get(8)?,
            files_touched: row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
            checklist: row.get(10)?,
            pipeline_state: row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "idle".to_string()),
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
            pr_labels: row.get::<_, Option<String>>(28)?.unwrap_or_else(|| "[]".to_string()),
            pr_last_fetched: row.get(29)?,
            pr_head_sha: row.get(30)?,
            notify_stakeholders: row.get(31)?,
            notification_sent_at: row.get(32)?,
            created_at: row.get(33)?,
            updated_at: row.get(34)?,
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
        "SELECT id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, pipeline_state, pipeline_triggered_at, pipeline_error, agent_session_id, last_script_exit_code, review_status, pr_number, pr_url, siege_iteration, siege_active, siege_max_iterations, siege_last_checked, pr_mergeable, pr_ci_status, pr_review_decision, pr_comment_count, pr_is_draft, pr_labels, pr_last_fetched, pr_head_sha, notify_stakeholders, notification_sent_at, created_at, updated_at FROM tasks WHERE column_id = ?1 ORDER BY position",
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
            branch_name: row.get(8)?,
            files_touched: row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
            checklist: row.get(10)?,
            pipeline_state: row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "idle".to_string()),
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
            pr_labels: row.get::<_, Option<String>>(28)?.unwrap_or_else(|| "[]".to_string()),
            pr_last_fetched: row.get(29)?,
            pr_head_sha: row.get(30)?,
            notify_stakeholders: row.get(31)?,
            notification_sent_at: row.get(32)?,
            created_at: row.get(33)?,
            updated_at: row.get(34)?,
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
        "SELECT id, workspace_id, name, icon, position, color, visible, trigger_config, exit_config, auto_advance, created_at, updated_at FROM columns WHERE workspace_id = ?1 AND position > ?2 ORDER BY position LIMIT 1",
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
                trigger_config: row.get::<_, Option<String>>(7)?.unwrap_or_else(|| r#"{"type":"none","config":{}}"#.to_string()),
                exit_config: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| r#"{"type":"manual","config":{}}"#.to_string()),
                auto_advance: row.get::<_, i64>(9).unwrap_or(0) != 0,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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

// ─── Data models: ChatSession & ChatMessage ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub cli_session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub workspace_id: String,
    pub session_id: Option<String>,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorSession {
    pub id: String,
    pub workspace_id: String,
    pub status: String,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

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

// ─── Checklist types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checklist {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub description: Option<String>,
    pub progress: i64,
    pub total_items: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistCategory {
    pub id: String,
    pub checklist_id: String,
    pub name: String,
    pub icon: String,
    pub position: i64,
    pub progress: i64,
    pub total_items: i64,
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: String,
    pub category_id: String,
    pub text: String,
    pub checked: bool,
    pub notes: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

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
        "SELECT id, category_id, text, checked, notes, position, created_at, updated_at FROM checklist_items WHERE id = ?1",
        params![id],
        |row| Ok(ChecklistItem {
            id: row.get(0)?,
            category_id: row.get(1)?,
            text: row.get(2)?,
            checked: row.get::<_, i64>(3)? != 0,
            notes: row.get(4)?,
            position: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }),
    )
}

pub fn list_checklist_items(conn: &Connection, category_id: &str) -> SqlResult<Vec<ChecklistItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, category_id, text, checked, notes, position, created_at, updated_at FROM checklist_items WHERE category_id = ?1 ORDER BY position"
    )?;
    let rows = stmt.query_map(params![category_id], |row| {
        Ok(ChecklistItem {
            id: row.get(0)?,
            category_id: row.get(1)?,
            text: row.get(2)?,
            checked: row.get::<_, i64>(3)? != 0,
            notes: row.get(4)?,
            position: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
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

// ─── Usage tracking types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecord {
    pub id: String,
    pub workspace_id: String,
    pub task_id: Option<String>,
    pub session_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cost_usd: f64,
    pub record_count: i64,
}

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

// ─── Session history types ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub id: String,
    pub session_id: String,
    pub workspace_id: String,
    pub task_id: Option<String>,
    pub snapshot_type: String,
    pub scrollback_snapshot: Option<String>,
    pub command_history: String,
    pub files_modified: String,
    pub duration_ms: i64,
    pub created_at: String,
}

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

// ─── Discord Integration ─────────────────────────────────────────────────────

/// Discord column channel mapping
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordColumnChannel {
    pub id: String,
    pub column_id: String,
    pub discord_channel_id: String,
    pub created_at: String,
}

/// Discord task thread mapping
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordTaskThread {
    pub id: String,
    pub task_id: String,
    pub discord_thread_id: String,
    pub discord_channel_id: String,
    pub is_archived: bool,
    pub created_at: String,
}

/// Update workspace with Discord settings
pub fn update_workspace_discord(
    conn: &Connection,
    workspace_id: &str,
    guild_id: &str,
    category_id: &str,
    chef_channel_id: &str,
    notifications_channel_id: &str,
) -> SqlResult<()> {
    conn.execute(
        "UPDATE workspaces SET discord_guild_id = ?1, discord_category_id = ?2, discord_chef_channel_id = ?3, discord_notifications_channel_id = ?4, discord_enabled = 1 WHERE id = ?5",
        params![guild_id, category_id, chef_channel_id, notifications_channel_id, workspace_id],
    )?;
    Ok(())
}

/// Insert a column-to-channel mapping
pub fn insert_discord_column_channel(
    conn: &Connection,
    column_id: &str,
    discord_channel_id: &str,
) -> SqlResult<DiscordColumnChannel> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO discord_column_channels (id, column_id, discord_channel_id, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, column_id, discord_channel_id, now],
    )?;
    Ok(DiscordColumnChannel {
        id,
        column_id: column_id.to_string(),
        discord_channel_id: discord_channel_id.to_string(),
        created_at: now,
    })
}

/// Get Discord channel for a column
pub fn get_discord_channel_for_column(
    conn: &Connection,
    column_id: &str,
) -> SqlResult<Option<String>> {
    let result: Result<String, _> = conn.query_row(
        "SELECT discord_channel_id FROM discord_column_channels WHERE column_id = ?1",
        params![column_id],
        |row| row.get(0),
    );
    match result {
        Ok(channel_id) => Ok(Some(channel_id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Insert a task-to-thread mapping
pub fn insert_discord_task_thread(
    conn: &Connection,
    task_id: &str,
    discord_thread_id: &str,
    discord_channel_id: &str,
) -> SqlResult<DiscordTaskThread> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO discord_task_threads (id, task_id, discord_thread_id, discord_channel_id, is_archived, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![id, task_id, discord_thread_id, discord_channel_id, now],
    )?;
    Ok(DiscordTaskThread {
        id,
        task_id: task_id.to_string(),
        discord_thread_id: discord_thread_id.to_string(),
        discord_channel_id: discord_channel_id.to_string(),
        is_archived: false,
        created_at: now,
    })
}

/// Get Discord thread for a task
pub fn get_discord_thread_for_task(
    conn: &Connection,
    task_id: &str,
) -> SqlResult<Option<DiscordTaskThread>> {
    let result = conn.query_row(
        "SELECT id, task_id, discord_thread_id, discord_channel_id, is_archived, created_at FROM discord_task_threads WHERE task_id = ?1",
        params![task_id],
        |row| {
            Ok(DiscordTaskThread {
                id: row.get(0)?,
                task_id: row.get(1)?,
                discord_thread_id: row.get(2)?,
                discord_channel_id: row.get(3)?,
                is_archived: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
            })
        },
    );
    match result {
        Ok(thread) => Ok(Some(thread)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Update thread archived status
pub fn update_discord_thread_archived(
    conn: &Connection,
    task_id: &str,
    is_archived: bool,
) -> SqlResult<()> {
    conn.execute(
        "UPDATE discord_task_threads SET is_archived = ?1 WHERE task_id = ?2",
        params![is_archived as i64, task_id],
    )?;
    Ok(())
}

/// Delete Discord mappings for a workspace (cleanup)
pub fn delete_workspace_discord_mappings(conn: &Connection, workspace_id: &str) -> SqlResult<()> {
    // Delete task threads for tasks in this workspace
    conn.execute(
        "DELETE FROM discord_task_threads WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = ?1)",
        params![workspace_id],
    )?;
    // Delete column channels for columns in this workspace
    conn.execute(
        "DELETE FROM discord_column_channels WHERE column_id IN (SELECT id FROM columns WHERE workspace_id = ?1)",
        params![workspace_id],
    )?;
    // Clear workspace discord settings
    conn.execute(
        "UPDATE workspaces SET discord_guild_id = NULL, discord_category_id = NULL, discord_chef_channel_id = NULL, discord_notifications_channel_id = NULL, discord_enabled = 0 WHERE id = ?1",
        params![workspace_id],
    )?;
    Ok(())
}

// ─── Discord Agent Routes ──────────────────────────────────────────────────

/// Agent route for Discord reply handling
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordAgentRoute {
    pub id: String,
    pub task_id: String,
    pub active_session_id: Option<String>,
    pub cli_session_id: Option<String>,
    pub last_interaction_at: Option<String>,
    pub created_at: String,
}

/// Get agent route for a task
pub fn get_discord_agent_route(
    conn: &Connection,
    task_id: &str,
) -> SqlResult<Option<DiscordAgentRoute>> {
    let result = conn.query_row(
        "SELECT id, task_id, active_session_id, cli_session_id, last_interaction_at, created_at FROM discord_agent_routes WHERE task_id = ?1",
        params![task_id],
        |row| {
            Ok(DiscordAgentRoute {
                id: row.get(0)?,
                task_id: row.get(1)?,
                active_session_id: row.get(2)?,
                cli_session_id: row.get(3)?,
                last_interaction_at: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    );
    match result {
        Ok(route) => Ok(Some(route)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Upsert agent route for a task
pub fn upsert_discord_agent_route(
    conn: &Connection,
    task_id: &str,
    active_session_id: Option<&str>,
    cli_session_id: Option<&str>,
) -> SqlResult<DiscordAgentRoute> {
    let now = chrono::Utc::now().to_rfc3339();

    // Check if route exists
    if let Some(existing) = get_discord_agent_route(conn, task_id)? {
        // Update existing
        conn.execute(
            "UPDATE discord_agent_routes SET active_session_id = ?1, cli_session_id = COALESCE(?2, cli_session_id), last_interaction_at = ?3 WHERE task_id = ?4",
            params![active_session_id, cli_session_id, now, task_id],
        )?;
        Ok(DiscordAgentRoute {
            active_session_id: active_session_id.map(|s| s.to_string()),
            cli_session_id: cli_session_id.map(|s| s.to_string()).or(existing.cli_session_id),
            last_interaction_at: Some(now),
            ..existing
        })
    } else {
        // Insert new
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO discord_agent_routes (id, task_id, active_session_id, cli_session_id, last_interaction_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, task_id, active_session_id, cli_session_id, now],
        )?;
        Ok(DiscordAgentRoute {
            id,
            task_id: task_id.to_string(),
            active_session_id: active_session_id.map(|s| s.to_string()),
            cli_session_id: cli_session_id.map(|s| s.to_string()),
            last_interaction_at: Some(now.clone()),
            created_at: now,
        })
    }
}

/// Clear active session for a task (on completion)
pub fn clear_discord_active_session(conn: &Connection, task_id: &str) -> SqlResult<()> {
    conn.execute(
        "UPDATE discord_agent_routes SET active_session_id = NULL WHERE task_id = ?1",
        params![task_id],
    )?;
    Ok(())
}

/// Get thread mapping by Discord thread ID
pub fn get_discord_thread_by_thread_id(
    conn: &Connection,
    discord_thread_id: &str,
) -> SqlResult<Option<DiscordTaskThread>> {
    let result = conn.query_row(
        "SELECT id, task_id, discord_thread_id, discord_channel_id, is_archived, created_at FROM discord_task_threads WHERE discord_thread_id = ?1",
        params![discord_thread_id],
        |row| {
            Ok(DiscordTaskThread {
                id: row.get(0)?,
                task_id: row.get(1)?,
                discord_thread_id: row.get(2)?,
                discord_channel_id: row.get(3)?,
                is_archived: row.get::<_, i64>(4)? == 1,
                created_at: row.get(5)?,
            })
        },
    );
    match result {
        Ok(thread) => Ok(Some(thread)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Check if a channel is a chef channel for any workspace
pub fn is_chef_channel(conn: &Connection, channel_id: &str) -> SqlResult<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM workspaces WHERE discord_chef_channel_id = ?1 AND discord_enabled = 1",
        params![channel_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Get workspace by chef channel ID
pub fn get_workspace_by_chef_channel(
    conn: &Connection,
    channel_id: &str,
) -> SqlResult<Option<Workspace>> {
    let result = conn.query_row(
        "SELECT id, name, repo_path, tab_order, is_active, config, created_at, updated_at, discord_guild_id, discord_category_id, discord_chef_channel_id, discord_notifications_channel_id, discord_enabled FROM workspaces WHERE discord_chef_channel_id = ?1 AND discord_enabled = 1",
        params![channel_id],
        |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                repo_path: row.get(2)?,
                tab_order: row.get(3)?,
                is_active: row.get(4)?,
                config: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                discord_guild_id: row.get(8)?,
                discord_category_id: row.get(9)?,
                discord_chef_channel_id: row.get(10)?,
                discord_notifications_channel_id: row.get(11)?,
                discord_enabled: row.get(12)?,
            })
        },
    );
    match result {
        Ok(workspace) => Ok(Some(workspace)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
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
        // We have 21 migrations: 001-021
        assert_eq!(count, 21);
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

        let updated = update_column(&conn, &col.id, Some("Todo"), None, Some(1), None, None, None, None, None).unwrap();
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
}
