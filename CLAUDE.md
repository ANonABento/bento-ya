# KaitenCode

Tauri desktop app for orchestrating AI coding agents. Automated kanban board where columns are pipeline stages with trigger-driven automation.

## Architecture Overview

```
Frontend (React + TypeScript)          Backend (Rust + Tauri)
─────────────────────────────          ──────────────────────────
src/                                   src-tauri/src/
├── components/                        ├── commands/        ← Tauri IPC handlers
│   ├── kanban/      Board + cards     ├── db/              ← SQLite + migrations
│   ├── panel/       Chat interface    │   ├── models.rs    ← All DB model structs
│   ├── settings/    Config tabs       │   └── mod.rs       ← CRUD functions
│   ├── shared/      Reusable atoms    ├── pipeline/        ← Trigger engine
│   ├── layout/      App shell         ├── chat/            ← tmux transport + bridge
│   └── ...          Feature panels    ├── llm/             ← LLM integration
├── hooks/                             ├── config/          ← Settings + feature flags
│   ├── chat-session/  Unified chat    ├── whisper/         ← Voice transcription
│   └── use-*.ts       Feature hooks   └── git/             ← Git operations
├── stores/            Zustand state
├── lib/               Utils + IPC
└── types/             TS definitions
```

## Tech Stack

| Layer | Stack |
|-------|-------|
| Frontend | React 19, TypeScript 5.7, Zustand, TailwindCSS 4, xterm.js |
| Backend | Rust 2021, Tauri 2, SQLite (rusqlite), git2 |
| Build | Vite 6, pnpm |
| Testing | Vitest + Testing Library (frontend), `cargo test` (backend) |

## Key Subsystems

### IPC Layer (`src/lib/ipc/` ↔ `src-tauri/src/commands/`)

All frontend-backend communication goes through Tauri's `invoke()`. The IPC layer at `src/lib/ipc/` is split into 19 domain modules (workspace, column, task, agent, orchestrator, pipeline, etc.) with a barrel re-export in `index.ts`. Backend handlers are in `src-tauri/src/commands/` split by domain (task.rs, agent.rs, orchestrator.rs, etc.).

### Chat System (`src/hooks/chat-session/`)

Unified hook serving both agent (per-task) and orchestrator (workspace-level) chat:
- `types.ts` — ChatMode, StreamingState, UnifiedMessage, config types
- `helpers.ts` — Error extraction, message conversion, context preamble builder
- `use-chat-session.ts` — Main hook: streaming events, message queue, model switching

### Pipeline / Triggers (`src-tauri/src/pipeline/`)

Columns define `on_entry`/`on_exit` triggers. Tasks can override. See `.tickets/_docs/TRIGGERS.md`.

- `mod.rs` — `fire_trigger()` routes V2 triggers (JSON). V1 legacy removed.
- `triggers.rs` — V2 trigger types + execution
- `template.rs` — Prompt variable interpolation (`{task.title}`, `{workspace.path}`, etc.)
- `dependencies.rs` — Task dependency resolution, `on_met` actions

**Action types:** `spawn_cli`, `move_column`, `trigger_task`, `run_script`, `create_pr`, `none`

**Exit criteria:** `manual`, `agent_complete`, `script_success`, `checklist_done`, `time_elapsed`, `pr_approved`, `manual_approval`, `notification_sent`. Supports `auto_advance` and `max_retries`.

**Quality gates:** Columns with `manual_approval` exit criteria show review badges on task cards (Pending/Approved/Rejected). `approve_task` and `reject_task` commands handle the review flow.

**Auto-retry:** When `max_retries` is set on exit criteria, failed triggers automatically re-fire up to N times. Retry count tracked per-task, resets on success.

**Trigger execution:** `spawn_cli` triggers run CLI agents inside per-task **tmux sessions** via `chat::bridge::spawn_cli_trigger_task()`. The CLI command is injected via `tmux send-keys -l` into a fresh `kaitencode_<task_id>` session, with output mirrored to a log file via `tmux pipe-pane` and an exit-code sentinel file written when the agent finishes. Completion is detected via `tmux wait-for`. The same tmux session is what the frontend Terminal panel attaches to — pipeline mode and interactive mode are now the same transport. Exit code determines success/failure. 2-hour timeout kills the session if it hangs. Concurrent limit: `DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS = 5` per workspace (see `src-tauri/src/config/mod.rs`; overridable via workspace config). Triggers fired while at the limit mark the task `queued` instead of spawning.

**Worktree-aware cwd:** `resolve_working_dir()` in triggers.rs picks `task.worktree_path` (if set and exists) over `workspace.repo_path`. Used by `spawn_cli`, `run_script`, and `create_pr` actions. Template variable: `{task.worktree_path}`.

