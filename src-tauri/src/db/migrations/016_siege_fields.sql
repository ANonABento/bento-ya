-- Migration 016: Add siege loop fields to tasks table

-- siege_iteration: tracks number of times agent has been spawned to fix PR comments
-- siege_active: whether siege loop is currently running
-- siege_max_iterations: maximum allowed iterations before stopping (default 5)
-- siege_last_checked: when PR status was last polled

ALTER TABLE tasks ADD COLUMN siege_iteration INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN siege_active INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN siege_max_iterations INTEGER DEFAULT 5;
ALTER TABLE tasks ADD COLUMN siege_last_checked TEXT;
