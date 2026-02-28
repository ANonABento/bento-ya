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
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    pub tab_order: i64,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Column {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub position: i64,
    pub color: Option<String>,
    pub visible: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub task_id: String,
    pub pid: Option<i64>,
    pub status: String,
    pub pty_cols: i64,
    pub pty_rows: i64,
    pub last_output: Option<String>,
    pub exit_code: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

// ─── CRUD helpers: Workspace ───────────────────────────────────────────────

pub fn insert_workspace(conn: &Connection, name: &str, repo_path: &str) -> SqlResult<Workspace> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO workspaces (id, name, repo_path, tab_order, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)",
        params![id, name, repo_path, ts, ts],
    )?;
    get_workspace(conn, &id)
}

pub fn get_workspace(conn: &Connection, id: &str) -> SqlResult<Workspace> {
    conn.query_row(
        "SELECT id, name, repo_path, tab_order, is_active, created_at, updated_at FROM workspaces WHERE id = ?1",
        params![id],
        |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                repo_path: row.get(2)?,
                tab_order: row.get(3)?,
                is_active: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
}

pub fn list_workspaces(conn: &Connection) -> SqlResult<Vec<Workspace>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, repo_path, tab_order, is_active, created_at, updated_at FROM workspaces ORDER BY tab_order",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            repo_path: row.get(2)?,
            tab_order: row.get(3)?,
            is_active: row.get::<_, i64>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
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
) -> SqlResult<Workspace> {
    let current = get_workspace(conn, id)?;
    let ts = now();
    conn.execute(
        "UPDATE workspaces SET name = ?1, repo_path = ?2, tab_order = ?3, is_active = ?4, updated_at = ?5 WHERE id = ?6",
        params![
            name.unwrap_or(&current.name),
            repo_path.unwrap_or(&current.repo_path),
            tab_order.unwrap_or(current.tab_order),
            is_active.unwrap_or(current.is_active) as i64,
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
        "INSERT INTO columns (id, workspace_id, name, position, visible, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
        params![id, workspace_id, name, position, ts, ts],
    )?;
    get_column(conn, &id)
}

pub fn get_column(conn: &Connection, id: &str) -> SqlResult<Column> {
    conn.query_row(
        "SELECT id, workspace_id, name, position, color, visible, created_at, updated_at FROM columns WHERE id = ?1",
        params![id],
        |row| {
            Ok(Column {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                name: row.get(2)?,
                position: row.get(3)?,
                color: row.get(4)?,
                visible: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
}

pub fn list_columns(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Column>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, name, position, color, visible, created_at, updated_at FROM columns WHERE workspace_id = ?1 ORDER BY position",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
        Ok(Column {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            position: row.get(3)?,
            color: row.get(4)?,
            visible: row.get::<_, i64>(5)? != 0,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn update_column(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    position: Option<i64>,
    color: Option<Option<&str>>,
    visible: Option<bool>,
) -> SqlResult<Column> {
    let current = get_column(conn, id)?;
    let ts = now();
    let new_color = match color {
        Some(c) => c.map(|s| s.to_string()),
        None => current.color.clone(),
    };
    conn.execute(
        "UPDATE columns SET name = ?1, position = ?2, color = ?3, visible = ?4, updated_at = ?5 WHERE id = ?6",
        params![
            name.unwrap_or(&current.name),
            position.unwrap_or(current.position),
            new_color,
            visible.unwrap_or(current.visible) as i64,
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
        "INSERT INTO tasks (id, workspace_id, column_id, title, description, position, priority, files_touched, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'medium', '[]', ?7, ?8)",
        params![id, workspace_id, column_id, title, description, max_pos + 1, ts, ts],
    )?;
    get_task(conn, &id)
}

pub fn get_task(conn: &Connection, id: &str) -> SqlResult<Task> {
    conn.query_row(
        "SELECT id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, created_at, updated_at FROM tasks WHERE id = ?1",
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
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        },
    )
}

pub fn list_tasks(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, column_id, title, description, position, priority, agent_mode, branch_name, files_touched, checklist, created_at, updated_at FROM tasks WHERE workspace_id = ?1 ORDER BY column_id, position",
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
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
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

// ─── CRUD helpers: AgentSession ────────────────────────────────────────────

pub fn insert_agent_session(conn: &Connection, task_id: &str) -> SqlResult<AgentSession> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO agent_sessions (id, task_id, status, pty_cols, pty_rows, created_at, updated_at) VALUES (?1, ?2, 'idle', 80, 24, ?3, ?4)",
        params![id, task_id, ts, ts],
    )?;
    get_agent_session(conn, &id)
}

pub fn get_agent_session(conn: &Connection, id: &str) -> SqlResult<AgentSession> {
    conn.query_row(
        "SELECT id, task_id, pid, status, pty_cols, pty_rows, last_output, exit_code, created_at, updated_at FROM agent_sessions WHERE id = ?1",
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
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        },
    )
}

pub fn list_agent_sessions(conn: &Connection, task_id: &str) -> SqlResult<Vec<AgentSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, pid, status, pty_cols, pty_rows, last_output, exit_code, created_at, updated_at FROM agent_sessions WHERE task_id = ?1",
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
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
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
    conn.execute(
        "UPDATE agent_sessions SET pid = ?1, status = ?2, exit_code = ?3, last_output = ?4, updated_at = ?5 WHERE id = ?6",
        params![
            new_pid,
            status.unwrap_or(&current.status),
            new_exit_code,
            new_last_output,
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
        assert_eq!(count, 1);
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

        let updated = update_workspace(&conn, &ws.id, Some("Renamed"), None, None, Some(true)).unwrap();
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

        let updated = update_column(&conn, &col.id, Some("Todo"), Some(1), None, None).unwrap();
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
        let session = insert_agent_session(&conn, &task.id).unwrap();
        assert_eq!(session.status, "idle");
        assert_eq!(session.pty_cols, 80);
        assert_eq!(session.pty_rows, 24);

        let updated = update_agent_session(&conn, &session.id, Some(Some(12345)), Some("running"), None, None).unwrap();
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
        insert_agent_session(&conn, &task.id).unwrap();

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
