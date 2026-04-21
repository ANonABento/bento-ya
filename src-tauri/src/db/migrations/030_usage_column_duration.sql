-- Add column_name and duration tracking to usage_records
ALTER TABLE usage_records ADD COLUMN column_name TEXT;
ALTER TABLE usage_records ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0;
