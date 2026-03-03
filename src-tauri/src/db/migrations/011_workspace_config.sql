-- Add config column to workspaces for per-workspace settings
ALTER TABLE workspaces ADD COLUMN config TEXT DEFAULT '{}';
