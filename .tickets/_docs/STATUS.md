# Bento-ya Implementation Status

> Last updated: 2025-03-08
>
> See also: [ARCHITECTURE.md](./ARCHITECTURE.md) for system overview

## Summary

| Version | Implemented | Remaining | Status |
|---------|-------------|-----------|--------|
| v0.1 | 13/13 | 0 | **COMPLETE** |
| v0.2 | 5/5 | 0 | **COMPLETE** |
| v0.3 | 5/5 | 0 | **COMPLETE** |
| v0.4 | 5/5 | 0 | **COMPLETE** |
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

## v0.4 — "Siege" (Automation & PR Workflow)

| ID | Title | Status | Complexity |
|----|-------|--------|------------|
| T024 | PR Creation from Review Column | ✅ **COMPLETE** | M |
| T025 | Siege Loop (Comment-Watch) | ✅ **COMPLETE** | L |
| T026 | Manual Test Checklist Generation | ✅ **COMPLETE** | M |
| T027 | Notification Column | ✅ **COMPLETE** | S |
| T028 | Checklist Auto-Detect & Fix-This | ✅ **COMPLETE** | M |

---

## Additional Features Built (Not in Original Roadmap)

| Feature | Description | Evidence |
|---------|-------------|----------|
| Usage/Cost Tracking | Track LLM API costs per workspace/task | `usage_records` table, `CostBadge` component |
| Agent Sessions | Persistent agent session management | `agent_sessions` table with resumable flag |
| Conflict Heatmap | Visual git conflict detection across branches | `src/components/git/conflict-heatmap.tsx` |
| Swipe Navigation | Mobile-friendly workspace switching | `src/hooks/use-swipe.ts` |
| CLI Auto-Detection | Detect claude/codex CLI paths automatically | `src-tauri/src/commands/cli_detect.rs` |
| Agent Queue System | Queue tasks for parallel agent execution (max 5) | `agent_status`, `queued_at` fields, queue commands |
| Agent Streaming Chat | Per-task CLI sessions with streaming responses | `AgentCliSessionManager`, `use-agent-session.ts` |
| Pipeline Event Wiring | Frontend subscribes to spawn events, fires triggers | `use-pipeline-events.ts` hook |

---

## Wiring Tickets (Backend ↔ Frontend Integration)

These tickets track work needed to connect existing UI to functional backends:

| ID | Title | Status | Complexity |
|----|-------|--------|------------|
| T033 | LLM Integration (Anthropic/OpenAI) | ✅ **COMPLETE** | XL |
| T034 | Pipeline Exit Criteria Evaluation | ✅ **COMPLETE** | L |
| T035 | History Replay Backend | ✅ **COMPLETE** | M |
| T036 | Metrics Data Collection | ✅ **COMPLETE** | S |
| T037 | Checklist Persistence | ✅ **COMPLETE** | M |
| T038 | Settings Backend Sync | ✅ **COMPLETE** | M |
| T039 | Orchestrator Intelligence | ✅ **COMPLETE** | M |
| T040 | Files Sidebar | ✅ **COMPLETE** | M |
| T041 | Review Actions (Approve/Reject) | ✅ **COMPLETE** | S |
| T042 | Agent Trigger Execution | ✅ **COMPLETE** | M |
| T043 | Script Trigger Executor | ✅ **COMPLETE** | M |
| T044 | Skill Trigger Executor | ✅ **COMPLETE** | M |
| T045 | Task Card UI Improvements | ✅ **COMPLETE** | M |

**Verified 2025-03-02**: Massive wiring session completed - T034, T037-T044 all implemented.

**Updated 2025-03-05**: Pipeline trigger frontend event handling added (`use-pipeline-events.ts`). Triggers now fire end-to-end.

---

## Recent Work (March 2025)

### v0.4 & Wiring Completion (2025-03-05 Evening)
- **T035 History Replay**: Added `restore_snapshot` command that actually restores session scrollback
- **T026 Test Checklist Generation**: Added `generate_test_checklist` command that calls `gh pr diff` + Claude CLI to generate test items from PR changes
- **T027 Notification Column**: Added `notification_sent` exit type, pipeline evaluation, and Full CI Pipeline template with Notify column
- **T028 Checklist Auto-Detect**: Added `run_checklist_detection` command with 4 detection types:
  - `file-exists`: Check if files matching glob pattern exist
  - `file-absent`: Check if files are correctly absent
  - `file-contains`: Check if file contains specific content
  - `command-succeeds`: Run shell command and check exit code
