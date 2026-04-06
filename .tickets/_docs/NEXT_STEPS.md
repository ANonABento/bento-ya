# Bento-ya Next Steps

> Updated: 2026-04-06.

## Current State

**Version:** v2.0 in progress
**Architecture:** Unified chat system (Phases 1-5 complete, Phase 6 partial)
**Tests:** 339 total (156 Rust + 17 MCP + 149 frontend + 17 E2E)
**DB Migrations:** 29 (latest: 029_task_worktree)
**Codebase:** ~42k lines (18k Rust, 24k TypeScript/React)
**Cargo workspace:** bento-ya + bento-mcp share rusqlite build (WAL compatible)
**MCP Server:** 19 tools, standalone binary

## v1.0 — COMPLETE

55/55 tickets resolved. Polish backlog 8/8 resolved.

### Recent Additions (2026-04-05/06)
- **Script trigger badge** on column headers — purple pill shows attached script name
- **Quick-attach scripts** to columns from Scripts settings tab (dropdown picker)
- **PathPicker** shared component — reused in workspace settings + onboarding wizard
- **Chef panel docking** — toggle between bottom and right positions (persisted)
- **Coming Soon indicators** — badges on unfinished settings features (git, shortcuts)
- **Column DnD bug fix** — visible filter for correct drag indices
- **Workspace store update()** — optimistic update with rollback

## v2.0 Feature Roadmap

### Tier 1 — High Impact
| Feature | Effort | Status | Description |
|---------|--------|--------|-------------|
| Per-task git worktree isolation | 8-12hr | **DONE** | `git worktree add` per task, agents work in isolation, no conflicts |
| PR auto-create trigger | 5hr | **DONE** | Native `create_pr` trigger action type with base branch config |
| DAG dependency UI (Phases 3-5) | 12-16hr | **DONE** | Condition-colored lines, hover tooltips, Cmd+drag to link cards |

### Tier 2 — Nice to Have
| Feature | Effort | Description |
|---------|--------|-------------|
| LCH theme redesign | 4-6hr | Perceptually uniform colors, dark mode polish |
| Agent thought stream | 4hr | Show reasoning/thinking tokens in agent panel |
| Branch comparison view | 4hr | Visual diff between task branches |
| Dynamic model discovery | 3-4hr | Auto-fetch available models from Anthropic/OpenAI APIs |

### Tier 3 — Future (v2.1+)
| Feature | Effort | Description |
|---------|--------|-------------|
| Discord integration | 40hr+ | 10 tickets (T052-T060), blocked on Phase 6 cleanup |
| Multi-provider support | 8hr | OpenAI API alongside Anthropic |
| Conflict resolution UI | 8hr | Visual merge conflict helper |

## Architecture Debt

| Item | Status | Notes |
|------|--------|-------|
| Phase 6 — CliSessionManager removal | Partial | Unified chat phases 1-5 done. Legacy code remains. Blocks Discord integration. |

## What Was Completed (Session: 2026-04-06 v2.0)

### Features
- **PR auto-create trigger** — `CreatePr { base_branch }` action type on TriggerActionV2, async gh CLI, mark_complete for pipeline advance
- **Per-task git worktree isolation** — `create_task_worktree`/`remove_task_worktree` via git2 API, `resolve_working_dir()` in all trigger handlers, auto-gitignore, auto-cleanup on task delete
- **Worktree frontend** — purple dot on task cards, "worktree" badge in detail panel, IPC functions, `worktreePath` on Task type
- **CreatePrEditor** — base branch input in column trigger config UI
- **Template variable** — `{task.worktree_path}` for prompt interpolation
- **DAG dependency lines** — condition-colored (green/blue/amber), hover tooltips with task names + condition badge, wider hit area
- **Cmd+drag linking** — hold Cmd/Ctrl + drag between cards to create dependency, preview bezier with color feedback, cycle detection on drop

### DB
- Migration 029: `worktree_path TEXT` column on tasks

### Review Fixes (2 passes)
- Fixed worktree name containing `/` (would corrupt `.git/worktrees/`)
- Auto-gitignore `.worktrees/` directory
- Moved filesystem I/O out of DB mutex in `delete_task`
- Removed duplicate `tasks:changed` emit in create_pr
- Consolidated two DB opens into one in async create_pr block
- Removed redundant variable clone

---

## What Was Completed (Session: 2026-04-05/06)

### Features
- Script trigger badge on column headers (script-store.ts, column-header.tsx)
- Quick-attach scripts to columns (scripts-tab.tsx dropdown)
- PathPicker shared component (path-picker.tsx, replaces duplication)
- Browse button for repo path in workspace settings
- Chef panel docking — bottom/right toggle (ui-store, orchestrator-panel, board)
- Coming Soon indicators on placeholder features (git-tab, shortcuts-tab)

### Bug Fixes
- Column DnD: filter hidden columns in onDragEnd (use-dnd.ts)

### Refactors
- Workspace store: added update() method with optimistic update + rollback

### Docs
- CLAUDE.md: script-store, PathPicker, workspace-store.update(), MCP 16→19 tools
- POLISH-BACKLOG.md: all 8 items resolved
- NEXT_STEPS.md: updated for v2.0 roadmap

### Testing
- MCP integration test: 14/14 tools verified (create/move/approve/reject/retry/complete)
- WebDriver E2E: 16/17 pass (tauri-plugin-webdriver-automation has stability issue with events)

## Previous Sessions

- Unified Chat System (Phases 1-6 partial) — 8 files in `src-tauri/src/chat/`
- MCP Server — 19 tools, standalone binary, concurrent WAL access
- DAG Dependencies — cycle detection, DFS validation, backend complete
- Command Palette, Auto-Retry, Live Agent Status on Cards
- Discord integration removed (-5,216 lines)
- ipc.ts split into 19 domain modules
- Trigger config V2 migration complete
- Scripts system (5 phases, 19 MCP tools)
- 63 new Rust tests across 4 review passes
- db/mod.rs split 2215→476 lines (12 domain modules)
- task-card.tsx split 557→328 lines (3 extracted files)
- WAL fix: Cargo workspace for shared SQLite build
