-- Add archived_at timestamp for soft archive (separate from permanent delete)
ALTER TABLE tasks ADD COLUMN archived_at TEXT;
