-- Soft archive tasks separately from permanent deletion.
ALTER TABLE tasks ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(workspace_id, archived_at);
