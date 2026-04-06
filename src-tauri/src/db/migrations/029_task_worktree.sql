-- Add worktree_path to tasks for per-task git worktree isolation
ALTER TABLE tasks ADD COLUMN worktree_path TEXT;
