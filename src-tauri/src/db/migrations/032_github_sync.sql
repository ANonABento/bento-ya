ALTER TABLE tasks ADD COLUMN github_issue_number INTEGER;
ALTER TABLE tasks ADD COLUMN github_issue_commented INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN github_issue_pr_linked INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS github_sync_state (
    workspace_id TEXT NOT NULL PRIMARY KEY,
    last_synced_at TEXT,
    created_at TEXT NOT NULL
);
