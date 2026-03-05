-- Discord agent routing for reply handling
CREATE TABLE IF NOT EXISTS discord_agent_routes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  active_session_id TEXT,      -- Currently running agent session
  cli_session_id TEXT,         -- For --resume after completion
  last_interaction_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discord_agent_routes_task_id ON discord_agent_routes(task_id);
CREATE INDEX IF NOT EXISTS idx_discord_agent_routes_active ON discord_agent_routes(active_session_id) WHERE active_session_id IS NOT NULL;