### Per-Task Git Worktrees (`src-tauri/src/git/branch_manager.rs`)

Tasks can have isolated git worktrees so agents don't conflict on branches.

- `create_task_worktree(repo_path, branch, task_id)` — creates at `<repo>/.worktrees/kaitencode-<taskId>/`
- `remove_task_worktree(repo_path, task_id)` — prunes git tracking + removes directory
- Auto-gitignores `.worktrees/` on first creation
- `delete_task` auto-cleans up worktrees (filesystem I/O runs outside DB mutex)
- Tauri commands: `create_task_worktree`, `remove_task_worktree`
- DB: `worktree_path TEXT` column on tasks (migration 029)
- Frontend: purple dot on task cards, "worktree" badge in detail panel

### Unified Chat System (`src-tauri/src/chat/`)

Transport abstraction + session layer with tmux-managed terminal sessions:
- `events.rs` — Unified `ChatEvent` type + JSON parsing + `base64_encode` + `spawn_stderr_reader`
- `transport.rs` — `ChatTransport` trait + `SpawnConfig` + `TransportEvent` + shared constants
- `tmux_transport.rs` — `TmuxTransport` (tmux-managed sessions, proper resize, session persistence)
- `pty_transport.rs` — `PtyTransport` (legacy, kept as fallback)
- `pipe_transport.rs` — `PipeTransport` (structured JSON streaming, chat bubbles)
- `session.rs` — `UnifiedChatSession` (lifecycle: idle/running/suspended, resume ID tracking, pipe + PTY modes)
- `registry.rs` — `SessionRegistry` (max 20 sessions configurable, LRU eviction, idle sweep, bridge tracking)
- `bridge.rs` — `ManagedBridge` (single bridge per task, broadcast-based) + `spawn_cli_trigger_task` (tmux-backed pipeline trigger runner: creates `kaitencode_<task_id>` session, sends command via `send-keys -l`, waits via `tmux wait-for`, captures output via `pipe-pane` log file)
- `gc.rs` — Garbage collector (periodic tmux session cleanup for interactive sessions, orphan detection, idle kill; skips tasks with active pipelines)
- `chef.rs` — ChefSession layer (orchestrator capabilities)

### Agent Execution — One Transport for Everything

Pipeline triggers and the interactive Terminal panel share a single transport: a per-task tmux session named `kaitencode_<task_id>`. The Terminal panel attaches to whatever tmux session the task owns, including one a pipeline trigger spawned. There is no separate Output panel.

**Runtime modes** (see `.tickets/_docs/AGENT_PANEL_MODES.md` for the full design):

| Runtime mode | CLI invocation | Render | Completion signal | Billing bucket (Claude) |
|---|---|---|---|---|
| `headless` (`terminal`) | `claude -p` / `codex exec` piped through jq | xterm.js raw pane | `tmux wait-for` + exit code | Agent SDK credit → API rates |
| `headless` (`managed`/`bubbles`) | same `-p` shape, semantic event stream | chat bubbles in `agent-panel` | same | same |

**Managed (bubbles) mode in triggers — three things it needs that the shared
adapter doesn't provide.** `pipeline::triggers::managed_trigger_turn_args` is
the trigger-only argv builder; `chat::runtime::ClaudeCliAdapter` is shared with
chef sessions and deliberately stays interactive-safe.

1. **`--dangerously-skip-permissions`.** Without it every Edit/Write returns
   "Claude requested permissions to write to …, but you haven't granted it yet"
   and the agent exits 0 having changed nothing — which reads as success.
   Terminal mode has always passed it at command-build time.
2. **Completion handling.** Managed used to stop at `agent_status = completed`
   and never call `pipeline::mark_complete`, so a column with `agent_complete` +
   `auto_advance` worked in terminal mode and silently stalled in managed mode.
   It now marks complete behind the same moved-columns guard the terminal path
   uses, and only after the queued-input replay chain ends.
3. **The auto-commit rescue.** Advancing into a terminal column deletes the
   worktree, so uncommitted agent work would be lost.
   `commands::agent::auto_commit_completed_worktree` now runs *before*
   completion on this path too.

**Argv ordering matters here.** `--allowedTools` is declared `<tools...>` —
variadic — so it swallows following bare words until the next flag. Managed mode
passes the prompt *positionally*, so an agent's flags are spliced in right after
`--print`, where a base flag closes the list. Terminal mode is unaffected: there
the prompt sits behind an explicit `-p`.
| `interactive` | `claude` / `codex` (no `-p`/`exec`); prompt via `tmux send-keys -l` | xterm.js TUI + control bar | `<<<KAITENCODE_DONE:{task_id}>>>` sentinel scraped from pane | Subscription interactive limits |

