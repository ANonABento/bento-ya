# Bentoya Session — 2026-04-02

## Goal
Set up autonomous testing + dogfooding for the core pipeline flow. Like Devin's playbook testing — AI finds issues with the app by actually using it.

## Core Flow (what we're testing)
```
Chef creates tasks → Tasks land in Kanban → Column triggers fire →
Agent CLI sessions work the tasks → Tasks auto-advance through columns →
Triggers chain → Tasks complete
```

## Focus Areas

### 1. Automated Testing (CURRENT — Phase 1)

**Research complete.** Three viable options:

| Option | What | Status |
|--------|------|--------|
| **Playwright + Vite** | UI tests against dev server with browser mocks | Already configured, quick to expand |
| **tauri-webdriver** | Real WKWebView E2E via danielraffel/tauri-webdriver | Needs plugin integration |
| **MCP automation** | mcp-tauri-automation wraps WebDriver for Claude Code | Needs tauri-webdriver first |

**Plan:**
1. ~~Expand Playwright tests for core flow~~ Done via WebDriverIO (17 tests, all passing)
2. ~~Integrate `tauri-plugin-webdriver-automation`~~ Done (feature-gated as `webdriver`)
3. ~~Set up MCP integration~~ Done (mcp-tauri-automation registered as MCP server)

**MCP Integration (Claude drives the app):**
```bash
# Terminal 1: Vite dev server (port 1420 — tauri debug binary loads from devUrl)
cd /Users/bentomac/bento-ya && npm run dev

# Terminal 2: WebDriver server
tauri-wd --port 4444

# Then Claude Code can use: launch_app, click_element, type_text,
# capture_screenshot, execute_tauri_command, get_element_text, etc.
```

**Won't work:**
- Official `tauri-driver` — macOS NOT supported (no WKWebView WebDriver from Apple)
- TestDriver.ai — needs visible desktop, not CLI-friendly

### 2. Chat/CLI Layer Issues

**Current:** Chat layer sits on top of Claude CLI, streaming responses through IPC events.

**Problems:**
- Fragile streaming parser (stdout line-by-line)
- Session management complexity (resume, model switch drops session)
- Can't easily import/export messages programmatically

**Proposed:** Swap to embedded CLI layer — auto-start sessions, import messages in/out directly.

**Decision:** Defer until testing is in place. Need to be able to verify changes don't break things.

### 3. Trigger System Simplification

**Current state:** V2 trigger system works but requires structured JSON config.

**Problem:** Users need to manually configure trigger actions as JSON. Too fiddly.

**Proposed simplification:**
- Make trigger config a text field (natural language)
- LLM generates the V2 trigger JSON from the description
- Example: "When a task enters this column, run claude with /start-task on the task" → generates `spawn_cli` action
- Architecture stays the same behind the scenes (V2 JSON format)
- Future: make it less natural-language-dependent, more structured UI

**Decision:** Can implement alongside testing. The trigger architecture is solid, just needs a better input UX.

## Known Issues to Investigate
- [ ] CLI streaming parser reliability (dedup, partial lines)
- [ ] Agent session resume after model switch
- [ ] Trigger V2 config UI usability
- [ ] Exit criteria evaluation timing (polling vs event-driven)
- [ ] Agent queue behavior under load (max 5 concurrent)

## Architecture Notes

### Pipeline Flow (Rust backend)
```
fire_trigger() → check V2 JSON → resolve_trigger() (merge column + task overrides)
  → execute_action() → SpawnCli / MoveColumn / TriggerTask / None
  → emit pipeline:spawn_cli event → frontend picks up → starts CLI session
```

### Key Files
- `src-tauri/src/pipeline/mod.rs` — Pipeline engine, fire_trigger, evaluate_exit_criteria
- `src-tauri/src/pipeline/triggers.rs` — V2 trigger types, resolution, execution
- `src-tauri/src/pipeline/template.rs` — Prompt variable interpolation
- `src-tauri/src/process/cli_session.rs` — CLI process management
- `src-tauri/src/process/agent_cli_session.rs` — Per-task agent sessions
- `src-tauri/src/chat/bridge.rs` — Trigger execution + PTY event bridge
- `src/hooks/chat-session/` — Chat session hook (streaming, model switch)
- `src/lib/browser-mock.ts` — Mock IPC for Playwright tests

