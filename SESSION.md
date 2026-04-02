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
| Trigger NL input | Textarea + generate button in column config | WIP — needs refactor to route through chef |

## Next Up: Chef Trigger Tool + Provider Abstraction

### Context
Added a hardcoded `generate_trigger_config` Tauri command that calls Anthropic Haiku directly to convert natural language → V2 trigger JSON. Frontend has textarea + "Generate Triggers" button wired to it. **But this is wrong** — it should route through the existing chef/orchestrator which already handles API vs CLI mode and provider selection.

### Phase A: Add `configure_triggers` tool to chef
1. **`src-tauri/src/llm/tools.rs`** — Add `configure_triggers` tool definition:
   - Input: `column` (name), `description` (natural language trigger description)
   - The chef interprets the description and generates the V2 JSON
2. **`src-tauri/src/llm/executor.rs`** — Add execution:
   - New `ToolOutcome::TriggersConfigured(column_id, triggers_json)`
   - Find column by name, parse/build trigger JSON, call `db::update_column_triggers()`
   - Emit `column:updated` event for frontend
3. **`src-tauri/src/llm/tools.rs`** `parse_cli_action_blocks()` — Add `"configure_triggers"` to CLI action mapping
4. **`src-tauri/src/llm/context.rs`** — Update both system prompts:
   - API prompt: chef already gets tool schema automatically
   - CLI prompt: add `configure_triggers` action block format
   - Include current column trigger configs in board context (`build_board_context()`)

### Phase B: Fix API mode to be provider-based
1. **`src-tauri/src/commands/orchestrator.rs`** — `stream_orchestrator_chat`:
   - Accept `provider_id` from frontend (or read from settings)
   - Read `apiKeyEnvVar` from provider config to get the right API key
   - Route to correct API client based on provider (currently only Anthropic, but extensible)
   - Remove hardcoded `ANTHROPIC_API_KEY` fallback
2. **Frontend** — Pass the active provider config when calling orchestrator

### Phase C: Frontend trigger tab → routes through chef
1. **Remove** `generate_trigger_config` command from `pipeline.rs` + `lib.rs` + `ipc.ts`
2. **Remove** `complete()` method from `anthropic.rs` (dead code after removal)
3. **`column-config-dialog.tsx`** — "Generate Triggers" button sends message to orchestrator:
   - Message: "Configure triggers for column [name]: [user's description]"
   - Chef uses `configure_triggers` tool → saves to DB
   - Frontend listens for column update event → refreshes trigger config in dialog
4. Keep the advanced editor for manual tweaking

### Phase D: Tests + docs
1. Add unit tests for `configure_triggers` in `executor.rs` tests
2. Update `tools.rs` tests (tool count, name list)
3. Update `parse_cli_action_blocks` tests
4. Run full test suite: `npm run test:run` + `cargo test --lib` + `npm run test:webdriver`
5. Update CLAUDE.md and SESSION.md

### Key Files
- `src-tauri/src/llm/tools.rs` — Tool definitions + CLI action parser
- `src-tauri/src/llm/executor.rs` — Tool execution
- `src-tauri/src/llm/context.rs` — System prompts + board context
- `src-tauri/src/commands/orchestrator.rs` — API/CLI routing (provider fix)
- `src-tauri/src/commands/pipeline.rs` — Remove hardcoded generate command
- `src-tauri/src/llm/anthropic.rs` — Remove `complete()` method
- `src/components/kanban/column-config-dialog.tsx` — Frontend trigger UI
- `src/lib/ipc.ts` — Remove `generateTriggerConfig`, add orchestrator message helper