The legacy DB tokens `'terminal'` and `'managed'` are both headless variants (terminal-render vs bubbles-render). `'interactive'` is the new third value. Resolution hierarchy (narrowest wins): `trigger > task > column > workspace > global > default(headless·bubbles)` — implemented in `pipeline::triggers::resolve_runtime_mode_for_task`.

**Pipeline (headless) mode:**
- Spawns a fresh tmux session via `tmux new-session -d`
- Mirrors output to a log file via `tmux pipe-pane`
- Injects the CLI command via `tmux send-keys -l` + `Enter`
- Detects completion via `tmux wait-for {channel}` against a wrapper that writes exit code to a sentinel file
- 2-hour timeout kills the session if it hangs
- Concurrent limit: 5 per workspace by default (queued tasks auto-promote)
- Used by: `spawn_cli` column triggers when `runtime_mode` resolves to `terminal`/`managed`

**Interactive mode** (gated by `KAITENCODE_INTERACTIVE_MODE_ENABLED=1` until the dev flag is promoted):
- Spawns the real CLI TUI (no `-p`/`exec`) inside the tmux session via `chat::bridge::spawn_interactive_cli` — argv-based dispatch on `InteractiveCli::Claude` vs `InteractiveCli::Codex`
- Waits for the pane to be usable before injecting the initial prompt: a CLI-specific ready glyph as a fast path (Claude: `╭`/`╰` box-drawing chars; Codex: `codex` banner substring), falling back to **pane quiescence** (content unchanged for ~750ms). The budget is 60s and exhausting it is **not** fatal — `ReadinessTracker`/`ReadinessVerdict` return `GiveUp`, and the caller injects anyway and leaves the session alive so the pane stays inspectable. (It used to be a fixed 5s budget that killed the session on miss, which destroyed the evidence for every slow cold start.)
- **The injected prompt is flattened to one line** (`bridge::flatten_for_injection`)
  and Enter is sent after a short settle (`INTERACTIVE_SUBMIT_SETTLE`). Both are
  load-bearing: a multiline `send-keys -l` payload leaves the TUI in multi-line
  input so the following Enter adds a line instead of submitting, and an Enter
  sent immediately after the text is dropped while the composer is still
  ingesting. Either way the prompt sits visible-but-unsent and the trigger waits
  out its 2-hour timeout. Since the default prompt is
  `"<title>\n\nSee .task.md for full spec."`, interactive triggers had never
  actually submitted their own prompt.
- Carries the done-sentinel when the column's exit criteria is `agent_complete` or `manual_approval` — but the mechanism differs per CLI. **Claude:** `--append-system-prompt`. **Codex has no such flag** (verified against codex-cli 0.145.0), so its sentinel is folded into the injected prompt by `append_sentinel_to_prompt`, which must stay newline-free because the prompt goes in as one `send-keys -l` payload.
- Resume is modelled by `InteractiveResume` (`None` / `Id` / `Last`). Codex's `resume` is a **subcommand**, not a flag, and is cwd-filtered — so `resume --last` in a task worktree continues that task's session, and `agent_restart` uses it. Claude needs an explicit session id we don't capture from the TUI, so claude restarts fresh.
- A 2s-cadence watcher (`watch_interactive_sentinel`) scans `tmux capture-pane` for `<<<KAITENCODE_DONE:{task_id}>>>` (after ANSI strip, line-anchored) and runs `mark_complete` on hit
- Same `kaitencode_<task_id>` tmux session — the Terminal panel and the panel's interactive view both attach to it
- 2h hard timeout fires `mark_complete_with_error` if the sentinel never lands
- Completion paths emit telemetry rows to `agent_completion_events` (sentinel / exit_code / manual / timeout / kill) for the Phase 6 fallback decision
- The done-advisory is **persisted** on `tasks.agent_done_signaled_at` (epoch ms, migration 048) as well as emitted, so a "Ready to advance" badge shows on the card even if the panel was never open. Written next to the idle drop in `watch_interactive_sentinel`; cleared in `mark_complete` (the `agent_advance` path) and in `persist_agent_session_started` (a new run supersedes it).

