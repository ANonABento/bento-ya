//! Schema definitions — source of truth for the v0.1 data model.
//! Migration files should match these definitions.

pub const CREATE_WORKSPACES: &str = "
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    tab_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)";

pub const CREATE_COLUMNS: &str = "
CREATE TABLE IF NOT EXISTS columns (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    visible INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
)";

pub const CREATE_TASKS: &str = "
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    column_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    priority TEXT NOT NULL DEFAULT 'medium',
    agent_mode TEXT,
    branch_name TEXT,
    batch_id TEXT,
    files_touched TEXT DEFAULT '[]',
    checklist TEXT,
    estimated_hours REAL,
    actual_hours REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
)";

pub const CREATE_AGENT_SESSIONS: &str = "
CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    pid INTEGER,
    status TEXT NOT NULL DEFAULT 'idle',
    pty_cols INTEGER NOT NULL DEFAULT 80,
    pty_rows INTEGER NOT NULL DEFAULT 24,
    last_output TEXT,
    exit_code INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
)";

pub const CREATE_INDEXES: &[&str] = &[
    "CREATE INDEX IF NOT EXISTS idx_columns_workspace ON columns(workspace_id, position)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_id, position)",
    "CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(task_id)",
];

pub const CREATE_MIGRATIONS_TABLE: &str = "
CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
)";
