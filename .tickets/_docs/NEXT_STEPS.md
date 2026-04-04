# Bento-ya Next Steps — Planning Doc

Generated overnight 2026-04-04. Covers: codebase health, design improvements, feature roadmap.

## Current State

**Architecture:** Unified chat system (Phases 1-6 partial complete)
**Tests:** 216 total (71 Rust + 128 frontend + 17 E2E)
**Codebase:** ~42k lines (18k Rust, 24k TypeScript/React)
**Test coverage:** ~27% Rust files have unit tests (17/63)

## Priority 1: Code Health (Do First)

### 1.1 Unsafe Unwraps in LLM Executor
**File:** `src-tauri/src/llm/executor.rs` (lines 378, 485-513)
**Issue:** 6x `.unwrap()` calls on column lookups that panic if columns don't exist.
**Fix:** Replace with `.ok_or_else()` or `expect()` with descriptive messages.
**Effort:** 15 min

### 1.2 Split ipc.ts
**File:** `src/lib/ipc.ts` (1545 lines, 225 exported functions)
**Issue:** Single file is unmaintainable. Hard to find things, impossible to tree-shake.
**Fix:** Split by domain into `src/lib/ipc/`:
- `workspace.ts` — workspace CRUD
- `column.ts` — column CRUD
- `task.ts` — task CRUD + pipeline
- `agent.ts` — agent sessions + chat
- `orchestrator.ts` — orchestrator chat + sessions
- `events.ts` — event listeners + types
- `index.ts` — re-exports everything
**Effort:** 1 hour

### 1.3 Stale Bridge Comment
**File:** `src-tauri/src/chat/bridge.rs` (line 52)
**Issue:** Comment references deleted frontend round-trip pattern.
**Fix:** Update to reflect direct backend execution.
**Effort:** 1 min

### 1.4 Complete Trigger Config Migration
**Files:** `src/types/column.ts`, `src-tauri/src/db/models.rs`
**Issue:** Deprecated `TriggerConfig`/`ExitConfig` types coexist with V2 `ColumnTriggers`. Migration function exists but old types still used in mocks, browser-mock, and column-config-dialog.
**Fix:** Migrate all columns to V2 format, remove deprecated types, clean up migration code.
**Effort:** 2-3 hours

## Priority 2: Oversized Components (Refactor Sprint)

| Component | Lines | Action |
|-----------|-------|--------|
| `column-config-dialog.tsx` | 745 | Extract trigger editor + exit criteria editor into sub-components |
| `task-card.tsx` | 614 | Extract action handlers + detail sections |
| `orchestrator-panel.tsx` | 505 | Already improved in Phase 5; sidebar could be extracted |
| `chat-input.tsx` | 491 | Extract model/thinking/permission selectors |

## Priority 3: Test Coverage

### Critical gaps (no tests):
- `commands/discord.rs` (696 lines) — Discord integration
- `commands/siege.rs` (554 lines) — Siege loop
- `commands/agent.rs` (497 lines) — Agent management
- `pipeline/triggers.rs` (471 lines) — V2 trigger execution
- `pipeline/dependencies.rs` — Dependency resolution
- `discord/bridge.rs` (528 lines) — Discord bridge
- `discord/handlers.rs` (440 lines) — Discord handlers

### Recommended first tests:
1. `pipeline/triggers.rs` — trigger resolution + execution (highest risk code)
2. `commands/agent.rs` — agent chat flow (recently rewritten)
3. `pipeline/dependencies.rs` — dependency checking (complex logic)

## Priority 4: Phase 6 Remainder

### What's left:
- `cli_shared.rs` — still imported by `agent_cli_session.rs` (Discord)
- `AgentCliSessionManager` — used by Discord commands
- `AgentRunner` + `PtyManager` — used by terminal view (start_agent, stop_agent, write_to_pty)

### Path to removal:
1. Rewire Discord `agent_cli_session` usage to `SessionRegistry` (like we did for agent.rs commands)
2. Rewire terminal view commands to use `PtyTransport` from `SessionRegistry`
3. Delete `cli_shared.rs`, `agent_cli_session.rs`, `agent_runner.rs`
4. Keep `pty_manager.rs` for now (terminal commands still need it directly)

**Effort:** 4-6 hours, high risk (touches Discord + terminal view)

## Priority 5: UI/UX Redesign

### Design Patterns to Adopt (from competitor research)

*(See competitor analysis section below)*

### Key Areas for Improvement:
1. **Task cards** — show more info at a glance (PR status, agent status, time estimates)
2. **Keyboard navigation** — Linear-style command palette + vim-like shortcuts
3. **Theme** — cyberpunk design system from the diagram work (already have colors + fonts)
4. **Animations** — smoother column transitions, card drag, panel resize
5. **Mobile/responsive** — currently desktop-only; at minimum handle window resize gracefully

## Priority 6: Feature Roadmap

### 6.1 Self-Maintaining Dev Pipeline
Set up bento-ya workspace pointing at its own repo. Create columns:
- Backlog → Working (spawn_cli trigger) → Review (agent_complete exit) → Done
- Chef creates tasks from GitHub issues or natural language
- Agents work tasks autonomously overnight

### 6.2 Multi-Provider Support
- OpenAI API support (GPT-5.3 via Codex)
- Model selection per task (not just per session)
- Cost tracking across providers

### 6.3 Agent Chat Streaming to Task Card
- Show terminal output in the task card directly
- Toggle between compact view (last output line) and expanded (full terminal)
- Real-time status indicator on card

### 6.4 PR Integration
- Auto-create PR when agent completes
- PR status on task card (CI, review decision, mergeable)
- Auto-advance on PR approval (exit criteria already supports this)

---

## Competitor Analysis

*(Populated from overnight research — see below)*

### Linear
- Command palette (Cmd+K) for everything
- Keyboard-first navigation (j/k up/down, Enter to open, Esc to close)
- Minimal card design: title + status icon + assignee avatar + priority dot
- Side panel for detail (not modal — preserves board context)
- Cycles (time-boxed sprints) with automatic rollover
- Grouping by status, priority, assignee, label
- Real-time multiplayer (multiple users see changes instantly)

### Key Takeaways for Bento-ya:
1. **Command palette** — huge for power users. We have Cmd+J for chef; extend to Cmd+K for navigation
2. **Keyboard shortcuts** — j/k navigation through cards, Enter to open detail, Esc to close
3. **Side panel > modal** — our split view already does this for task detail; make it the default
4. **Minimal cards** — show less on the card, more in the detail panel
5. **Status indicators** — small colored dots (not text) for pipeline state

---

## Immediate Actions (Tomorrow Morning)

1. Fix executor.rs unwraps (15 min)
2. Update stale bridge comment (1 min)
3. Decide on UI redesign scope (discussion)
4. Set up bento-ya self-maintaining workspace (30 min)
5. Ship social media posts (LinkedIn + Twitter manual)