**Per-task control surfaces (interactive mode)** — Tauri commands in `commands::agent_interactive`:
- `agent_inject_message(task_id, message)` — `tmux send-keys -l <message>` + Enter; route the agent panel's input box to this when mode = interactive (otherwise the input would silently spawn a parallel `-p` call)
- `agent_interrupt(task_id)` — `Ctrl+C` via `tmux send-keys C-c`. Works in any mode.
- `agent_pause(task_id)` / `agent_resume(task_id)` — `Ctrl+Z` / `fg` for SIGTSTP-based pause. Tracked via `tasks.agent_paused_at`. GC skips paused sessions.
- `agent_switch_model(task_id, model)` — sends `/model <name>` slash command to the live TUI
- `agent_restart(task_id)` — kills the session and re-spawns with the same trigger config

Clicking a task card mid-trigger still drops you straight into the live agent's tmux pane. The agent panel's view is selected by `useResolvedRuntimeMode`: interactive tasks get `InteractiveAgentView` (xterm + control bar); headless tasks get the existing transcript / terminal toggle. Mode changes force a full child remount via `key={...}`.

### Terminal View (tmux-backed)

Each task gets a tmux session (`kaitencode_{task_id}`) with an embedded terminal panel:
- `TmuxTransport` creates a detached tmux session, then spawns `tmux attach` in a PTY for xterm.js output
- Resize via `tmux resize-window` propagates SIGWINCH — TUI apps (codex, vim, claude) redraw correctly
- `ensure_pty_session` reconnect path resizes PTY to panel dimensions on open
- Sessions persist across app restarts — tmux keeps running, app rediscovers on startup
- `ManagedBridge` forwards broadcast events to frontend (one bridge per task, auto-cancelled on remove)

**Session env must go through `tmux new-session -e KEY=VAL`**, never
`Command::env` on the tmux client. The tmux server is a pre-existing daemon, so
a new pane inherits the *server's* environment, not the client's — everything
set the client way was silently dropped. That is why the `KAITENCODE_PARENT_*`
attribution vars are *also* inlined on the command line as `KEY=val <cmd>`; that
workaround covered only those. A script agent's configured `env`,
`TRIGGER_PROMPT` and `WORKING_DIR` all reached the pane as `<unset>` until this
was fixed (`bridge::tmux_env_args`, verified against tmux 3.4).

**Trigger integration:** `spawn_cli_trigger_task` uses `tmux send-keys -l` for command injection + `tmux wait-for` for completion detection. Exit code read from temp file in app data dir. No sentinel patterns, no shell ready detection — tmux handles session readiness. `.task.md` written to worktree before trigger fires (token optimization — agent reads file instead of getting full spec in prompt).

**Completion detection:** `tmux wait-for {channel}` blocks until the injected command signals completion. 2-hour timeout prevents stuck tasks. Column guard prevents stale triggers from corrupting pipeline state if task moved during execution.

**Agent cancellation:** Moving a task out of a trigger column to a non-trigger column sends Ctrl+C to the tmux session (kills agent process, keeps session alive). Skipped if target column also has a trigger (new agent replaces old).

**Garbage collector** (`gc.rs`): Runs every 5 minutes (configurable). Kills orphaned tmux sessions (task not in DB), kills idle sessions past threshold (default 4h), detects running agents with dead tmux sessions (marks failed).

**Session recovery:** On startup, `recover_tmux_sessions()` discovers existing `kaitencode_*` tmux sessions, logs recovery for tasks still running, kills orphans.

**Settings:** `~/.kaitencode/settings.json` with `max_agent_sessions`, `gc_interval_minutes`, `idle_kill_hours`, `default_agent_cli`, `default_model`, etc. Cached in memory (OnceLock), workspace config column overrides. API: `GET/POST /api/settings`.

Key files: `src/components/panel/terminal-view.tsx`, `src/lib/ipc/terminal.ts`, `.tickets/_docs/INTERACTIVE_AGENT_TERMINAL.md`

### Kaiten Agents / Roster (`src-tauri/src/roster/`, `src/components/roster/`)

An **Agent** is a craftable, reusable *definition* — not a running process. Beware
the naming: `agent_sessions`, `agent_messages`, `commands/agent.rs` and
`src/types/agent.ts` all mean a **running CLI**. Convention: the DB layer names
the thing, the feature layer names the feature.

| Layer | Name |
|---|---|
| table / struct / db module | `agents`, `Agent`, `db/agent.rs` (+ `skills`, `db/skill.rs`) |
| commands | `commands/roster.rs` (`commands/agent.rs` is runtime control) |
| frontend | `types/roster.ts`, `lib/ipc/roster.ts`, `stores/roster-store.ts` |

Both tables are **global** (no `workspace_id`), matching the `scripts` precedent —
"craft once, drop into any column" is the point.

