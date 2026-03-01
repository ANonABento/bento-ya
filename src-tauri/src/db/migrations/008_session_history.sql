-- Session history for replay functionality
CREATE TABLE IF NOT EXISTS session_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    task_id TEXT,
    snapshot_type TEXT NOT NULL DEFAULT 'checkpoint', -- 'checkpoint', 'complete', 'error'
    scrollback_snapshot TEXT,
    command_history TEXT, -- JSON array of commands
    files_modified TEXT, -- JSON array of file paths
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Indexes for efficient history queries
CREATE INDEX IF NOT EXISTS idx_snapshots_session ON session_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_workspace ON session_snapshots(workspace_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_task ON session_snapshots(task_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON session_snapshots(created_at);
