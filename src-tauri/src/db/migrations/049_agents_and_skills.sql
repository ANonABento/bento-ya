-- Kaiten Agents: an agent as a first-class craftable definition.
--
-- Until now an "agent" was a throwaway CLI call inlined into a column's
-- spawn_cli trigger -- per-column, per-workspace, and untyped across runtimes.
-- These tables make it a thing you craft once and (in a later phase) drop into
-- any column. Spec: .tickets/_docs/specs/KAITEN_AGENTS.md
--
-- Both tables are GLOBAL -- no workspace_id -- matching the `scripts` precedent
-- (028_scripts.sql). "Craft once, drop into any column" is the whole point;
-- re-creating the same agent per project would defeat it.
--
-- NOTE on naming: `agent_sessions` / `agent_messages` / `agent_transcript_events`
-- all describe a RUNNING CLI process. This table is the DEFINITION of one, which
-- makes `agent_sessions` read correctly as "a session of an agent".

CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- One-line "what it does", shown under the name in the dossier.
    role TEXT NOT NULL DEFAULT '',
    -- 'claude' | 'codex' | 'script'. Validated at the command layer against
    -- the AgentConfig tagged enum rather than by a CHECK constraint, so adding
    -- a runtime is a code change and not a migration.
    runtime TEXT NOT NULL,
    -- Runtime-typed config JSON. A blob rather than columns BECAUSE the shape
    -- varies by runtime -- that is the feature (the "runtime-typed dossier"),
    -- not a shortcut. Same approach as columns.triggers.
    config TEXT NOT NULL DEFAULT '{}',
    -- {initials, gradientFrom, gradientTo} for the character-select portrait.
    avatar TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Skills existed only as an inert frontend type (src/types/settings.ts) that
-- persisted to localStorage and that no backend code could ever read. Giving
-- them a table now avoids a forced migration the moment an agent actually
-- spawns with skills attached.
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    trigger TEXT NOT NULL DEFAULT '',
    script TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
