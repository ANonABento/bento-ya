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
- `src/hooks/use-pipeline-events.ts` — Frontend pipeline event listener
- `src/hooks/chat-session/` — Chat session hook (streaming, model switch)
- `src/lib/browser-mock.ts` — Mock IPC for Playwright tests

### Test Commands
```bash
# Frontend unit tests (128 tests)
cd /Users/bentomac/bento-ya && npm run test:run

# Backend unit tests (49 tests)
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

## Next Up

- [ ] Unified Chat Phase 3: Trigger refactor (triggers → messages, not process spawns)
- [ ] Add more providers beyond Anthropic (OpenAI API support)
- [ ] Agent chat streaming to task card UI (terminal output visible in card)
- [ ] Address remaining known issues (port 1420 squatting)
- [ ] Improve claude startup time for trigger agents (MCP server loading is slow)
