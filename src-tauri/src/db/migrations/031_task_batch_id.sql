-- Group related pipeline tasks into a batch for staging-branch PR workflows.
ALTER TABLE tasks ADD COLUMN batch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(workspace_id, batch_id);