**Runtime-typed config.** `agents.config` is a JSON blob because its *shape*
varies by runtime — that's the feature, not a shortcut. In Rust it's an
internally-tagged enum (`roster::AgentConfig` — `Claude`/`Codex` carry `LlmConfig`,
`Script` carries `ScriptConfig`); the UI mirrors it as the runtime-typed dossier.
`LlmConfig`'s field names are deliberately the reusable half of `SpawnCliAction`
plus chef's `mcp_config_path`/`allowed_tools`, so wiring to the pipeline later is
a mapping, not a redesign.

**The `Runtime` trait** (`kind`/`describe`/`validate`) is a seam with **no
`execute`** — by design. Spawning should reuse `pipeline::spawn::resolve()` when
agents get wired to columns.

Two validations nothing else catches: `agents.runtime` (TEXT) can disagree with
the tag inside `agents.config` — `roster::parse_and_validate` is the only guard,
and `update_agent` validates the *post-merge* state; and an `allowed_tools` list
without an `mcp_config_path` is silently inert at spawn time, so it's rejected.

**Section nav.** `ui-store.activeSection` (`'board' | 'roster'`, persisted)
drives `layout/section-switcher.tsx`, which renders as icon buttons on the LEFT
of the workspace tab bar — same recipe as the right-hand cluster
(`h-8 w-8`, motion scale, 20x20 solid icon, `bg-accent/15 text-accent` active).
Deliberately **not** `viewMode`, which means "is the chat panel open" and is
load-bearing via `isChatOpen`. Orchestrator is not a section yet — it's still a
dock panel inside `Board` with its own geometry.

**Wired into columns.** A `spawn_cli` trigger carries `agent_id`. When set, the
agent supplies the CLI, instructions, tools and its preferred model, and the
column may override **model only** — enforced in `pipeline::spawn::resolve()`
and nowhere else. `roster::plan::plan_for()` turns a definition into spawn
parameters; the `Runtime` trait still has no `execute`.

**Instructions ship as `.agent.md`, not a system-prompt flag.** Written to the
working dir next to `.task.md`, with a newline-free prompt line pointing at it.
There is no flag that spans the three runtimes: codex has none, claude's
`--append-system-prompt` is **last-wins** (verified against 2.1.239) and
interactive mode already spends it on the done-sentinel, and scripts have no
prompt concept. A file also means runtime mode can't change what the agent is
told. Skills render into the same file.

**Script agents** run through the same tmux transport, bypassing the
claude/codex allow-list — that guard is for hand-editable trigger JSON, and an
`agents` row is the same trust level `run_script` already grants. They are
forced to `terminal` mode (managed/interactive assume an LLM CLI) and receive
the prompt via `$TRIGGER_PROMPT`, never as argv.

`commands::roster::get_agent_usage` lists the columns running an agent, across
every workspace; the dossier shows them and the delete confirmation names them.
Deleting is allowed anyway — a fired trigger then fails loudly by name.

**Still v2:** MCP/`/api/*` tools for agents, RAG, typed inputs/outputs,
Orchestrator-as-section, rebrand. Spec:
`.tickets/_docs/specs/KAITEN_AGENTS.md`.

### Database (`src-tauri/src/db/`)

SQLite with WAL mode. 49 versioned migrations (001-049). Both `kaitencode` and `kaitencode-mcp` share the same `rusqlite` build via Cargo workspace, ensuring WAL format compatibility for concurrent access.
- `models.rs` — All 18 model structs (Workspace, Column, Task, AgentSession, ChatSession, etc.)
- `mod.rs` — Init, migrations, re-exports from domain modules, tests
- Domain modules: `workspace.rs`, `column.rs`, `task.rs`, `agent_session.rs`, `agent_message.rs`, `chat_session.rs`, `chat_message.rs`, `orchestrator_session.rs`, `checklist.rs`, `usage.rs`, `history.rs`, `script.rs`
- `schema.rs` — Schema constants

### State Management (`src/stores/`)

Zustand stores, each focused on a single domain:
- `task-store.ts` — Task CRUD, board state
- `column-store.ts` — Column config, ordering
- `workspace-store.ts` — Workspace selection, `update(id, updates)` (optimistic update with rollback)
- `settings-store.ts` — User preferences (persisted)
- `checklist-store.ts` — Production checklists
- `attention-store.ts` — Notification badges
- `templates-store.ts` — Pipeline templates
- `ui-store.ts` — UI state (panels, modals, card expansion). Includes `expandedTaskId` for inline card detail, `activeTaskId`/`viewMode` for chat panel, orchestrator panel geometry, and agent panel width (persisted).
- `agent-streaming-store.ts` — Ephemeral per-task agent streaming data (live cards + chat panel catchup). Stores full content, thinking, and tool calls for trigger-spawned agent catchup when chat panel opens late.
- `script-store.ts` — Zustand store for caching scripts. Methods: `load()` (loads once, skips if loaded), `getScriptName(id)` (lookup by ID). Used by Column component (trigger badge) and Board (loads on mount)

