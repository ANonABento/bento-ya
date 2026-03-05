-- Discord workspace mapping
ALTER TABLE workspaces ADD COLUMN discord_guild_id TEXT;
ALTER TABLE workspaces ADD COLUMN discord_category_id TEXT;
ALTER TABLE workspaces ADD COLUMN discord_chef_channel_id TEXT;
ALTER TABLE workspaces ADD COLUMN discord_notifications_channel_id TEXT;
ALTER TABLE workspaces ADD COLUMN discord_enabled INTEGER DEFAULT 0;

-- Column → Channel mapping
CREATE TABLE IF NOT EXISTS discord_column_channels (
  id TEXT PRIMARY KEY,
  column_id TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE,
  UNIQUE(column_id)
);

-- Task → Thread mapping
CREATE TABLE IF NOT EXISTS discord_task_threads (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  discord_thread_id TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  is_archived INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(task_id)
);
