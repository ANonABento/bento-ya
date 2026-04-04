# Bento-ya MCP Server — Implementation Spec

## Goal

Expose bento-ya's kanban board as MCP tools so any agent (choomfie, Claude Code, Cursor, etc.) can manage tasks, trigger pipelines, and check board state. Replaces the Discord sidecar as the external integration layer.

## Architecture

```
Any MCP Client (choomfie, claude code, etc.)
  │
  ├─ stdio or SSE transport
  │
  ▼
bento-ya MCP Server (Rust, runs inside Tauri app)
  │
  ├─ SQLite DB (direct access, same as UI)
  ├─ Pipeline engine (fire triggers, check deps)
  └─ Session registry (spawn agents)
```

The MCP server runs **inside the Tauri app process** — same DB connection, same pipeline engine. No sidecar, no IPC bridge. Just MCP protocol over stdio (for CLI clients) or SSE (for remote clients).

## Phase 1: Remove Discord (cleanup)

**Estimated: 1-2 hours**

Remove all Discord code. This is purely deletion — no replacement logic needed since the MCP server is additive.

### Files to delete entirely
- `src-tauri/src/discord/` (entire directory — mod.rs, bridge.rs, handlers.rs)
- `src-tauri/src/commands/discord.rs`
- `src-tauri/sidecars/discord-bot/` (entire directory)
- `src/lib/ipc/discord.ts`

### Files to edit
- `src-tauri/src/commands/mod.rs` — remove `pub mod discord`
- `src-tauri/src/lib.rs` — remove Discord command registrations (22 commands), Discord managed state, Discord sidecar init
- `src-tauri/src/db/models.rs` — remove 3 Discord structs (DiscordColumnChannel, DiscordTaskThread, DiscordAgentRoute)
- `src-tauri/src/db/mod.rs` — remove 13 Discord DB functions (~250 lines)
- `src-tauri/src/commands/task.rs` — remove Discord sync event emissions (8 lines)
- `src-tauri/src/chat/chef.rs` — remove Discord field init (5 lines)
- `src/lib/ipc/index.ts` — remove discord re-export
- `src/types/settings.ts` — remove DiscordConfig type
- `src/stores/settings-store.ts` — remove Discord config handling
- `src/components/settings/tabs/integrations-tab.tsx` — remove Discord UI section (or entire file if only Discord)

### DB migration
Create `026_remove_discord.sql`:
```sql
DROP TABLE IF EXISTS discord_column_channels;
DROP TABLE IF EXISTS discord_task_threads;
DROP TABLE IF EXISTS discord_agent_routes;
-- Keep workspace discord columns (harmless, avoid ALTER TABLE DROP complexity)
```

### Process files to also remove (Phase 6 completion)
With Discord gone, these are now orphaned:
- `src-tauri/src/process/agent_cli_session.rs` — was only used by Discord handlers
- `src-tauri/src/process/cli_shared.rs` — was only imported by agent_cli_session
- `src-tauri/src/process/agent_runner.rs` — verify if still used by non-Discord code

Keep `pty_manager.rs` — still used by terminal view commands.

## Phase 2: MCP Server (new feature)

**Estimated: 3-4 hours**

### Approach

Use the `rmcp` crate (Rust MCP SDK) to expose tools from within the Tauri app. The MCP server shares the same SQLite connection and pipeline engine.

### Cargo.toml additions
```toml
rmcp = { version = "0.1", features = ["server", "transport-stdio"] }
```

If rmcp isn't mature enough, use raw JSON-RPC over stdio (the MCP protocol is just JSON-RPC 2.0 with specific methods).

### File structure
```
src-tauri/src/mcp/
├── mod.rs          — MCP server setup, tool registry
├── tools.rs        — Tool definitions + handlers
└── transport.rs    — stdio transport (read stdin, write stdout)
```

### Tools to expose

**Board Management (read)**
```
get_workspaces      → list all workspaces
get_board_state     → workspace columns + tasks (full board snapshot)
get_task            → single task details
get_column          → single column details + triggers config
```

**Task Management (write)**
```
create_task         → create task in column (title, description, column?)
update_task         → update title, description, trigger prompt
move_task           → move to column (by name or id)
delete_task         → remove task
```

**Pipeline Control**
```
fire_trigger        → manually fire trigger on task
mark_complete       → mark task pipeline as complete
retry_pipeline      → retry failed task
approve_task        → approve task (quality gate)
reject_task         → reject task (quality gate)
```

**Dependencies**
```
add_dependency      → add dep (blocker task, condition, on_met)
remove_dependency   → remove dep by blocker task id
get_dependencies    → list deps for a task
```

