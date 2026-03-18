# Bento-ya Codebase Refactoring Plan

Created: 2026-03-18

## Phase 1: Clean Sweep (Quick Wins)
- [ ] Remove debug console.log/console.debug statements (~40+ in TS)
- [ ] Remove debug eprintln! statements (~33 in Rust)
- [ ] Remove deprecated types in `src/types/column.ts` and migrate references
- [ ] Remove `#[allow(dead_code)]` annotations and fix underlying issues
- [ ] Checkpoint commit

## Phase 2: Split Large Files
- [ ] Split `use-chat-session.ts` (720 LOC) → orchestrator vs agent chat hooks
- [ ] Split `column-config-dialog.tsx` (621 LOC) → extract trigger config sections
- [ ] Split `task-card.tsx` (614 LOC) → extract sub-components
- [ ] Split `db/mod.rs` (2645 LOC) → separate migrations, schema, queries
- [ ] Split `orchestrator.rs` (816 LOC) → extract streaming logic
- [ ] Checkpoint commit

## Phase 3: Organize & Document
- [ ] Rewrite CLAUDE.md with comprehensive architecture map, file index, conventions
- [ ] Add JSDoc comments to all public hook exports
- [ ] Add Rustdoc comments to all public Rust functions
- [ ] Add module-level doc comments to Rust modules
- [ ] Document IPC command contracts in ipc.ts
- [ ] Checkpoint commit

## Phase 4: Shared Utilities & Patterns
- [ ] Extract common form patterns from settings tabs
- [ ] Consolidate inline event handlers in large components
- [ ] Create shared error handling patterns
- [ ] Checkpoint commit

## Phase 5: Test Coverage
- [ ] Add Rust unit tests for db module
- [ ] Add Rust unit tests for pipeline module
- [ ] Expand frontend hook tests
- [ ] Expand E2E test scenarios
- [ ] Final commit

## Progress Log
- [ ] Started: 2026-03-18
