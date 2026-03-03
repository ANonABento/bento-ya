# Overnight Autonomous Session Plan

> **Mode**: Ralph Loop (extended autonomous work)
> **Goal**: Wire up pipeline triggers, exit criteria, and core UI features
> **Process**: Plan → Implement → Test → Review → Commit → Repeat

---

## Execution Order (Dependency-Optimized)

### Phase 1: Foundation (Independent Tasks)

| # | Ticket | Title | Complexity | Est. Time |
|---|--------|-------|------------|-----------|
| 1 | T037 | Checklist Persistence | M | 45min |
| 2 | T038 | Settings Backend Sync | M | 45min |
| 3 | T040 | Files Sidebar (Chef) | M | 45min |

### Phase 2: Trigger Execution (Sequential - Each Builds on Agent Infrastructure)

| # | Ticket | Title | Complexity | Est. Time |
|---|--------|-------|------------|-----------|
| 4 | T042 | Agent Trigger Execution | M | 60min |
| 5 | T043 | Script Trigger Executor | M | 45min |
| 6 | T044 | Skill Trigger Executor | M | 45min |

### Phase 3: Exit Criteria (Depends on Phase 2)

| # | Ticket | Title | Complexity | Est. Time |
|---|--------|-------|------------|-----------|
| 7 | T034 | Pipeline Exit Criteria | L | 90min |
| 8 | T041 | Review Actions (Approve/Reject) | S | 30min |

### Phase 4: Siege Features (Depends on Phase 3)

| # | Ticket | Title | Complexity | Est. Time |
|---|--------|-------|------------|-----------|
| 9 | T024 | PR Creation from Review | M | 45min |
| 10 | T025 | Siege Loop (Comment-Watch) | L | 90min |

**Total Estimated: ~9 hours**

---

## Dependency Graph

```
Phase 1 (Parallel - No Dependencies)
├── T037 Checklist Persistence
├── T038 Settings Backend Sync
└── T040 Files Sidebar

Phase 2 (Sequential - Build Agent Infrastructure)
T042 Agent Trigger ──┐
                     ├──► T034 Exit Criteria
T043 Script Trigger ─┤         │
                     │         v
T044 Skill Trigger ──┘    T041 Review Actions
                               │
                               v
                          T024 PR Creation
                               │
                               v
                          T025 Siege Loop
```

---

## Task Details

### 1. T037: Checklist Persistence (M - 45min)

**Goal**: Checklist state survives page refresh

**Steps**:
1. Add `update_checklist_item` command (checked, notes)
2. Add `get_task_checklist` command
3. Update checklist-store to sync with backend
4. Debounce writes (500ms)
5. Load from backend on mount

**Files**:
- `src-tauri/src/commands/checklist.rs`
- `src/stores/checklist-store.ts`

**Commit**: `feat(checklist): persist checklist state to database`

---

### 2. T038: Settings Backend Sync (M - 45min)

**Goal**: Per-workspace settings, survive browser clear

**Steps**:
1. Split settings: global (localStorage) vs workspace (backend)
2. Add `update_workspace_config` command
3. Load workspace config on switch
4. Merge workspace settings over global defaults

**Files**:
- `src-tauri/src/commands/workspace.rs`
- `src/stores/settings-store.ts`

**Commit**: `feat(settings): per-workspace settings with backend sync`

---

### 3. T040: Files Sidebar (M - 45min)

**Goal**: Browse workspace files in Chef panel

**Steps**:
1. Add `list_workspace_files` command (glob *.md files)
2. Add `read_workspace_file` command
3. Build file tree UI component
4. Markdown preview on click
5. "New Note" button

**Files**:
- `src-tauri/src/commands/files.rs` (NEW)
- `src/components/panel/files-content.tsx` (NEW)

**Commit**: `feat(chef): implement files sidebar with markdown preview`

---

### 4. T042: Agent Trigger Execution (M - 60min)

**Goal**: When task enters column with trigger_type="agent", spawn agent

**Steps**:
1. In `fire_trigger`, parse agent_type from config
2. Call `start_agent` with task context
3. Store agent session ID on task
4. Add completion callback to call `mark_complete`
5. Wire up terminal output to task

**Files**:
- `src-tauri/src/pipeline/mod.rs`
- `src-tauri/src/process/agent_runner.rs`

**Commit**: `feat(pipeline): execute agent triggers on column entry`

---

### 5. T043: Script Trigger Executor (M - 45min)

**Goal**: When task enters column with trigger_type="script", run script

