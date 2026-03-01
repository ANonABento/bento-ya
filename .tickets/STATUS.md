# Bento-ya Implementation Status

> Last updated: 2025-02-28

## Summary

| Version | Implemented | Remaining | Status |
|---------|-------------|-----------|--------|
| v0.1 | 13/13 | 0 | **COMPLETE** |
| v0.2 | 5/5 | 0 | **COMPLETE** |
| v0.3 | 5/5 | 0 | **COMPLETE** |
| v0.4 | 0/5 | 5 | **NOT STARTED** |
| v1.0 | 4/4 | 0 | **COMPLETE** |

---

## IMPLEMENTED

### v0.1 — "It Works" (Foundation)

| ID | Title | Evidence |
|----|-------|----------|
| T001 | Project Scaffolding | Tauri + React + Rust project structure |
| T002 | Database Schema & Migrations | `src-tauri/src/db/migrations/` (8 migrations) |
| T003 | Backend CRUD Commands | `src-tauri/src/commands/` (workspace, column, task, etc.) |
| T004 | PTY Manager & Agent Runner | `src-tauri/src/process/pty_manager.rs`, `agent_runner.rs` |
| T005 | Git Branch Manager & Change Tracker | `src-tauri/src/git/` (branch_manager, change_tracker, conflict_detector) |
| T006 | Tauri IPC Event System | `src/lib/ipc.ts`, event listeners throughout |
| T007 | Frontend Types, Stores & IPC Wrappers | `src/types/`, `src/stores/`, `src/lib/ipc.ts` |
| T008 | Dark Theme & Layout Shell | `src/index.css`, `src/lib/theme.ts`, `src/app.tsx` |
| T009 | Kanban Board (Columns + Cards + DnD) | `src/components/kanban/`, `src/components/layout/board.tsx` |
| T010 | Terminal View (xterm.js) | `src/components/terminal/terminal-view.tsx` |
| T011 | Split View Transition | Task detail panel with split layout |
| T012 | Diff Viewer | `src/components/review/diff-viewer.tsx` |
| T013 | E2E Integration | All components wired together |

### v0.2 — "Pipeline"

| ID | Title | Evidence |
|----|-------|----------|
| T014 | Multi-Workspace Tabs | `src/components/layout/tab-bar.tsx`, workspace-store |
| T015 | Custom Column Configuration | `src/components/kanban/column-config-dialog.tsx`, column triggers/exit config |
| T016 | Pipeline Engine | `src-tauri/src/pipeline/`, pipeline state machine, auto-advance |
| T017 | Orchestrator Agent | `src-tauri/src/commands/orchestrator.rs`, chat system |
| T018 | Attention System | `src/stores/attention-store.ts`, notification badges |

### v0.3 — "Voice & Config"

| ID | Title | Evidence |
|----|-------|----------|
| T019 | Whisper Voice Input | `src-tauri/src/commands/voice.rs`, `src/components/chat/voice-input-button.tsx` |
| T020 | Settings Panel | `src/components/settings/` (6 tabs: appearance, agent, git, voice, shortcuts, templates) |
| T021 | Light Theme | `src/index.css` `[data-theme='light']` styles |
| T022 | Pipeline & Column Templates | `src/stores/templates-store.ts`, `src/types/templates.ts` |
| T023 | Production Readiness Checklists | `src/components/checklist/`, `src-tauri/src/checklist/` |

### v1.0 — "Bento-ya"

| ID | Title | Evidence |
|----|-------|----------|
| T029 | History & Replay | `src-tauri/src/commands/history.rs`, `session_snapshots` table, `src/components/history/` |
| T030 | Metrics Dashboard | `src/components/usage/metrics-dashboard.tsx`, `usage_records` table |
| T031 | Community Templates | `src/components/templates/community-gallery.tsx`, 4 featured templates |
| T032 | Polish & Ship | `src/components/about/about-modal.tsx`, `src/hooks/use-keyboard-shortcuts.ts` |

---

## TODO

### v0.4 — "Siege" (Automation & PR Workflow)

| ID | Title | Complexity | Description |
|----|-------|------------|-------------|
| T024 | PR Creation from Review Column | M | Trigger GitHub PR creation when task reaches Review column |
| T025 | Siege Loop (Comment-Watch) | L | Watch for PR comments, auto-create fix tasks, loop until merged |
| T026 | Manual Test Checklist Generation | M | Generate test checklists from PR changes |
| T027 | Notification Column | S | Special column for external notifications/events |
| T028 | Checklist Auto-Detect & Fix-This | M | Auto-detect issues from checklists, create fix tasks |

---

## Additional Features Built (Not in Original Roadmap)

| Feature | Description | Evidence |
|---------|-------------|----------|
| Usage/Cost Tracking | Track LLM API costs per workspace/task | `usage_records` table, `CostBadge` component |
| Agent Sessions | Persistent agent session management | `agent_sessions` table with resumable flag |
| Conflict Heatmap | Visual git conflict detection across branches | `src/components/git/conflict-heatmap.tsx` |
| Swipe Navigation | Mobile-friendly workspace switching | `src/hooks/use-swipe.ts` |

---

## Database Migrations

| # | File | Tables Created |
|---|------|----------------|
| 001 | initial.sql | workspaces, columns, tasks |
| 002 | column_config.sql | Column trigger/exit config fields |
| 003 | pipeline_state.sql | Task pipeline state fields |
| 004 | agent_sessions.sql | agent_sessions |
| 005 | orchestrator.sql | chat_messages, orchestrator_sessions |
| 006 | checklists.sql | checklists, checklist_categories, checklist_items |
| 007 | cost_tracking.sql | usage_records |
| 008 | session_history.sql | session_snapshots |

---

## Next Steps

1. **Implement v0.4** - PR workflow and siege loop for automated development
2. **E2E Tests** - Add Playwright/Tauri tests for critical paths
3. **Documentation** - User guide and API docs
