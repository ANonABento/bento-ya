-- Add estimated and actual hour tracking fields to tasks
ALTER TABLE tasks ADD COLUMN estimated_hours REAL NOT NULL DEFAULT 0.0;
ALTER TABLE tasks ADD COLUMN actual_hours REAL NOT NULL DEFAULT 0.0;
