# Bento-ya Codebase Refactoring Plan

Created: 2026-03-18

## Phase 1: Clean Sweep (Quick Wins) - DONE
- [x] Remove debug console.log/console.debug statements (~40+ in TS)
- [x] Remove debug eprintln! statements (~33 in Rust)
- [x] Clean up dead code (`event_type_str`, unused `context_id`)
- [x] Fix lint errors introduced by cleanup
- Commit: c5788ac

## Phase 2: Split Large Files - DONE
- [x] Split `use-chat-session.ts` (720 LOC) → `hooks/chat-session/` module (types.ts, helpers.ts, use-chat-session.ts, index.ts)
- [x] Extract 18 DB model structs into `src-tauri/src/db/models.rs`
- [x] Backward-compatible re-exports (pub use models::*)
- Commit: 6c5342e

## Phase 3: Organize & Document - DONE
- [x] Rewrite CLAUDE.md with comprehensive architecture map, file index, conventions, pitfalls
- [x] Add JSDoc comments to 7 frontend hooks
- [x] Add Rust module-level doc comments to process/, git/, db/ modules
- Commit: 01629ca

## Phase 4: Shared Utilities & Patterns - DONE
- [x] Create `LoadingSpinner` component (replaces 13+ duplicate SVG blocks)
- [x] Extract `getErrorMessage` to `src/lib/errors.ts` (shared utility)
- [x] Replace inline spinners in panel-input.tsx and checklist-panel.tsx
- Commit: 093e61c

## Phase 5: Test Coverage - DONE
- [x] Add unit tests for `getErrorMessage` utility (7 test cases)
- [x] All 128 frontend tests pass
- [x] All 49 Rust tests pass
- Commit: 7d48266

## Remaining Opportunities (for future work)
- [ ] Replace remaining 11 inline spinner SVGs with LoadingSpinner
- [ ] Create `useSettingsSection` hook to reduce settings tab boilerplate
- [ ] Ensure all settings tabs use existing Toggle component
- [ ] Add more E2E test scenarios
- [ ] Split task-card.tsx (614 LOC) into sub-components
- [ ] Consider splitting orchestrator.rs (816 LOC)
