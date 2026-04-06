# Bento-ya Next Steps

> Updated: 2026-04-05. Previous version was from 2026-04-04.

## Current State

**Architecture:** Unified chat system complete (Phases 1-5, Phase 6 partial)
**Tests:** 333 total (167 Rust + 149 frontend + 17 E2E)
**Codebase:** ~42k lines (18k Rust, 24k TypeScript/React)
**Cargo workspace:** bento-ya + bento-mcp share rusqlite build (WAL compatible)

## v1.0 Sprint Complete (55/55 tickets)

All v1-sprint tickets resolved:
- T035 History Replay — verified end-to-end
- T046 Chef Settings API — deferred (questionable value)
- T051 Siege Loop UI — SiegeStatus component added to task detail panel

### Code Health — All Clean

- No components over 500 LOC (4 splits completed)
- 6 siege tests added (prompt building, serialization)
- MCP Connect tab updated (12→19 tools)
- Task card UX fixed (side panel, board stays visible)

### Polish Backlog (from `.tickets/POLISH-BACKLOG.md`)

| ID | Issue | Effort | Status |
|----|-------|--------|--------|
| P002 | Repo path file picker button | 30min | ✅ Complete |
| P003 | Column drag-and-drop | 1hr | ✅ Complete (visible filter bug fixed) |
| P004 | Chef panel docking options | 2hr | |

## Feature Roadmap (v2.0)

Prioritized by user value:

### Tier 1 — High Impact
- **Per-task git worktree isolation** — agents work on isolated branches, no conflicts
- **PR auto-create trigger** — wire existing `create_pr` command as a column trigger action
- **DAG dependency UI** — SVG lines on board (backend complete, frontend phases 3-5 remaining)

### Tier 2 — Nice to Have
- **LCH theme redesign** — perceptually uniform colors, dark mode polish
- **Agent thought stream** — show reasoning/thinking in agent panel
- **Branch comparison view** — visual diff between task branches

### Tier 3 — Future (v2.1+)
- **Discord integration** — 10 tickets (T052-T060), blocked on Phase 6 cleanup
- **Multi-provider support** — OpenAI API alongside Anthropic
- **Conflict resolution UI** — visual merge conflict helper
- **First-launch onboarding wizard**

## What Was Completed (This Session — 2026-04-05)

- Split `db/mod.rs` 2215→476 lines (12 domain modules)
- Split `task-card.tsx` 557→328 lines (3 extracted files)
- WAL fix: Cargo workspace for shared SQLite build
- 12 dependency tests (4→16), 17 MCP server tests (0→17)
- Closed 7 stale tickets (T026-T028, T047-T050 — all already done)
- Updated STATUS.md, NEXT_STEPS.md, moved tickets

## What Was Completed (Previous Sessions)

- Unified Chat System (Phases 1-6 partial) — 8 files in `src-tauri/src/chat/`
- MCP Server — 19 tools, standalone binary, concurrent WAL access
- DAG Dependencies — cycle detection, DFS validation, backend complete
- Command Palette, Auto-Retry, Live Agent Status on Cards
- Discord integration removed (-5,216 lines)
- ipc.ts split into 19 domain modules
- Trigger config V2 migration complete
- Column-config-dialog split (745→256)
- Scripts system (5 phases, 19 MCP tools)
- 63 new Rust tests across 4 review passes
