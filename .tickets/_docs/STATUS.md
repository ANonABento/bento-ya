# Bento-ya Implementation Status

> Last updated: 2026-04-05
>
> See also: [ARCHITECTURE.md](./ARCHITECTURE.md) for system overview

## Summary

| Version | Tickets | Status |
|---------|---------|--------|
| v0.1 Foundation | 13/13 | **COMPLETE** |
| v0.2 Pipeline | 5/5 | **COMPLETE** |
| v0.3 Voice & Config | 5/5 | **COMPLETE** |
| v0.4 Siege & PR | 5/5 | **COMPLETE** |
| v1.0 Polish | 4/4 | **COMPLETE** |
| v1.0 Wiring | 13/13 | **COMPLETE** |
| v1.0 Sprint | 10/10 | **COMPLETE** |

**Total: 55/55 tickets complete.** All planned features shipped.

---

## Architecture (2026-04-05)

### Unified Chat System (Phases 1-6)

Consolidated all chat transports into a single architecture:

```
Phase 1 ✅ — ChatTransport trait + PtyTransport + PipeTransport
Phase 2 ✅ — UnifiedChatSession + SessionRegistry
Phase 3 ✅ — All triggers execute in backend (no frontend round-trip)
Phase 4 ✅ — ChefSession + agent/orchestrator rewired
Phase 5 ✅ — Shared chat helpers extracted
Phase 6 🟡 — CliSessionManager removed, but AgentRunner + PtyManager still used by terminal/siege commands
```

### MCP Server (bento-mcp)

Standalone Rust binary (19 tools), shares Cargo workspace with Tauri app for WAL-compatible concurrent DB access. 17 unit tests.

### Database

SQLite with WAL mode. 29 migration files. Schema split into 12 domain modules:
`workspace.rs`, `column.rs`, `task.rs`, `agent_session.rs`, `agent_message.rs`, `chat_session.rs`, `chat_message.rs`, `orchestrator_session.rs`, `checklist.rs`, `usage.rs`, `history.rs`, `script.rs`

### Test Coverage

| Suite | Count | Notes |
|-------|-------|-------|
| Rust (bento-ya) | 156 | db, pipeline, triggers, dependencies, chat, chef, siege |
| Rust (bento-mcp) | 17 | tool handlers, fuzzy resolution |
| Frontend (Vitest) | 149 | stores, hooks, utils |
| E2E (WebDriverIO) | 17 | Tauri WKWebView automation |
| **Total** | **339** | |

---

## v1-sprint — All Complete

| ID | Title | When | Notes |
|----|-------|------|-------|
| T035 | History Replay | 2026-04 | Verified — `restoreSnapshot` fully wired end-to-end |
| T046 | Chef Settings API | 2026-04 | Deferred — questionable value, not blocking ship |
| T051 | Siege Loop UI | 2026-04 | Done — SiegeStatus component in task detail panel |
| T047 | Terminal Voice | 2026-04 | Stale — terminal-input.tsx removed, ChatInput has voice |
| T048 | Thinking Selector | 2026-04 | Working — ThinkingSelector component, wired in both panels |
| T049 | Model Selector | 2026-04 | Working — ModelSelector + useModelCapabilities hook |
| T050 | File Attachment | 2026-04 | Working — drag/drop/paste/picker in ChatInput |
| T026 | Test Checklist Gen | 2025-03 | `generate_test_checklist` command implemented |
| T027 | Notification Column | 2025-03 | `notification_sent` exit type + pipeline template |
| T028 | Checklist Auto-Detect | 2025-03 | `run_checklist_detection` with 4 detection types |

---

## Code Health

### No oversized components (all under 500 LOC)
All previously oversized components have been split:
- `db/mod.rs` 2215→476 (12 domain modules)
- `task-card.tsx` 557→328 (3 extracted files)
- `task-settings-modal.tsx` 512→259 (DependenciesTab extracted)
- `scripts-tab.tsx` 502→176 (ScriptEditor extracted)

### Legacy Code
- `process/agent_runner.rs` (194 LOC) — used by 5 agent commands + siege
- `process/pty_manager.rs` (281 LOC) — used by 3 terminal commands
- Both load-bearing for terminal view and siege features

### Polish Backlog (8 items)
See `.tickets/POLISH-BACKLOG.md` — workspace tab drag, repo file picker, column DnD, panel docking, etc.

---

## Feature Roadmap (v2.0)

From `docs/ROADMAP.md`:

| ID | Feature | Status |
|----|---------|--------|
| BEN-311 | Per-task git worktree isolation | Not started |
| BEN-312 | Worktree branch management | Not started |
| BEN-321 | Auto-create PR from task | Infra exists (`create_pr` cmd), needs trigger wiring |
| BEN-322 | PR status tracking on cards | ✅ Done (badges, polling hook) |
| BEN-323 | Conflict resolution UI | Not started |
| BEN-324 | Branch comparison view | Not started |
| DAG Phase 3 | SVG dependency lines on board | Not started |
| DAG Phase 4 | Cmd+drag to create links | Not started |
| Discord | E001 epic (10 tickets T052-T060) | Not started, blocked on Phase 6 |

---

## Build & Deploy

| Target | Status | Notes |
|--------|--------|-------|
| Frontend (Vite) | ✅ | `npm run build` |
| Type check | ✅ | `npx tsc --noEmit` (0 errors) |
| Lint | ✅ | `npm run lint` (0 errors) |
| Rust check | ✅ | `cargo check --workspace` |
| Tauri build | ✅ | Requires macOS 10.15+ for whisper-rs |
| MCP server | ✅ | `cargo build -p bento-mcp --release` |