**Agent Management**
```
start_agent         → spawn agent on task
stop_agent          → stop running agent
get_agent_status    → check agent state
```

### Tool Schema Example
```json
{
  "name": "create_task",
  "description": "Create a new task on the kanban board",
  "inputSchema": {
    "type": "object",
    "properties": {
      "workspace": { "type": "string", "description": "Workspace name or ID" },
      "column": { "type": "string", "description": "Column name (default: first column)" },
      "title": { "type": "string", "description": "Task title" },
      "description": { "type": "string", "description": "Task description" }
    },
    "required": ["title"]
  }
}
```

### Column/workspace resolution
Tools accept names OR IDs for columns and workspaces. Internally resolve names to IDs using fuzzy matching (reuse `find_column_id` from executor.rs).

### Transport

**Option A: stdio** (for Claude Code `--plugin-dir` or MCP config)
- MCP server spawned as subprocess
- Reads JSON-RPC from stdin, writes to stdout
- Problem: conflicts with Tauri's use of the process (Tauri app is GUI, not CLI)

**Option B: SSE/HTTP** (recommended for Tauri app)
- MCP server listens on localhost port (e.g., 9315)
- Clients connect via SSE transport
- Works with any MCP client that supports SSE
- No subprocess needed — runs in the Tauri app's tokio runtime

**Option C: Separate binary** (simplest)
- Build a separate CLI binary `bento-mcp` that connects to the same SQLite DB
- Runs as stdio MCP server (standard pattern)
- No Tauri dependency
- Limitation: can't fire triggers (no AppHandle for events)

**Recommendation: Option C** with a twist:
- Separate binary for reads (board state, task info)
- For writes that need pipeline (create_task with trigger, approve), the binary calls the Tauri app's IPC via a local HTTP API
- OR: just access DB directly + call pipeline functions (they only need Connection + AppHandle for events, and events are optional for MCP usage)

Actually, **Option C pure** is best:
- Separate `bento-mcp` binary in the same Cargo workspace
- Shares `db/` and `pipeline/` modules with the Tauri app
- Reads/writes SQLite directly
- Pipeline functions work without AppHandle (events just don't emit to frontend — that's fine, frontend polls via `tasks:changed`)
- stdio transport for standard MCP integration

### Binary structure
```
src-tauri/
├── src/          — existing Tauri app
├── src-mcp/      — new MCP server binary
│   └── main.rs   — MCP server entry point
└── Cargo.toml    — add [[bin]] for bento-mcp
```

Or better as a workspace member:
```
packages/
└── mcp-server/
    ├── Cargo.toml
    └── src/
        └── main.rs
```

Actually simplest: add a `bin/mcp.rs` to the existing crate:
```toml
[[bin]]
name = "bento-mcp"
path = "src/bin/mcp.rs"
```

### MCP server main.rs
```rust
use bento_ya::db;
use bento_ya::pipeline;

fn main() {
    // 1. Find bento-ya DB path (~/.local/share/bento-ya/bento-ya.db or platform-specific)
    // 2. Open SQLite connection
    // 3. Start MCP server on stdio
    // 4. Register tools
    // 5. Handle tool calls by calling db:: and pipeline:: functions
}
```

### MCP config for clients
```json
{
  "mcpServers": {
    "bento-ya": {
      "command": "bento-mcp",
      "args": ["--db", "~/.local/share/bento-ya/bento-ya.db"]
    }
  }
}
```

## Phase 3: Connect Choomfie

**Estimated: 30 min**

Add `bento-ya` as an MCP server in choomfie's config or project `.mcp.json`. Choomfie can then:
- "create a task for fixing the login bug" → calls `create_task`
- "what's on the board?" → calls `get_board_state`
- "approve the rate limiting task" → calls `approve_task`
- "move search API to review" → calls `move_task`

No code changes to choomfie — it already speaks MCP.

## Implementation Order

```
Phase 1 (1-2 hrs) → Remove Discord + orphaned process files
Phase 2 (3-4 hrs) → Build bento-mcp binary with MCP tools
Phase 3 (30 min)  → Connect choomfie via MCP config
```

Total: ~5-6 hours

## What This Replaces

| Discord Feature | MCP Replacement |
|----------------|-----------------|
| Discord bot sidecar (2228 LOC) | MCP server binary (~500 LOC) |
| Chef channel (NL commands) | Any MCP client sends tool calls |
| Task → thread sync | Not needed (board IS the source of truth) |
| Agent output streaming | Agent output stays in bento-ya UI |
| Rate limiting / queue | Not needed (MCP is request/response) |
| Discord settings UI | MCP config JSON |
| 22 Tauri commands | 15 MCP tools |

Net result: **-5,340 lines removed, +500 lines added**