### Frontend Components (`src/components/`)

| Directory | Purpose | Key files |
|-----------|---------|-----------|
| `kanban/` | Board, columns, task cards | `task-card.tsx`, `task-card-expanded.tsx`, `column-config-dialog.tsx` |
| `panel/` | Terminal + chat | `terminal-view.tsx`, `agent-panel.tsx`, `chat-input.tsx` |
| `command-palette/` | Cmd+K command palette | `command-palette.tsx` |
| `settings/` | 7-tab settings panel | `settings-panel.tsx`, `tabs/*.tsx` (`scripts-tab.tsx` has quick-attach dropdown on ScriptCard for attaching scripts to columns) |
| `onboarding/` | First-launch wizard | `onboarding-wizard.tsx` |
| `shared/` | Reusable atoms | `dialog.tsx`, `tooltip.tsx`, `badge.tsx`, `path-picker.tsx`, `resize-handle.tsx` |
| `layout/` | App shell | `board.tsx`, `tab-bar.tsx`, `split-view.tsx` (resizable chat panel) |
| `task-detail/` | Detail sub-sections | `changes-section.tsx`, `commits-section.tsx`, `task-checklist.tsx`, `usage-section.tsx`, `notification-section.tsx`, `siege-status.tsx` |
| `review/` | Code review | `diff-viewer.tsx` |

## Column Triggers System

Unified automation layer for task lifecycle. Columns define `on_entry`/`on_exit` triggers, tasks can override.

**Key files:**
- `src-tauri/src/pipeline/triggers.rs` — V2 trigger types + execution
- `src-tauri/src/pipeline/template.rs` — Prompt variable interpolation
- `src-tauri/src/pipeline/dependencies.rs` — Task dependency resolution
- `src/components/kanban/column-config-dialog.tsx` — Column trigger config UI
- `src/components/kanban/task-settings-modal.tsx` — Task-level overrides

**How triggers route:** `fire_trigger()` in `pipeline/mod.rs` checks `column.triggers` JSON (V2 only). Legacy V1 trigger_config/exit_config columns have been dropped from the DB.

**Dependencies (DAG):** Tasks can depend on other tasks with cycle detection (DFS). Visual SVG bezier lines on the board show dependency relationships. Conditions: `completed`, `moved_to_column`, `agent_complete`. When a blocker completes, `check_dependents()` finds dependents, checks if ALL deps met, executes `on_met` actions. Interactive editor in task settings modal (L key shortcut). Blocked cards show "Waiting for: Task A".

**Model per task:** Each task can specify an AI model (opus/sonnet/haiku). Resolution: task.model > trigger.model > CLI default. Passed as `--model` flag to CLI.

## MCP Server (`mcp-server/`)

Standalone Rust binary exposing the board as MCP tools over stdio. Any MCP client (Claude Code, Cursor, choomfie) can manage tasks externally.

```
mcp-server/
├── Cargo.toml
└── src/main.rs    — 25 tools, ~2.4k lines (incl. test module)
```

**Read-only tools:** get_workspaces, get_board, get_task, list_scripts, list_pipeline_templates, get_pipeline_template

**Task mutation tools:** create_task, update_task, move_task, delete_task, approve_task, reject_task, mark_complete, retry_task, retry_from_start, add_dependency, remove_dependency

**Workspace/column/script tools:** create_workspace, create_column, configure_triggers, create_script, run_script

**Pipeline template tools:** save_pipeline_template, apply_pipeline_template, delete_pipeline_template

**Config:** `{ "command": "kaitencode-mcp" }` — auto-detects DB at `~/.kaitencode/data.db` with platform-specific Tauri data dir fallbacks.

**App requirement:** Most mutation tools route through the Tauri app's HTTP API (port and bearer token discovered via `~/.kaitencode/api.port`) so triggers fire and `tasks:changed` events flow to the UI. If the app isn't running, those tools error out (production builds disable direct-DB fallback; only `cfg!(test)` allows it). Read-only tools work without the app.

**Resolved (was a gap, now fixed):** `mark_complete`, `add_dependency`, `remove_dependency` now route through `/api/mark_complete` + `/api/set_dependencies` (emit `tasks:changed`); source attribution + recursion guard shipped (migration 046 — `created_by_task_id`/`created_by_agent_session_id`, `mcp_max_recursion_depth`). See `.tickets/_docs/MCP_SELF_TASK_WORKFLOW.md` for the self-task pattern.