### Test Commands
```bash
# Frontend unit tests (128 tests)
cd /Users/bentomac/bento-ya && npm run test:run

# Backend unit tests (67 tests)
cd /Users/bentomac/bento-ya/src-tauri && cargo test --lib

# Type check
cd /Users/bentomac/bento-ya && npx tsc --noEmit

# Lint
cd /Users/bentomac/bento-ya && npm run lint

# E2E (Playwright against Vite dev server)
cd /Users/bentomac/bento-ya && npm run test:e2e

# Rust check
cd /Users/bentomac/bento-ya/src-tauri && cargo check
```

## Session Log

### 2026-04-02 — Research + WebDriver Integration
- Audited bentoya current state: v1.0 complete, 177 tests passing, builds clean
- Researched testing options for Tauri 2 on macOS
- **tauri-webdriver** (danielraffel) is the right path for real WKWebView E2E
- Integrated `tauri-plugin-webdriver-automation` into Rust backend (feature-gated as `webdriver`)
- Installed `tauri-wd` CLI, set up WebDriverIO with mocha framework
- Wrote core-flow E2E test suite: 17 tests covering app launch, IPC, task CRUD, pipeline triggers
- **Results: 17/17 passing** — all tests green
- Found + fixed UI reactivity bug: backend task mutations (pipeline) now emit `tasks:changed` event, frontend `useTaskSync` hook re-fetches store
- Found env issue: another Tauri app (Clanker Spanker) was squatting port 1420
- Pipeline trigger auto-advance verified working end-to-end (move_column trigger)
- Set up mcp-tauri-automation MCP server (cloned to ~/tools/mcp-tauri-automation)
- Registered as MCP server for bento-ya and choomfie projects (project-scoped, not global)
- MCP test drive: launch_app, click_element, capture_screenshot, get_element_text all working
- Found bug: clicking task card opens blank full-screen detail view with no way back (escape doesn't work)
- Found `execute_tauri_command` broken — was using sync execute + wrong Tauri API (`__TAURI__` vs `__TAURI_INTERNALS__`)
- Patched mcp-tauri-automation: now uses `executeAsync` + callback pattern for IPC, supports both Tauri 1 and 2
- Documented all quirks: port 1420 conflicts, SVG click limitation, sync-only executeScript
- Updated CLAUDE.md with full MCP automation docs

### Known Issues
- [ ] **Port 1420 squatting** — other Tauri apps (e.g. Clanker Spanker) can hold port 1420, causing bento-ya to load wrong frontend
- [x] ~~**Task detail blank screen**~~ — FALSE ALARM. Was screenshotting mid-animation (framer-motion `width: 0` → `240px`). The UI works correctly after animation completes. Lesson: always wait for animations before screenshotting.

### What's Set Up (summary)
| Layer | Tool | Status |
|-------|------|--------|
| Rust plugin | `tauri-plugin-webdriver-automation` | Integrated, feature-gated as `webdriver` |
| WebDriver server | `tauri-wd` CLI | Installed at `~/.cargo/bin/tauri-wd` |
| Automated tests | WebDriverIO + mocha | 17/17 passing (`npm run test:webdriver`) |
| MCP automation | `mcp-tauri-automation` | Registered, patched for Tauri 2 IPC |
| Task sync | `useTaskSync` hook + `tasks:changed` event | Wired into App.tsx |
| Unit tests | Vitest (128) + cargo test (49) | All passing, unchanged |
| Trigger NL input | Textarea + generate button in column config | Done — routes through chef/orchestrator |

## Completed: Chef Trigger Tool + Provider Abstraction

### What was done (2026-04-02)

**Phase A: `configure_triggers` tool added to chef**
- Tool definition in `tools.rs` — accepts `column`, `on_entry`, `on_exit`, `exit_criteria`
- Execution in `executor.rs` — `TriggersConfigured` outcome, saves to DB via `db::update_column()`, emits `column:updated`
- CLI action block support in `parse_cli_action_blocks()`
- Both system prompts updated with trigger config docs + board context includes existing triggers per column
- Tests: tool count (5→6), tool names, CLI action block parsing

**Phase B: Provider-based API key resolution**
- `stream_orchestrator_chat` now accepts `api_key_env_var` param
- Backend reads API key from the provider's specified env var (not hardcoded `ANTHROPIC_API_KEY`)
- Frontend threads `apiKeyEnvVar` through `panel-input` → `useChatSession` → IPC
- `orchestrator-panel.tsx` uses provider's `apiKeyEnvVar` for key lookup

**Phase C: Frontend trigger generation routes through chef**
- Removed hardcoded `generate_trigger_config` Tauri command from `pipeline.rs` + `lib.rs`
- Removed `AnthropicClient::complete()` method (dead code)
- Removed `generateTriggerConfig` from `ipc.ts`
- Column-config-dialog "Generate Triggers" button sends message to orchestrator
- Chef uses `configure_triggers` tool → saves to DB → dialog reloads columns

**Phase D: Tests + cleanup**
- 3 new Rust tests: CLI action block with configure_triggers, board context with triggers, system prompt assertions
- Updated tool count test (5→6), tool name test
- Updated `useChatSession` test for new `apiKeyEnvVar` param
- **Results: 52 Rust tests + 128 frontend tests, all passing**

## Completed: Pipeline Bug Fixes + E2E Validation (2026-04-02 continued)

**8 pipeline bugs found and fixed via WebDriver E2E audit:**

1. `executor.rs` — calls `pipeline::fire_trigger()` after TaskCreated/TaskMoved (was missing)
2. `pipeline.rs` — `fire_cli_trigger` uses `start_agent_with_prompt()` (was spawning idle)
3. `agent_runner.rs` — cleans up stale sessions instead of "Agent already running" error
4. `pipeline/mod.rs` — `try_auto_advance` checks V2 `exit_criteria.auto_advance`
5. `pipeline/mod.rs` — `evaluate_exit_criteria` reads V2 triggers JSON, trusts mark_complete for CLI agents
6. `use-pipeline-events.ts` — PTY exit listener registered BEFORE spawning agent (race fix)
7. Chef CLI empty response — caused by stale `--resume` session (startup cleanup fixes this)
8. Chef CLI task creation works with fresh sessions (verified via WebDriver)

**E2E verified:** create task → trigger fires → agent spawns → mark_complete → auto-advance Working→Review

## Completed: Graceful Recovery (2026-04-03)

**11 graceful error handling fixes across 3 phases:**

Phase 1 (HIGH):
- CLI resume fallback — detect empty response, retry without resume, clear dead DB refs
- Startup cleanup — reset stale pipeline states (running/triggered → idle)
- Startup cleanup — clear all stale cli_session_id references
- App close — kill PTY + agent runner processes (was orphaning them)

Phase 2 (MEDIUM):
- Workspace repo_path validation before agent spawn
- Column-deleted guard in fire_trigger
- Error surfacing — log CLI action failures instead of swallowing

Phase 3 (LOW):
- React strict mode listener dedup with cancelled flag
- PTY exit detection via child.wait() + AtomicBool polling (partial — see below)

## Completed: PTY Migration + Exit Detection Fix (2026-04-03 continued)

**Migrated from `portable-pty` to `pty-process` crate.**

portable-pty's `child.wait()` blocked forever on macOS because the PTY master fd kept the process group alive. Tried 4 approaches before finding the fix:

1. Channel from child.wait() — blocked (process group)
2. AtomicBool from child.wait() — same block
3. kill -0 PID polling — zombie not reaped
4. **libc::waitpid(WNOHANG) polling — WORKS** ← final solution

Fix: spawn a watcher thread that calls `libc::waitpid(pid, WNOHANG)` every 250ms. Uses `mem::forget(child)` to prevent Child destructor interference. When waitpid returns the PID (exited), sends on exit channel → `pty:exit` event fires → `markPipelineComplete` → auto-advance.

**E2E verified:** Full automation chain confirmed working end-to-end:
- create task in Working → trigger fires → agent spawns → agent exits → waitpid detects → auto-advance to Review

## Completed: Frontend Task Sync Fix (2026-04-03)

**RCA:** executor.rs emitted `tasks:changed` with snake_case `json!({ "workspace_id": ... })` but `useTaskSync` checks `payload.workspaceId` (camelCase). Event fired but workspace filter never matched.

**Fix:** Replaced raw `json!()` with `pipeline::emit_tasks_changed()` helper which uses `TasksChangedEvent` struct with `#[serde(rename_all = "camelCase")]`.

**Scope:** Only affected tasks created/moved by the orchestrator chef. Frontend-created tasks and pipeline auto-advance already used the correct helper.

## Session Stats (2026-04-02 — 2026-04-03)

**19 commits total:**
- 4 commits: Chef trigger tool + provider abstraction (Phases A-D)
- 8 commits: Pipeline bug fixes (trigger firing, agent spawn, auto-advance, V2 exit criteria)
- 4 commits: Graceful recovery (stale sessions, startup cleanup, process lifecycle)
- 2 commits: PTY migration (portable-pty → pty-process + waitpid)
- 1 commit: Frontend task sync fix (camelCase event payload)

**Test results:** 52 Rust + 128 Frontend = 180 tests, all passing

## Completed: Unified Chat System Phase 1 (2026-04-03)

**Created `src-tauri/src/chat/` module** — transport abstraction layer for the unified chat migration.

Files:
- `events.rs` — `ChatEvent`, `ToolStatus`, JSON parsing, `base64_encode`, `spawn_stderr_reader` (single source of truth)
- `transport.rs` — `ChatTransport` trait, `SpawnConfig`, `TransportEvent`
- `pty_transport.rs` — `PtyTransport` (interactive terminal, waitpid exit detection)
- `pipe_transport.rs` — `PipeTransport` (structured JSON streaming)
- `mod.rs` — re-exports

DRY fixes:
- JSON parsing (150 LOC) consolidated in `chat::events`, legacy `cli_shared.rs` delegates via `From<ChatEvent> for CliEvent`
- `base64_encode` consolidated in `chat::events`, `pty_manager.rs` imports from there
- `spawn_stderr_reader` consolidated in `chat::events`, both transports reuse it
- Eliminated 13 duplicated tests

Bug fix:
- `PipeTransport.alive` now uses `Arc<AtomicBool>` shared with async reader task (was never set to `false` on process exit)

**Test results:** 57 Rust tests, all passing

## Completed: Unified Chat System Phase 2 (2026-04-03)

**Created `UnifiedChatSession` + `SessionRegistry`** — session lifecycle on top of Phase 1 transports.

Files:
- `session.rs` — `UnifiedChatSession` wrapping transport with state machine (Idle/Running/Suspended)
  - Pipe mode: `send_message()` spawns fresh CLI per message, accumulates response, captures resume ID
  - PTY mode: `start_pty()` for interactive, `write_pty()`/`resize_pty()` for input
  - Resume ID auto-cleared on model change (CLI ignores `--model` on `--resume`)
  - Suspend preserves resume ID, kill clears it
- `registry.rs` — `SessionRegistry` with max concurrent sessions (default 5)
  - `get_or_create()` for trigger integration (lazy session creation)
  - `suspend_idle()` for idle timeout cleanup
  - `SharedSessionRegistry` (Arc<Mutex>) for Tauri managed state

**Test results:** 67 Rust tests, all passing (10 new)

## Completed: Unified Chat System Phase 3a (2026-04-03)

**V2 SpawnCli triggers now execute directly in the backend** — no frontend round-trip.

Old flow: backend emits `pipeline:spawn_cli` → frontend catches → frontend calls `fire_cli_trigger` IPC → backend spawns PTY
New flow: backend spawns PTY directly in a background tokio task, bridges events to frontend, calls `mark_complete` on exit

Files:
- `bridge.rs` — `bridge_pty_to_tauri()` + `spawn_cli_trigger_task()` background runner
- `triggers.rs` — SpawnCli branch spawns background task instead of emitting event
- `lib.rs` — `SharedSessionRegistry` registered as managed state + shutdown cleanup

**Test results:** 67 Rust tests, all passing

## Completed: Unified Chat System Phase 3b (2026-04-03)

**All legacy V1 triggers now execute directly in the backend.**

- Agent triggers: `spawn_cli_trigger_task(agent_type, [], working_dir, "", None)`
- Skill triggers: `spawn_cli_trigger_task("claude", [], working_dir, "/{skill}", None)`
- Script triggers: parse command+args from script_path, `spawn_cli_trigger_task(cmd, args, working_dir, "", env_vars)`
- Added `args` parameter to `spawn_cli_trigger_task` for script support
- All trigger types now go Triggered → Running in a single function call (no frontend delay)

**Test results:** 67 Rust tests, all passing

## Completed: Unified Chat System Phase 3c (2026-04-03)

**Removed all dead trigger relay code.**

Backend:
- Removed `fire_agent_trigger`, `fire_cli_trigger`, `fire_script_trigger`, `fire_skill_trigger` from commands + invoke_handler
- Removed `SpawnAgentEvent`, `SpawnScriptEvent`, `SpawnSkillEvent`, `SpawnCliEvent` structs

Frontend:
- Deleted `use-pipeline-events.ts` entirely
- Removed `usePipelineEvents` from `app.tsx`
- Removed 4 `fire*Trigger` functions + 4 spawn event types + 4 event listeners from `ipc.ts`

**Test results:** 67 Rust + 128 Frontend = 195 tests, all passing. TypeScript clean.

## Completed: Unified Chat System Phase 4a (2026-04-03)

**Created `ChefSession`** — orchestrator layer on top of `UnifiedChatSession`.

- `chef.rs` — wraps session with board context + tool execution
  - `ChefMode::Cli` (action blocks) vs `ChefMode::Api` (native tools)
  - `build_system_prompt()` — mode-aware prompt with column names
  - `augment_message()` — injects board state (columns + tasks) into user message
  - `execute_response_actions()` — parses ```action blocks, runs execute_tools
  - `send_message_with_context()` — loads workspace state, augments, delegates to session

**Test results:** 71 Rust tests, all passing (4 new)

## Completed: Unified Chat System Phase 4c (2026-04-03)

**Rewired `stream_agent_chat` and `cancel_agent_chat` to use `UnifiedChatSession`.**

- `stream_agent_chat` now uses `SharedSessionRegistry` instead of `SharedAgentCliSessionManager`
- Sessions keyed by `task_id` in the registry with `get_or_create`
- `cancel_agent_chat` kills session via registry
- Event forwarding: `emit_agent_event()` converts `ChatEvent` → agent-specific Tauri events
- `AgentCompletePayload` + event payload structs moved to `commands/agent.rs` (no longer imported from legacy module)
- `SharedAgentCliSessionManager` kept in managed state for Discord commands (Phase 6 cleanup)

**Test results:** 71 Rust tests, all passing

## Completed: Unified Chat System Phase 4b (2026-04-03)

**Rewired `stream_orchestrator_chat` CLI mode to use unified session system.**

- `stream_via_cli` replaced with `stream_via_unified_cli` using `SessionRegistry`
- Sessions keyed by `chef:{workspace_id}:{session_id}` for multi-session support
- Board context + system prompt built inline (ChefSession not used directly — simpler for the complex retry logic)
- Retry logic preserved: empty response → clear resume, retry; send failure → clear resume, retry
- `cancel_orchestrator_chat` kills both registry session AND legacy CLI session (backward compat)
- Event forwarding via `emit_orchestrator_cli_event()` (ChatEvent → orchestrator Tauri events)
- API mode (`stream_via_api`) unchanged

**Test results:** 71 Rust tests, all passing

## Completed: Unified Chat System Phase 5 (2026-04-04)

**Extracted shared chat helpers + assessed frontend unification scope.**

- `chat-helpers.ts` — `mapToolCalls()`, `mapMessages()` extracted from both panels
- AgentPanel: 238 → 199 lines (-39)
- OrchestratorPanel: inline tool/queue mapping replaced with helpers
- Assessment: panels share `ChatInput`, `ChatHistory`, `useChatSession` already (90% of logic). Layout differences (resize, sidebar, session management) make a unified wrapper more complex than the separate panels. Phase 5 scope adjusted: helpers extracted, no wrapper needed.

Also fixed: resize handle positioning bug (missing `relative` on panel container, handle floated to app top) and viewport-relative max height clamping.

**Test results:** 128 frontend tests passing, TypeScript clean

## Completed: Unified Chat System Phase 6 partial (2026-04-04)

**Removed `CliSessionManager` + `cli_session.rs`.**

- Deleted `cli_session.rs` (259 lines)
- 4 orchestrator commands rewired from `cli_manager` to `session_registry`
- `delete_chat_session` and `reset_cli_session` now look up workspace_id from DB (no frontend changes needed)
- `cancel_orchestrator_chat` removed legacy cli_manager kill block
- Removed from lib.rs managed state + shutdown handler

Remaining legacy (still load-bearing):
- `cli_shared.rs` — imported by `agent_cli_session.rs`
- `AgentCliSessionManager` — used by Discord integration
- `AgentRunner` + `PtyManager` — used by terminal view commands

**Test results:** 71 Rust + 128 frontend + 17 E2E = 216 tests, all passing

## Session Stats (2026-04-03 — 2026-04-04)

**Unified Chat System (Phases 1-6):**
- Phase 1: ChatTransport trait + PtyTransport + PipeTransport
- Phase 2: UnifiedChatSession + SessionRegistry
- Phase 3: All triggers bypass frontend (V1 + V2), removed dead relay code (-757 lines)
- Phase 4: ChefSession + agent chat rewire + orchestrator CLI rewire
- Phase 5: Shared chat helpers extracted, resize handle fix
- Phase 6: CliSessionManager removed (-284 lines)
- New chat module: 8 files in `src-tauri/src/chat/`
- Total tests: 216 (71 Rust + 128 frontend + 17 E2E)

**Other fixes:**
- E2E flaky delete test (clean slate in before hook)
- Resize handle positioning (missing `relative` on panel container)
- Viewport-relative max panel height clamping

## Completed: Code Health + Quick Wins (2026-04-04)

### Priority 1: Code Health

**1.2 Split ipc.ts** — 1545-line monolith split into 19 domain modules under `src/lib/ipc/`:
- invoke.ts (shared wrappers), workspace.ts, column.ts, task.ts, git.ts, agent.ts, cli.ts, events.ts, pipeline.ts, orchestrator.ts, voice.ts, usage.ts, session.ts, checklist.ts, files.ts, siege.ts, github.ts, discord.ts, index.ts (barrel re-exports)
- 37 consumer files unchanged — all imports resolve via index.ts

**1.4 Trigger Config Migration** — Full V2 cleanup:
- Frontend: removed `TriggerConfig`, `ExitConfig`, `TriggerType`, `ExitType` deprecated types
- Frontend: removed `migrateTriggerConfig()`, added `getColumnTriggers()` helper
- Frontend: Column type now uses V2 `triggers?: ColumnTriggers` with legacy fields optional
- Rust: DB migration 024 drops `trigger_config`, `exit_config`, `auto_advance` columns
- Rust: Column struct cleaned up, all SQL queries updated (8 sites)
- Rust: pipeline/mod.rs removed ~220 lines of legacy fallback code
- Rust: `fire_trigger`, `evaluate_exit_criteria`, `try_auto_advance` all V2-only

**1.1 & 1.3** — Investigated, no changes needed (unwraps in test code, bridge comment already accurate)

### Quick Wins (from competitor analysis)

**#9 Space to Peek Preview** — Space key now opens split view (was toggling agent status)

**#12 Quality Gates** — Task cards show review badges when column has `manual_approval` exit criteria:
- Amber "Pending Review" when reviewStatus is null
- Green "Approved" / Red "Rejected" badges
- Only renders on quality-gate columns

**#7 Auto-Retry on Failure** — Full stack implementation:
- `max_retries` field on ExitCriteriaV2 (Rust) and ExitCriteria (TS)
- `retry_count` field on Task (DB migration 025)
- Pipeline mark_complete: on failure, checks retries remaining → increments count → re-fires trigger
- On success: retry count resets to 0
- Task card shows retry count in error banner

## Completed: High-Impact Features (2026-04-04 continued)

**#8 Live Agent Status on Cards** — Ephemeral streaming store:
- `agent-streaming-store.ts`: Zustand Map<taskId, AgentStream> for live data
- `use-agent-streaming-sync.ts`: global event listener (App.tsx)
- Task cards show: content snippet (80 chars), active tool name, elapsed time, tool count
- Falls back to static status when no active stream

**#1 Cmd+K Command Palette** — Linear-style floating palette:
- Search + keyboard navigation (arrows, enter, escape)
- Dynamic commands from stores (tasks, workspaces)
- Categories: Navigation, Tasks, Workspace, Settings
- `command-palette.tsx` (330 lines)

**#3 DAG Dependencies** — Full 5-phase implementation:
- Phase 1: DFS cycle detection (self-loop, direct, transitive cycles) + 4 Rust tests
- Phase 2: Interactive dependency editor in task settings modal
- Phase 3: SVG bezier dependency lines on kanban board (CardPositionContext + ResizeObserver)
- Phase 4: L key shortcut opens dep editor directly
- Phase 5: "Waiting for: Task A" on blocked cards instead of generic message
- Duplicate dep prevention, cycle validation via IPC

## Completed: Architecture Overhaul (2026-04-04 continued)

**Discord Integration Removed** — -5,216 lines:
- Deleted: discord-bot sidecar (14 files Node.js), discord module (bridge.rs, handlers.rs), 22 Tauri commands, frontend IPC + settings UI
- Migration 026 drops 3 Discord tables
- Orphaned by MCP server replacement

**bento-mcp MCP Server** — Standalone Rust binary:
- 16 tools: get_workspaces, get_board, get_task, create_task, update_task, move_task, delete_task, approve_task, reject_task, add_dependency, remove_dependency, mark_complete, retry_task, create_workspace, create_column, configure_triggers
- Fuzzy name/ID resolution for tasks, columns, workspaces
- Direct SQLite access (WAL mode, concurrent with Tauri app)
- Auto-detects DB at ~/.bentoya/data.db
- E2E verified: all 16 tools tested against real DB
- Added to choomfie's .mcp.json for native tool access

**Settings Revamp** — 9 tabs → 7 focused tabs:
- Workspace, Appearance, Agent, Connect (MCP), Board (cards+templates), Voice, Advanced (pipeline+git+shortcuts)
- New Connect tab with copy-paste MCP config, setup instructions, tool list

**Self-Maintaining Workspace** — Bento-ya Dev:
- Workspace pointing at /Users/bentomac/bento-ya
- Working: spawn_cli trigger (claude /start-task), agent_complete exit, auto_advance, 2 max retries
- Review: manual_approval quality gate, auto_advance
- 6 tasks in backlog (all created via MCP)

## Completed: Testing & Review (2026-04-04 continued)

- 23 new tests added (agent-streaming-store: 13, column.test: 8, Rust retry: 2)
- 3 bugs caught in review: blocked state, type safety, store race condition
- Keyboard shortcuts audit: synced documented vs implemented
- Docs audit: CLAUDE.md updated for all new features
- All templates-store tests verified valid (uses TemplateColumn, not Column)

### Session Stats (2026-04-04 — full day)

- **17 commits** pushed to main
- **226 tests** (77 Rust + 149 frontend), all passing
- **~5,000 lines deleted** (Discord, legacy triggers)
- **~4,500 lines added** (MCP server, DAG deps, command palette, streaming)
- **6 DB migrations** total (024-026 + 025 new)
- **16 MCP tools** implemented and e2e tested
- 3 bugs caught in review + fixed
- Visually verified via Tauri automation screenshots

## Next Up

- [ ] #11 Model switching per task (already in backlog)
- [ ] Split task-card.tsx (614 lines)
- [ ] Split column-config-dialog.tsx (745 lines)
- [ ] Phase 6: rewire terminal view to PtyTransport
- [ ] First-launch onboarding wizard
- [ ] Per-task git worktree isolation
- [ ] Multi-provider support (OpenAI API)
- [ ] Connect choomfie natively (restart session to load MCP tools)
