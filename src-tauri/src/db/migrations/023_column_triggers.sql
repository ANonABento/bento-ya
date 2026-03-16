-- Add unified triggers column to columns table
-- This replaces the separate trigger_config and exit_config columns
-- Old columns kept for backward compatibility during migration

ALTER TABLE columns ADD COLUMN triggers TEXT DEFAULT '{}';

-- Add task trigger fields
ALTER TABLE tasks ADD COLUMN trigger_overrides TEXT DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN trigger_prompt TEXT;
ALTER TABLE tasks ADD COLUMN last_output TEXT;
ALTER TABLE tasks ADD COLUMN dependencies TEXT DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN blocked INTEGER DEFAULT 0;
