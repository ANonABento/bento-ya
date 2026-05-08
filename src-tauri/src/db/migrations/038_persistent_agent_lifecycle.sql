-- Persistent per-task agent lifecycle state.
ALTER TABLE tasks ADD COLUMN last_user_input_at INTEGER;
ALTER TABLE tasks ADD COLUMN held_by_user INTEGER NOT NULL DEFAULT 0;
