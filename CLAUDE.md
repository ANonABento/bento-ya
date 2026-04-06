# Bento-ya

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
│   ├── layout/      App shell         ├── process/         ← CLI/PTY management
│   └── ...          Feature panels    ├── llm/             ← LLM integration
├── hooks/                             ├── discord/         ← Discord bridge
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

**Trigger execution:** All trigger types execute directly in the backend via `chat::bridge::spawn_cli_trigger_task()`. No frontend round-trip.

**Worktree-aware cwd:** `resolve_working_dir()` in triggers.rs picks `task.worktree_path` (if set and exists) over `workspace.repo_path`. Used by `spawn_cli`, `run_script`, and `create_pr` actions. Template variable: `{task.worktree_path}`.

### Per-Task Git Worktrees (`src-tauri/src/git/branch_manager.rs`)

Tasks can have isolated git worktrees so agents don't conflict on branches.

- `create_task_worktree(repo_path, branch, task_id)` — creates at `<repo>/.worktrees/bentoya-<taskId>/`
- `remove_task_worktree(repo_path, task_id)` — prunes git tracking + removes directory
- Auto-gitignores `.worktrees/` on first creation
- `delete_task` auto-cleans up worktrees (filesystem I/O runs outside DB mutex)
- Tauri commands: `create_task_worktree`, `remove_task_worktree`
- DB: `worktree_path TEXT` column on tasks (migration 029)
- Frontend: purple dot on task cards, "worktree" badge in detail panel

### Unified Chat System (`src-tauri/src/chat/`)

Transport abstraction + session layer (Phase 1-2 complete, replacing process layer incrementally):
- `events.rs` — Unified `ChatEvent` type + JSON parsing + `base64_encode` + `spawn_stderr_reader` (single source of truth)
- `transport.rs` — `ChatTransport` trait + `SpawnConfig` + `TransportEvent` + shared constants
- `pty_transport.rs` — `PtyTransport` (interactive terminal, xterm.js)
- `pipe_transport.rs` — `PipeTransport` (structured JSON streaming, chat bubbles)
- `session.rs` — `UnifiedChatSession` (lifecycle: idle/running/suspended, resume ID tracking, pipe + PTY modes)
- `registry.rs` — `SessionRegistry` (max concurrent sessions, get-or-create, idle timeout)
- `bridge.rs` — Tauri event bridge (`bridge_pty_to_tauri`) + background trigger runner (`spawn_cli_trigger_task`)

See `.tickets/_docs/UNIFIED_CHAT.md` for the full migration plan (6 phases).

### Process Management (`src-tauri/src/process/`) — legacy, partially replaced

`cli_session.rs` removed in Phase 6, Discord integration removed entirely. Remaining files still load-bearing:
- `agent_cli_session.rs` — Agent CLI sessions (used by agent commands, siege)
- `cli_shared.rs` — Shared CLI process utilities (imported by agent_cli_session)
- `pty_manager.rs` — PTY-based terminal sessions (used by terminal view commands)
- `agent_runner.rs` — Agent queue/lifecycle management

### Database (`src-tauri/src/db/`)

SQLite with WAL mode. 29 versioned migrations (001-028 + scripts). Both `bento-ya` and `bento-mcp` share the same `rusqlite` build via Cargo workspace, ensuring WAL format compatibility for concurrent access.
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
- `ui-store.ts` — UI state (panels, modals)
- `agent-streaming-store.ts` — Ephemeral per-task agent streaming data (live cards + chat panel catchup). Stores full content, thinking, and tool calls for trigger-spawned agent catchup when chat panel opens late.
- `script-store.ts` — Zustand store for caching scripts. Methods: `load()` (loads once, skips if loaded), `getScriptName(id)` (lookup by ID). Used by Column component (trigger badge) and Board (loads on mount)

### Frontend Components (`src/components/`)

| Directory | Purpose | Key files |
|-----------|---------|-----------|
| `kanban/` | Board, columns, task cards | `task-card.tsx`, `task-card-expanded.tsx`, `column-config-dialog.tsx` |
| `panel/` | Chat interfaces | `orchestrator-panel.tsx`, `agent-panel.tsx`, `chat-input.tsx` |
| `command-palette/` | Cmd+K command palette | `command-palette.tsx` |
| `settings/` | 7-tab settings panel | `settings-panel.tsx`, `tabs/*.tsx` (`scripts-tab.tsx` has quick-attach dropdown on ScriptCard for attaching scripts to columns) |
| `onboarding/` | First-launch wizard | `onboarding-wizard.tsx` |
| `shared/` | Reusable atoms | `dialog.tsx`, `tooltip.tsx`, `badge.tsx`, `path-picker.tsx` (directory picker: input + Browse button, uses @tauri-apps/plugin-dialog) |
| `layout/` | App shell | `board.tsx`, `tab-bar.tsx`, `split-view.tsx` (chat-only slide-in panel) |
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
└── src/main.rs    — 19 tools, ~800 lines
```

**Tools:** get_workspaces, get_board, get_task, create_task, update_task, move_task, delete_task, approve_task, reject_task, add_dependency, remove_dependency, mark_complete, retry_task, create_workspace, create_column, configure_triggers, list_scripts, create_script, run_script

**Config:** `{ "command": "bento-mcp" }` — auto-detects DB at `~/.bentoya/data.db`

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
Real E2E tests run against the actual Tauri app with real Rust backend + SQLite via `tauri-webdriver`.

**Setup:**
1. Build with webdriver feature: `cd src-tauri && cargo build --features webdriver`
2. Start Vite dev server: `npm run dev` (must be on port 1420)
3. Start WebDriver server: `tauri-wd --port 4444`
4. Run tests: `npm run test:webdriver`

**Key files:**
- `wdio.conf.mjs` — WebDriverIO config
- `tests/webdriver/core-flow.spec.mjs` — Core pipeline flow tests (17 tests)
- `src-tauri/Cargo.toml` — `webdriver` feature flag
- `src/hooks/use-task-sync.ts` — Listens for `tasks:changed` events to keep UI in sync

**IPC in tests:** Use `executeAsync` (not `executeScript`) for Tauri invoke calls since they return Promises. See the `tauriInvoke()` helper in the test file.

**Task sync:** The pipeline engine emits `tasks:changed` events when it mutates tasks (move_column triggers, pipeline advance, mark complete). The `useTaskSync` hook in the frontend re-fetches the task store on these events.

### MCP App Automation (Claude drives the app)
The `tauri-automation` MCP server wraps tauri-webdriver so Claude Code can interactively drive the running app. Located at `~/tools/mcp-tauri-automation`.

**Prerequisites (two background processes):**
```bash
npm run dev                  # Vite on port 1420 (tauri loads from devUrl)
tauri-wd --port 4444         # WebDriver server
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
