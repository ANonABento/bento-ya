-- Add agent_session_id to tasks for linking spawned agents
ALTER TABLE tasks ADD COLUMN agent_session_id TEXT;
