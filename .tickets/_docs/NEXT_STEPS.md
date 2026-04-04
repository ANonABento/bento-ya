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

### Direct Competitors (AI Agent Kanban)

#### VibeKanban (30k+ users, Rust+TS, open source)
- Split-screen: board left, agent execution/diff right
- Three-stage: Plan → Prompt → Review (not Todo/Doing/Done)
- Per-task git worktree isolation
- Built-in diff viewer with inline comments
- Agent-agnostic (10+ agents including Claude Code)
- MCP server integration — agents can self-manage tasks
- **Learn:** Split-screen layout, MCP server for self-management, built-in diff review

#### Cline Kanban (research preview, free)
- "Watch the board, not the terminals" philosophy
- Real-time diff display on card click
- Dependency chains (Cmd+drag to link, auto-start on blocker complete)
- Sidebar AI agent that manages the board itself
- Live command execution shown on each card
- Auto-commit + PR creation on task completion
- **Learn:** Sidebar agent for board management, live execution status on cards, dependency auto-triggering

#### Automaker (Electron desktop app)
- Auto Mode vs Manual Control toggle
- Agent "Thought Stream" — real-time reasoning visibility
- Model switching per task (Opus for heavy, Haiku for quick)
- Image context on cards (upload design mocks)
- **Learn:** Thought stream/reasoning view, per-task model selection

#### Agent Board (open source, zero external DB)
- DAG dependencies with cycle detection
- Quality gates: `requiresReview: true` forces review before done
- Auto-retry with configurable maxRetries
- Task chaining: `nextTask` auto-creates follow-ups
- Client/stakeholder read-only view
- Audit trail (append-only JSONL)
- **Learn:** DAG deps, quality gates, auto-retry, audit trail

### Design Reference (Non-AI)

#### Linear (gold standard for dev project management)
- Cmd+K command palette for everything
- Keyboard-first: j/k navigation, Space to peek, C to create
- Minimal cards with configurable display properties
- Swimlanes for multi-dimensional grouping
- LCH color space for perceptually uniform themes
- Dark mode: brand colors at 1-10% lightness (not pure black)
- March 2026 refresh: calmer, more consistent, reduced visual noise
- **Learn:** Command palette, peek preview, LCH colors, intentional constraint

### Must-Have Patterns for Bento-ya Redesign

| # | Pattern | Source | Effort |
|---|---------|--------|--------|
| 1 | Cmd+K command palette | Linear | Medium |
| 2 | Split-screen board + execution | VibeKanban, Cline | Already have (split view) |
| 3 | DAG dependency chains with auto-trigger | Agent Board, Cline | High |
| 4 | Per-task git worktree isolation | All tools agree | Medium |
| 5 | Inline diff review with comments | VibeKanban, Cline | High |
| 6 | MCP server for agent self-management | VibeKanban, Agent Board | Medium |
| 7 | Auto-retry on failure | Agent Board | Low (we have retry in socials) |
| 8 | Live agent status on cards | Cline | Medium |
| 9 | Space to "peek" preview | Linear | Low |
| 10 | Agent thought stream / reasoning view | Automaker | High |
| 11 | Model switching per task | Automaker | Low |
| 12 | Quality gates (review before done) | Agent Board | Low |
| 13 | Conversation history stored in tasks | VS Code Agent Kanban | Medium |
| 14 | Minimal cards + configurable display | Linear | Medium |

### Design Principles to Adopt
- **LCH color space** for perceptually uniform themes (Linear)
- **Dark mode** with brand colors at 1-10% lightness, not pure black
- **Intentional constraint**: fewer options, better defaults
- **Minimal cards**: essential info only, detail on demand
- **Keyboard-first**: every action reachable without mouse

---

## Immediate Actions (Tomorrow Morning)

1. Fix executor.rs unwraps (15 min)
2. Update stale bridge comment (1 min)
3. Decide on UI redesign scope (discussion)
4. Set up bento-ya self-maintaining workspace (30 min)
5. Ship social media posts (LinkedIn + Twitter manual)