**Steps**:
1. In `fire_trigger`, parse script_path from config
2. Execute via PTY with env vars (TASK_ID, WORKSPACE_PATH)
3. Capture exit code on completion
4. Store exit code on task for exit criteria
5. Call `mark_complete` with success status

**Files**:
- `src-tauri/src/pipeline/mod.rs`
- `src-tauri/src/process/pty_manager.rs`

**Commit**: `feat(pipeline): execute script triggers with exit code tracking`

---

### 6. T044: Skill Trigger Executor (M - 45min)

**Goal**: When task enters column with trigger_type="skill", run skill

**Steps**:
1. In `fire_trigger`, parse skill_name from config
2. Build skill prompt (map common skills to prompts)
3. Execute via Claude CLI agent
4. Track completion and result

**Files**:
- `src-tauri/src/pipeline/mod.rs`
- `src-tauri/src/pipeline/skills.rs` (NEW)

**Commit**: `feat(pipeline): execute skill triggers via Claude CLI`

---

### 7. T034: Pipeline Exit Criteria (L - 90min)

**Goal**: Auto-advance tasks based on real conditions

**Steps**:
1. Create `pipeline/evaluator.rs` module
2. Implement `agent_complete` - check agent_sessions table
3. Implement `script_success` - check last_script_exit_code
4. Implement `checklist_done` - parse and verify JSON
5. Implement `time_elapsed` - check triggered_at vs timeout
6. Implement `manual_approval` - check review_status
7. Add event-driven re-evaluation hooks
8. Add debug logging

**Files**:
- `src-tauri/src/pipeline/evaluator.rs` (NEW)
- `src-tauri/src/pipeline/mod.rs`

**Commit**: `feat(pipeline): implement exit criteria evaluation`

---

### 8. T041: Review Actions (S - 30min)

**Goal**: Wire up approve/reject buttons

**Steps**:
1. Add `approve_task` command
2. Add `reject_task` command (with reason, return column)
3. Wire buttons in task detail panel
4. Show review status on card
5. Integrate with `manual_approval` exit type

**Files**:
- `src-tauri/src/commands/review.rs` (NEW)
- `src/components/review/review-actions.tsx`

**Commit**: `feat(review): wire approve/reject to pipeline state machine`

---

### 9. T024: PR Creation from Review (M - 45min)

**Goal**: Create GitHub PR from task

**Steps**:
1. Add `create_pr` command using `gh` CLI
2. PR title from task title, body from description
3. "Create PR" button in Review column task card
4. Store PR number on task
5. Update task with PR link

**Files**:
- `src-tauri/src/commands/github.rs`
- `src/components/kanban/task-card.tsx`

**Commit**: `feat(github): create PR from Review column task`

---

### 10. T025: Siege Loop (L - 90min)

**Goal**: Auto-fix PR comments until approved

**Steps**:
1. Poll PR for new comments (configurable interval)
2. Parse comments, spawn agent to fix
3. Agent pushes fix commit
4. Loop until approved or max iterations
5. Show iteration count on card
6. Manual stop/takeover option

**Files**:
- `src-tauri/src/siege/mod.rs` (NEW)
- `src-tauri/src/siege/comment_watcher.rs` (NEW)
- `src/components/kanban/siege-status.tsx` (NEW)

**Commit**: `feat(siege): implement PR comment watch and fix loop`

---

## Verification Protocol

After each task:
1. `cargo check` - Rust compiles
2. `npm run type-check` - TypeScript passes
3. `npm run lint` - No lint errors
4. Manual test in `pnpm tauri dev`
5. Commit with conventional message
6. Update STATUS.md ticket status

---

## Recovery Protocol

If stuck on a task for >30min:
1. Document blocker in ticket file
2. Skip to next task (if no dependency)
3. Return to blocked task later with fresh context

---

## Completion Criteria

- [ ] Phase 1 complete (T037, T038, T040)
- [ ] Phase 2 complete (T042, T043, T044)
- [ ] Phase 3 complete (T034, T041)
- [ ] Phase 4 complete (T024, T025)
- [ ] STATUS.md updated
- [ ] All type-check and lint pass
- [ ] App runs without errors

---

## Invoke Command

```
/ralph-loop .tickets/OVERNIGHT-PLAN.md
```

Or manually start with Phase 1:
```
Read .tickets/wiring/T037-checklist-persistence.md
Implement changes
Test in dev mode
Commit: feat(checklist): persist checklist state to database
Continue to T038...
```
