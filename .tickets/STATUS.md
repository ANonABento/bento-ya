# Bento-ya Implementation Status

> Last updated: 2025-03-02
>
> See also: [ARCHITECTURE.md](./ARCHITECTURE.md) for system overview

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
| CLI Auto-Detection | Detect claude/codex CLI paths automatically | `src-tauri/src/commands/cli_detect.rs` |

---

## Wiring Tickets (Backend ↔ Frontend Integration)

These tickets track work needed to connect existing UI to functional backends:

| ID | Title | Status | Complexity |
|----|-------|--------|------------|
| T033 | LLM Integration (Anthropic/OpenAI) | ✅ **COMPLETE** | XL |
| T034 | Pipeline Exit Criteria Evaluation | ❌ Stub returns `false` | M |
| T035 | History Replay Backend | ❌ Missing `restore_snapshot` | M |
| T036 | Metrics Data Collection | ✅ **COMPLETE** | S |
| T037 | Checklist Persistence | ❌ Store is local-only | M |
| T038 | Settings Backend Sync | ❌ localStorage only | M |
| T039 | Orchestrator Intelligence | ✅ **COMPLETE** | M |
| T040 | Files Sidebar | ❌ Placeholder "Coming soon" | M |
| T041 | Review Actions (Approve/Reject) | ❌ Buttons do nothing | S |

**Verified 2025-03-02**: T036 is wired - `insert_usage_record()` called in orchestrator.rs:632.

---

## Recent Work (March 2025)

### Orchestrator Intelligence - T033 & T039 (2025-03-02)
- **LLM Streaming**: Both API mode (direct Anthropic) and CLI mode (Claude CLI subprocess)
- **Tool Use**: create_task, update_task, move_task, delete_task, list_tasks
- **Persistent CLI Sessions**: Reuse CLI process across messages for conversation context
- **Thinking Display**: Show Claude's extended thinking in collapsible blocks
- **Message Queue**: Queue messages while processing, with cancel support
- **Voice Input**: Whisper transcription integrated into chat input
- **UI Improvements**: Renamed to "Chef", added History/Files sidebar, resizable panels

### macOS Tauri Pitfall Documented (2025-03-02)
- CSS cursor classes don't work on macOS WKWebView
- **Fix**: Use inline `style={{ cursor: 'row-resize' }}` instead of Tailwind classes
- Added CLAUDE.md documenting this for future reference

### Terminal/Agent IPC Fix (2025-03-01)
- Fixed parameter naming mismatch between JS (camelCase) and Rust (snake_case)
- Added `#[tauri::command(rename_all = "camelCase")]` to agent/terminal commands
- Made `start_agent` async to fix Tokio runtime panic
- Terminal → Agent → PTY → Events flow now working end-to-end

### CLI Auto-Detection (2025-03-01)
- Added `detect_clis()` and `detect_single_cli()` commands
- On-demand detection when selecting CLI mode in settings
- Checks `which`, common paths, and verifies with `--version`
- Auto-applies detected path without manual confirmation

### Settings UI/UX Improvements (2025-03-01)
- Toggle switches for provider enable/disable (cleaner than checkboxes)
- Removed per-provider default model (orchestrator handles it)
- Removed unused instructions file field
- Default max concurrent agents: 10
- "Coming Soon" section collapsed by default

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

## Next Steps (Priority Order)

### Core Wiring (Must Have)

1. **T037: Checklist Persistence** - Sync checklist state to backend on toggle/notes change
2. **T038: Settings Backend Sync** - Store workspace settings in DB, not just localStorage
3. **T034: Pipeline Exit Criteria** - Implement `agent_complete`, `script_success`, `pr_approved` checks
4. **T040: Files Sidebar** - Scan workspace for .md files, display in Chef sidebar

### Nice to Have

5. **T035: History Replay** - Add `restore_snapshot` command to actually restore board state
6. **T041: Review Actions** - Wire approve/reject to pipeline state machine

### Future (v0.4 Siege)

7. **T024-T028** - PR workflow, siege loop, comment watching
