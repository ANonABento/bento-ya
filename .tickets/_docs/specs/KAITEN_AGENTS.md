# Spec — Kaiten Agents (craftable agents + character-select roster)

> Status: **IN PROGRESS** (started 2026-08-21). This session ships the Agent as a
> *definition* + the Roster UI. Pipeline wiring and execution are v2, deliberately.
> Design origin: artifact *"Kaiten Agents — IA & Roster Mockup"* (2026-07-02).

## Goal

Today an agent is a throwaway CLI call inlined into a column trigger. Make an
**Agent** a first-class thing you craft once — runtime, prompt, tools, skills —
and later drop into any column, presented as a game-style character-select roster.

## Why this isn't just "save the trigger config"

A column's `spawn_cli` action (`src/types/column.ts:21-45`) already carries
`cli`, `model`, `prompt_template`, `flags`, `runtime_mode`. But it is:

- **per-column** — the same reviewer gets rebuilt in every column that reviews;
- **per-workspace** — and again in every project;
- **untyped across runtimes** — a script-runner and an LLM share one flat shape,
  so neither gets fields that actually fit it.

An Agent inverts that: config lives with the agent, columns reference it.

## Decisions (locked 2026-08-21)

| Question | Decision |
|---|---|
| Information architecture | **Option B** — left nav rail switching top-level sections; character-select roster lives inside the Roster section (not a full-screen lobby) |
| MVP runtimes | **Claude + Codex + Script**. The generic script runtime is the escape hatch that makes "does anything, incl. video/deploy" real without a bespoke engine |
| Runtime model | **Pluggable seam, few plugins.** Design the trait now; ship no execution engine |
| Config precedence | **Agent owns its config; a column may override *model* only** |
| Agent scope | **Global** — one roster shared across all workspaces |
| Skills | **Build for real** (they are inert today) |
| RAG | v2 |
| Typed inputs/outputs | v2 — agents mutate the task worktree loosely, as triggers do today |
| Rebrand to "Kaiten Agents" | Deferred |

## Naming — read this before touching the code

"Agent" is already the most overloaded word in this repo. `agent_sessions`,
`agent_messages`, `agent_transcript_events`, `commands/agent.rs`,
`src/types/agent.ts` all mean **a running CLI process**. The new entity is a
**definition** of one.

Convention: **the DB layer names the thing; the feature layer names the feature.**

| Layer | Name |
|---|---|
| table / struct / db module | `agents`, `Agent`, `db/agent.rs` |
| commands | `commands/roster.rs` (`commands/agent.rs` is taken — runtime control) |
| frontend | `types/roster.ts`, `lib/ipc/roster.ts`, `stores/roster-store.ts` |

`agent_sessions` then reads correctly as "a session *of* an agent".

## Data model

Migration `049_agents_and_skills.sql`. Both tables are **global** — no
`workspace_id` — matching the `scripts` precedent (`028_scripts.sql`), because
"craft once, drop into any column" is the whole pitch and re-creating the same
agent per project would defeat it.

```sql
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',      -- one-line "what it does"
    runtime TEXT NOT NULL,              -- 'claude' | 'codex' | 'script'
    config TEXT NOT NULL DEFAULT '{}',  -- runtime-typed JSON (see below)
    avatar TEXT NOT NULL DEFAULT '{}',  -- {initials, gradientFrom, gradientTo}
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE skills (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    trigger TEXT NOT NULL DEFAULT '', script TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

### The load-bearing idea: a runtime-typed config

`config` is a JSON blob, not columns, because its **shape varies by runtime** —
that is the feature, not a shortcut. Same approach as `columns.triggers`. In Rust
it is an internally-tagged enum, which buys compile-time exhaustiveness:

```rust
#[serde(tag = "runtime", rename_all = "snake_case")]
pub enum AgentConfig {
    Claude(LlmConfig),
    Codex(LlmConfig),
    Script(ScriptConfig),
}

pub struct LlmConfig {      // system_prompt, model, mcp_config_path,
                            // allowed_tools, skill_ids
pub struct ScriptConfig {   // command, args, env
```

`LlmConfig` is deliberately the *reusable half* of `SpawnCliAction` plus the MCP
pair chef sessions already use (`chat/session.rs:55-57` — `mcp_config_path`,
`allowed_tools`). Keeping those field names identical is what makes the v2 wiring
a mapping rather than a redesign.

The UI mirrors this as the **runtime-typed dossier**: universal fields up top
(name, role, runtime), runtime-specific fields below. A Script agent shows
command/args/env; an LLM agent swaps those for system prompt / model / MCP set /
skills, plus a greyed RAG (v2) slot.

### The Runtime seam

The enum is the registry; a small trait is the seam:

```rust
pub trait Runtime {
    fn kind(&self) -> &'static str;
    fn validate(&self, config: &AgentConfig) -> Result<(), String>;
    fn describe(&self) -> RuntimeDescriptor;
}
```

**There is deliberately no `execute`.** The decision was "design the seam, ship a
few plugins, no execution engine on day one". `spawn`/`resolve` land in v2, where
they reuse the existing `pipeline::spawn::resolve()` rather than duplicating the
cli/model/cwd/prompt precedence that already lives there.

## Skills

`Skill` already exists at `src/types/settings.ts:53` with `skills: Skill[]` on
`GlobalSettings` — but it is **entirely inert**: no UI, no backend reader, and it
persists only to `localStorage` via the zustand `persist` middleware.

So skills get a real table. Putting them in frontend-only settings would place
them somewhere the backend can never read, guaranteeing a migration the moment an
agent actually spawns. The dead `GlobalSettings.skills` field stays for now but is
**no longer a source of truth** — remove it when convenient.

Agents reference skills by id (`skill_ids` in `LlmConfig`). A dangling id renders
as "missing skill" rather than throwing.

**Boundary:** skills become real, persisted, editable and attachable data now.
*Injecting* them into a spawned CLI is execution — that lands with the wiring.

## What v2 (the wiring session) must do

1. **Columns reference an agent.** A `spawn_cli` action gains `agent_id`; when
   set, the agent supplies cli/model/prompt/tools and the column may override
   **model only**. Enforce that in one place — `pipeline::spawn::resolve()`.
2. **Skill injection** into the spawned CLI.
3. **`/api/*` + MCP surface** for agents, following the `create_script` route
   shape in `api.rs` (snake_case bodies) + `emit_entities_changed(app, "", "agent")`
   and a new `'agent'` arm in `EntityKind` / `useEntitySync`.
4. **Orchestrator as a rail section.** It is currently a dock panel inside
   `Board` owning its own dock/size/collapse state and Cmd+J. Promoting it is a
   geometry restructure, so the rail ships Board + Roster first; the rail is
   generic over its items, so adding a third is small once that's untangled.
5. RAG; typed inputs/outputs.

## Non-goals for the first cut

Deploy-to-column · agent execution · MCP/API tools for agents · RAG · typed
I/O · Orchestrator-as-section · rebrand. The precedence rule above is
**specified** here but not implemented — there is nothing to enforce it against
until columns reference agents.