- **Discord Integration**: Refactored handlers to async with full agent support:
  - `agent:send_message` - Send messages to active agent sessions
  - `agent:start` - Start new agent sessions for tasks
  - `agent:resume` - Resume agent sessions with `--resume` flag
  - `chef:message` - Route natural language messages to Chef orchestrator
  - Added `CommandContext` struct to pass `AppState`, `AgentCliSessionManager`, and `AppHandle`

### Agent Queue System & Pipeline Wiring (2025-03-05)
- **Agent Queue System**: Tasks can be queued for parallel agent execution
  - New `agent_status` field: `idle`, `queued`, `running`, `completed`, `failed`, `stopped`, `needs_attention`
  - New `queued_at` timestamp for FIFO ordering
  - `MAX_CONCURRENT_AGENTS = 5` limit
  - IPC: `queueAgentTasks`, `getQueueStatus`, `getNextQueuedTask`, `updateTaskAgentStatus`
  - UI: Task cards show "Queued..." indicator with warning color
- **Pipeline Event Wiring**: Frontend now subscribes to spawn events
  - Created `use-pipeline-events.ts` hook
  - Listens for `pipeline:spawn_agent`, `pipeline:spawn_script`, `pipeline:spawn_skill`
  - Calls `fireAgentTrigger()`, `fireScriptTrigger()`, `fireSkillTrigger()` IPC functions
  - Pipeline triggers now work end-to-end (previously backend emitted events but frontend didn't listen)
- **Codebase Cleanup**: Deleted 652 LOC of legacy code, removed unused IPC aliases

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

| # | File | Description |
|---|------|-------------|
| 001 | initial.sql | workspaces, columns, tasks, agent_sessions, _migrations |
| 002 | column_config.sql | Column trigger/exit config fields, icon, auto_advance |
| 003 | pipeline_state.sql | Task pipeline_state, triggered_at, error, agent_session_id |
| 004 | chat_messages.sql | chat_messages table |
| 005 | checklists.sql | Task checklist JSON field |
| 006 | session_resume.sql | Agent session resumable, cli_session_id, model, effort_level |
| 007 | cost_tracking.sql | usage_records table |
| 008 | session_history.sql | session_snapshots table |
| 009 | chat_sessions.sql | orchestrator_sessions, chat_messages workspace_id |
| 010 | cli_sessions.sql | cli_sessions table |
| 011 | workspace_config.sql | Workspace config JSON field |
| 012 | task_agent_session.sql | Task agent_session_id field |
| 013 | task_script_exit_code.sql | Task last_script_exit_code field |
| 014 | review_status.sql | Task review_status field |
| 015 | pr_fields.sql | Task pr_number, pr_url fields |
| 016 | siege_fields.sql | Task siege_iteration, siege_active, siege_max_iterations |
| 017 | pr_status_fields.sql | Task PR/CI status fields (mergeable, ci_status, review_decision, etc.) |
| 018 | discord_integration.sql | Discord guild_configs, task_threads tables |
| 019 | discord_agent_routes.sql | Discord agent routing config |
| 020 | notify_fields.sql | Task notify_stakeholders, notification_sent_at fields |
| 021 | agent_messages.sql | agent_messages table for per-task chat history |
| 022 | agent_queue.sql | Task agent_status, queued_at fields with index |

---

## Next Steps (Priority Order)

### All Core Features Complete! 🎉

v0.1–v0.4 and v1.0 are all complete. Remaining polish work:

### Integration Polish

- **Discord Integration**: ✅ Async agent handlers implemented - can now send messages, start/resume agents, and route Chef messages via Discord
- **Webhook Trigger**: ✅ Fire-and-forget implementation complete
- **Pipeline UI Visualization**: ✅ Task cards show pipeline state with improved status badges
- **Agent Streaming**: ✅ Per-task CLI sessions implemented with streaming support

### Code Quality (2025-03-08)

- **Lint Fixes**: Reduced lint errors from 263 to 0 ✅ (100% clean)
- **Test Coverage**: 94 tests passing across 7 files (column-store, task-store, checklist-store, workspace-store, settings-store, templates-store, format-time)
- **Type Safety**: All type-check errors resolved
- **Frontend Build**: Production vite build works (`npm run build`)

### Production Build Notes

- **Frontend**: ✅ Builds successfully with Vite
- **Tauri App**: Requires macOS 10.15+ deployment target for whisper-rs dependency
  - Added `.cargo/config.toml` with `MACOSX_DEPLOYMENT_TARGET = "10.15"`
  - If build fails, ensure Xcode Command Line Tools are updated and SDK supports 10.15+
  - Alternative: Remove whisper-rs for builds without voice input
