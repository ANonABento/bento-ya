-- 022_agent_queue.sql
-- Add agent queue fields for optimistic parallel execution

-- Agent status: idle, queued, running, completed, failed, stopped, needs_attention
ALTER TABLE tasks ADD COLUMN agent_status TEXT DEFAULT 'idle';

-- When task was queued (for ordering in queue)
ALTER TABLE tasks ADD COLUMN queued_at TEXT;

-- Index for efficiently finding queued tasks
CREATE INDEX IF NOT EXISTS idx_tasks_agent_queue ON tasks(agent_status, queued_at);