**Remaining gaps:**
- **No checklist tools.** Checklist is Tauri-IPC-only (15 commands in `commands/checklist.rs`), with zero `/api/*` routes — so no MCP tool can reach it yet. Adding `checklist_update`/`get_checklist` requires a new `/api/*` route first.
- **UI-only ops without MCP coverage:** `update_column`/`delete_column`/`reorder_columns`, `update_script`/`delete_script`, per-task runtime-mode override, and agent control (`inject_message`/`interrupt`/`pause`/`restart`/`switch_model`) — each needs an `/api/*` route before an MCP tool.

## Type System

Frontend types are in `src/types/`:
- `task.ts` — Task, PipelineState
- `column.ts` — Column, ColumnTriggers, TriggerAction, ExitCriteria
- `settings.ts` — GlobalSettings, ProviderConfig, VoiceConfig
- `agent.ts` — AgentMessage, AgentSession
- `workspace.ts` — Workspace
- `events.ts` — Streaming event types
- `attachment.ts` — File attachment types
- `templates.ts` — Pipeline template types

Backend models are in `src-tauri/src/db/models.rs` — each struct maps 1:1 to a DB table.

## Backend → Frontend Events

All backend events use `#[serde(rename_all = "camelCase")]` structs. **Never use raw `json!()` for events** — always use the typed structs/helpers to ensure camelCase field names match frontend expectations.

### Event Helpers
- `pipeline::emit_tasks_changed(app, workspace_id, reason)` — use for any task mutation
- Pipeline events use `PipelineEvent` struct
- Orchestrator events use `OrchestratorEvent` struct

### Key Events
| Event | Direction | Used By |
|-------|-----------|---------|
| `tasks:changed` | Backend → Frontend | `useTaskSync` re-fetches task store |
| `pipeline:running` | Backend → Frontend | Frontend UI shows pipeline state |
| `pipeline:complete` | Backend → Frontend | Frontend UI updates on completion |
| `pty:{taskId}:output` | Backend → Frontend | Terminal view renders PTY output |
| `pty:{taskId}:exit` | Backend → Frontend | Terminal view + `bridge.rs` calls `mark_complete` |
| `orchestrator:stream` | Backend → Frontend | Chat panel shows streaming response |
| `orchestrator:complete` | Backend → Frontend | Chat panel marks response done |

### Pitfall
Backend `json!({ "workspace_id": ... })` → snake_case. Frontend expects `workspaceId` (camelCase). Always use typed structs with `#[serde(rename_all = "camelCase")]` or the existing helper functions.

## Conventions

### TypeScript
- Strict mode, no `any` abuse
- React 19 with hooks (no class components)
- Zustand stores with selectors (not direct consumption)
- TailwindCSS 4 for styling
- ESLint 9 with strict rules

### Rust
- `#[tauri::command(rename_all = "camelCase")]` on all handlers
- Async commands for long-running ops (Tokio)
- `Result<T, AppError>` for command return types
- Events emitted for streaming data (`orchestrator:stream`, `agent:stream`, etc.)

### Testing
- Frontend: Vitest + Testing Library (stores and hooks tested)
- Backend: `cargo test` (67 tests — DB, pipeline, chat module)
- E2E (mock): Playwright against Vite dev server (`e2e/app.spec.ts`)
- E2E (real): WebDriverIO + tauri-webdriver against real Tauri app (`tests/webdriver/`)
- Run: `npx tsc --noEmit` (type-check), `npm run lint`, `cargo check`, `cargo test`

### WebDriver E2E Testing
Real E2E tests run against the actual Tauri app with real Rust backend + SQLite via `tauri-driver` (the crate is **`tauri-driver`**, not `tauri-wd` — `cargo install tauri-driver --locked`).

**Setup (Linux):**
1. Install native deps: `sudo apt install webkit2gtk-driver` (provides `WebKitWebDriver`)
2. Install `tauri-driver` once: `cargo install tauri-driver --locked`
3. Build with webdriver feature: `npm run build:webdriver`
4. Start Vite dev server: `npm run dev` (must be on port 1420)
5. Start `tauri-driver` with an isolated data dir so tests don't pollute the real DB:
   `KAITENCODE_DATA_DIR=/tmp/kaitencode-wdio tauri-driver --port 4444`
6. Run tests: `npm run test:webdriver`

`KAITENCODE_DATA_DIR` is honored by `db::data_dir()` — defaults to `~/.kaitencode/` when unset.

