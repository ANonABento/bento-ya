# Overnight Autonomous Session Plan

> **Mode**: Ralph Loop (extended autonomous work)
> **Goal**: Complete all remaining wiring tickets + v0.4 features
> **Process**: Plan → Implement → Test → Review → Commit → Repeat

---

## Execution Order (Dependency-Optimized)

| # | Ticket | Title | Complexity | Est. Time |
|---|--------|-------|------------|-----------|
| 1 | T036 | Metrics Data Collection | S | 30min |
| 2 | T037 | Checklist Persistence | M | 45min |
| 3 | T027 | Notification Column | S | 30min |
| 4 | T038 | Settings Backend Sync | M | 45min |
| 5 | T035 | History Replay Backend | M | 45min |
| 6 | T034 | Pipeline Exit Criteria | L | 60min |
| 7 | T028 | Checklist Auto-Detect & Fix-This | M | 60min |
| 8 | — | Files Sidebar (Chef panel) | M | 45min |
| 9 | T024 | PR Creation from Review | M | 45min |
| 10 | T025 | Siege Loop (Comment-Watch) | L | 90min |
| 11 | T026 | Manual Test Checklist Gen | M | 45min |

**Total Estimated: ~8.5 hours**

---

## Task Details

### 1. T036: Metrics Data Collection (S - 30min)

**Goal**: Track LLM usage so dashboard shows real data

**Steps**:
1. Add `insert_usage_record()` calls after LLM responses in orchestrator
2. Calculate token counts and costs from API response
3. Track workspace_id and optional task_id
4. Test: Send messages, verify `usage_records` table populated
5. Verify: Metrics dashboard shows data

**Files**:
- `src-tauri/src/commands/orchestrator.rs` - Add usage tracking
- `src-tauri/src/db/usage.rs` - Insert helper

**Commit**: `feat(metrics): track LLM usage in orchestrator calls`

---

### 2. T037: Checklist Persistence (M - 45min)

**Goal**: Checklist state survives page refresh

**Steps**:
1. Add `update_checklist_item` command (checked, notes)
2. Add `get_checklist_state` command
3. Update checklist-store to sync with backend
4. Debounce writes (500ms)
5. Load from backend on mount
6. Test: Check items, refresh, verify persistence

**Files**:
- `src-tauri/src/commands/checklist.rs` - CRUD commands
- `src/stores/checklist-store.ts` - Backend sync
- `src/components/checklist/*.tsx` - Wire up

**Commit**: `feat(checklist): persist checklist state to database`

---

### 3. T027: Notification Column (S - 30min)

**Goal**: Column template for post-deploy notifications

**Steps**:
1. Add "Notify" column template to templates-store
2. Manual exit criteria (confirm button)
3. Task detail shows notification context
4. Test: Create notify column, verify exit behavior

**Files**:
- `src/stores/templates-store.ts` - Add template
- `src/components/kanban/task-card.tsx` - Notify UI

**Commit**: `feat(pipeline): add Notification column template`

---

### 4. T038: Settings Backend Sync (M - 45min)

**Goal**: Per-workspace settings, survive browser clear

**Steps**:
1. Split settings: global (localStorage) vs workspace (backend)
2. Add `update_workspace_config` command
3. Load workspace config on switch
4. Merge workspace settings over global defaults
5. Test: Change settings per workspace, verify persistence

**Files**:
- `src-tauri/src/commands/workspace.rs` - Config field CRUD
- `src/stores/settings-store.ts` - Split & sync logic

**Commit**: `feat(settings): per-workspace settings with backend sync`

---

### 5. T035: History Replay Backend (M - 45min)

**Goal**: "Replay" button actually restores state

**Steps**:
1. Add `restore_snapshot` command
2. Parse snapshot JSON, update columns/tasks
3. Create pre-restore snapshot (undo safety)
4. Wire up onReplay prop in history-panel
5. Add confirmation dialog
6. Test: Create snapshot, modify, restore, verify

**Files**:
- `src-tauri/src/commands/history.rs` - restore_snapshot
- `src/components/history/history-panel.tsx` - Wire onReplay

**Commit**: `feat(history): implement snapshot replay/restore`

---

### 6. T034: Pipeline Exit Criteria (L - 60min)

**Goal**: Auto-advance tasks based on real conditions

**Steps**:
1. `agent_complete`: Check agent_sessions status
2. `script_success`: Track & check exit codes
3. `checklist_done`: All required items checked
4. `manual_approval`: User button click
5. `time_elapsed`: Auto-advance after delay
6. Event-driven re-evaluation
7. Test: Configure exit criteria, verify auto-advance

**Files**:
- `src-tauri/src/pipeline/mod.rs` - Exit criteria logic
- `src-tauri/src/pipeline/evaluator.rs` - New evaluation module

**Commit**: `feat(pipeline): implement exit criteria evaluation`

---

### 7. T028: Checklist Auto-Detect & Fix-This (M - 60min)

**Goal**: Auto-scan repo, one-click fix tasks

**Steps**:
1. File-exists detection (glob patterns)
2. File-contains detection (regex search)
3. Command-succeeds detection (run & check exit)
4. "Fix this" button → create task
5. Link checklist item to task
6. Auto-check when task completes
7. Test: Add detection rules, verify auto-check

**Files**:
- `src-tauri/src/checklist/detector.rs` - Detection logic
- `src/components/checklist/checklist-item.tsx` - Fix button

**Commit**: `feat(checklist): auto-detect and fix-this functionality`

---

### 8. Files Sidebar (M - 45min)

**Goal**: View plans, md files, checklists in Chef sidebar

**Steps**:
1. Scan workspace for .md files
2. List plans/notes in sidebar
3. Click to preview in panel
4. Create new note button
5. Test: Add files, verify display

**Files**:
- `src/components/panel/panel-sidebar.tsx` - FilesContent
- `src-tauri/src/commands/files.rs` - List/read files

**Commit**: `feat(chef): implement files sidebar with markdown preview`

---

### 9. T024: PR Creation from Review (M - 45min)

**Goal**: Create GitHub PR from task

**Steps**:
1. "Create PR" button in Review column
2. Use `gh` CLI or GitHub API
3. PR title from task, body from description
4. Update task with PR number/link
5. Test: Create task, move to Review, create PR

**Files**:
- `src-tauri/src/commands/github.rs` - PR creation
- `src/components/kanban/task-card.tsx` - PR button

**Commit**: `feat(github): create PR from Review column`

---

### 10. T025: Siege Loop (L - 90min)

**Goal**: Auto-fix PR comments until approved

**Steps**:
1. Poll PR for new comments (configurable interval)
2. Spawn agent to address comments
3. Agent reads context, fixes, pushes
4. Loop until clean or max iterations
5. PR approved → auto-advance
6. Manual stop/takeover option
7. Show iteration count on card
8. Test: Create PR, add comment, verify fix cycle

**Files**:
- `src-tauri/src/siege/mod.rs` - Siege loop engine
- `src-tauri/src/siege/comment_watcher.rs` - Poll logic
- `src/components/kanban/siege-status.tsx` - UI

**Commit**: `feat(siege): implement PR comment watch and fix loop`

---

### 11. T026: Manual Test Checklist Gen (M - 45min)

**Goal**: Auto-generate test checklist from PR diff

**Steps**:
1. Analyze diff with LLM → test items
2. Generate checklist structure
3. Interactive checklist in task detail
4. All checked → exit criteria met
5. Test: Merge PR, verify checklist generated

**Files**:
- `src-tauri/src/checklist/generator.rs` - LLM generation
- `src/components/checklist/test-checklist.tsx` - UI

**Commit**: `feat(checklist): auto-generate test checklist from PR diff`

---

## Verification Protocol

After each task:
1. `npm run type-check` - Must pass
2. `npm run lint` - Must pass
3. Manual test in `pnpm tauri dev`
4. Commit with conventional message
5. Update STATUS.md ticket status

---

## Recovery Protocol

If stuck on a task for >30min:
1. Document blocker in ticket file
2. Skip to next task
3. Return to blocked task later with fresh context

---

## Completion Criteria

- [ ] All 11 tasks committed
- [ ] STATUS.md updated (all wiring tickets ✅, v0.4 ✅)
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] App runs without errors

---

## Invoke Command

```
/ralph-loop .tickets/OVERNIGHT-PLAN.md
```

Or manually:
```
For each task in order:
  1. Read ticket requirements
  2. Implement changes
  3. Run type-check + lint
  4. Test in dev mode
  5. Commit with message from plan
  6. Mark ticket complete in STATUS.md
  7. Continue to next task
```