**Key files:**
- `wdio.conf.mjs` — WebDriverIO config. The capability key is `tauri:options.application` (not `binary`); writing `binary` makes `tauri-driver` silently fall back to MiniBrowser and `window.__TAURI_INTERNALS__` ends up undefined.
- `tests/webdriver/core-flow.spec.mjs` — Core pipeline flow tests (17 tests)
- `tests/webdriver/agent-panel.spec.mjs` — Agent panel layout tests (5 tests)
- `src-tauri/Cargo.toml` — `webdriver` feature flag (pulls in `tauri-plugin-webdriver-automation`)
- `src/hooks/use-task-sync.ts` — Listens for `tasks:changed` events to keep UI in sync

**IPC in tests:** Use `executeAsync` (not `executeScript`) for Tauri invoke calls since they return Promises. See the `tauriInvoke()` helper in the test file.

**Task sync:** The pipeline engine emits `tasks:changed` events when it mutates tasks (move_column triggers, pipeline advance, mark complete). The `useTaskSync` hook in the frontend re-fetches the task store on these events.

### MCP App Automation (Claude drives the app)
The `tauri-automation` MCP server wraps tauri-webdriver so Claude Code can interactively drive the running app. Located at `~/tools/mcp-tauri-automation`.

**Prerequisites (two background processes):**
```bash
npm run dev                                                    # Vite on port 1420 (tauri loads from devUrl)
KAITENCODE_DATA_DIR=/tmp/kaitencode-wdio tauri-driver --port 4444    # WebDriver server, isolated data dir
```

**MCP tools:** `launch_app`, `close_app`, `capture_screenshot`, `click_element`, `type_text`, `wait_for_element`, `get_element_text`, `execute_script`, `execute_tauri_command`, `get_page_title`, `get_page_url`, `get_app_state`

**Known quirks:**
- Port 1420 must be free — check `lsof -i :1420` before starting (other Tauri apps may squat it)
- SVG elements can't be clicked directly in WKWebView — click the parent `<button>` instead
- `execute_script` is sync only (WebDriver spec) — use `execute_tauri_command` for async IPC
- `execute_tauri_command` uses `executeAsync` + callback pattern internally to handle Promises
- Tauri 2 uses `window.__TAURI_INTERNALS__` (not `window.__TAURI__` from Tauri 1)

## Pitfalls

### Cursor Styles on macOS WebView

CSS cursor classes (Tailwind's `cursor-pointer`, etc.) do NOT work reliably on macOS WKWebView (Tauri). Use inline styles instead:

```tsx
// WRONG
<div className="cursor-ns-resize">
// CORRECT
<div style={{ cursor: 'row-resize' }}>
```

### Legacy Trigger Types

`src/types/column.ts` still has `@deprecated` types (`TriggerType`, `ExitType`, `TriggerConfig`, `ExitConfig`) and legacy fields on `Column`. These coexist with the V2 `ColumnTriggers` system. The `migrateTriggerConfig()` function converts V1 → V2 format. Don't remove the legacy types until all columns have been migrated.

### CLI Session Model Changes

When the user switches models mid-conversation, the CLI session must be restarted (Claude CLI ignores `--model` on `--resume`). The chat session hook handles this by dropping the resume ID and building a context preamble from previous messages.

### Stale CLI Sessions on App Restart

`cli_session_id` values in the `chat_sessions` DB table reference Claude CLI sessions from previous app instances. These are invalid after restart. Startup cleanup in `lib.rs` clears all stale `cli_session_id` references. If an empty response is received from the CLI, `stream_via_cli` retries without `--resume`.

### PTY Exit Detection on macOS

`portable-pty` and `std::process::Child::wait()` block forever on macOS PTY processes because the master fd keeps the process group alive. The fix uses `libc::waitpid(pid, WNOHANG)` polling in a separate thread with `mem::forget(child)` to prevent destructor interference. See `pty_manager.rs`.

### Event Payload Casing

Backend events must use typed structs with `#[serde(rename_all = "camelCase")]`. Using raw `json!()` produces snake_case field names that don't match frontend expectations. Use `pipeline::emit_tasks_changed()` for task mutations, not manual `app.emit("tasks:changed", json!(...))`.

## Design Docs

- `.tickets/_docs/ARCHITECTURE.md` — System design, subsystem flows
- `.tickets/_docs/TRIGGERS.md` — Column trigger system spec (659 LOC)
- `.tickets/_docs/UNIFIED_CHAT.md` — Unified chat system migration plan (6 phases)
- `.tickets/_docs/STATUS.md` — Feature completion tracking
- `PRODUCT.md` — Comprehensive product specification
