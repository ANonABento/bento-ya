# Overnight V1 Sprint - Agent Teams

> **Mode**: Claude Code Agent Teams (experimental)
> **Goal**: Complete all P0/P1 tickets in single overnight session
> **Est. Duration**: 6-8 hours autonomous

---

## Prerequisites

Enable agent teams in settings:

```json
// ~/.claude/settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "teammateMode": "tmux"  // or "in-process"
}
```

---

## Invoke Command

Start the sprint with:

```bash
cd /Users/bentomac/bento-ya

claude "Create an agent team for the V1 sprint. Read .tickets/OVERNIGHT-V1-SPRINT.md for the full spec.

Spawn 4 teammates:
1. 'frontend' - Terminal input features (T047, T048, T049, T050)
2. 'backend' - History and siege backend (T035, T051)
3. 'features' - Checklist and notification features (T026, T027, T028)
4. 'validator' - Runs type-check, lint after each phase, reviews PRs

Coordinate work through the shared task list. Have teammates message each other when they complete dependencies. Require plan approval before major changes.

After all tasks complete, validator teammate runs final verification, then clean up the team."
```

---

## Team Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                      LEAD (You + Claude)                        │
│  - Reads ticket specs                                           │
│  - Spawns teammates                                             │
│  - Monitors shared task list                                    │
│  - Approves plans                                               │
│  - Commits validated work                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ spawns
         ┌─────────────────┼─────────────────┬─────────────────┐
         │                 │                 │                 │
         v                 v                 v                 v
   ┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐
   │ frontend │      │ backend  │      │ features │      │ validator│
   │          │      │          │      │          │      │          │
   │ T047     │      │ T035     │      │ T026     │      │ type-chk │
   │ T048     │      │ T051     │      │ T027     │      │ lint     │
   │ T049     │◄────►│          │◄────►│ T028     │◄────►│ review   │
   │ T050     │      │          │      │          │      │          │
   └──────────┘      └──────────┘      └──────────┘      └──────────┘
         │                 │                 │                 │
         └─────────────────┴────────┬────────┴─────────────────┘
                                    │
                              shared task list
                              direct messaging
```

---

## Shared Task List

The lead creates this task list. Teammates claim and complete tasks:

```yaml
# Phase 1: Quick Wins (No Dependencies)
- id: T047
  title: Terminal voice integration
  assignee: frontend
  depends_on: []
  status: pending

- id: T048
  title: Thinking level selector
  assignee: frontend
  depends_on: []
  status: pending

- id: T027
  title: Notification column template
  assignee: features
  depends_on: []
  status: pending

# Phase 2: Core Features
- id: T035
  title: History replay restore
  assignee: backend
  depends_on: []
  status: pending

- id: T049
  title: Model selector functional
  assignee: frontend
  depends_on: [T048]  # After thinking selector pattern
  status: pending

- id: T051
  title: Siege loop UI integration
  assignee: backend
  depends_on: [T035]  # Uses similar event patterns
  status: pending

# Phase 3: Complex Features
- id: T026
  title: Test checklist generation
  assignee: features
  depends_on: [T027]
  status: pending

- id: T050
  title: File attachment
  assignee: frontend
  depends_on: [T047]  # After voice wiring pattern
  status: pending

- id: T028
  title: Checklist auto-detect
  assignee: features
  depends_on: [T026]
  status: pending

# Validation (runs after each phase)
- id: VALIDATE-1
  title: Phase 1 validation
  assignee: validator
  depends_on: [T047, T048, T027]
  status: pending

- id: VALIDATE-2
  title: Phase 2 validation
  assignee: validator
  depends_on: [T035, T049, T051]
  status: pending

- id: VALIDATE-3
  title: Final validation
  assignee: validator
  depends_on: [T026, T050, T028]
  status: pending
```

---

## Teammate Spawn Prompts

### Frontend Teammate

```text
You are the 'frontend' teammate for the V1 sprint.

Your tasks:
1. T047: Wire voice input to terminal (use existing useVoiceInput hook)
2. T048: Implement thinking level selector dropdown
3. T049: Make model selector functional with settings integration
4. T050: Add file attachment to terminal input

Work in: src/components/terminal/, src/hooks/

After completing each task:
- Message 'validator' to run type-check
- Mark task complete in shared list
- Claim next available task

Read the full ticket specs in .tickets/v1-sprint/T0XX-*.md before implementing.
```

### Backend Teammate

```text
You are the 'backend' teammate for the V1 sprint.

Your tasks:
1. T035: Implement restore_snapshot Tauri command for history replay
2. T051: Wire siege loop UI to existing backend (events, buttons, badges)

Work in: src-tauri/src/commands/, src/components/history/, src/components/kanban/

After completing each task:
- Message 'validator' to run cargo check
- Mark task complete in shared list
- Message 'frontend' if you add new IPC commands they need

Read the full ticket specs in .tickets/v1-sprint/T0XX-*.md before implementing.
```

### Features Teammate

```text
You are the 'features' teammate for the V1 sprint.

Your tasks:
1. T027: Add notification column template
2. T026: Implement test checklist generation from PR diff
3. T028: Add checklist auto-detect from commit messages

Work in: src/components/checklist/, src/stores/, src-tauri/src/commands/

After completing each task:
- Message 'validator' to run tests
- Mark task complete in shared list

Read the full ticket specs in .tickets/v1-sprint/T0XX-*.md before implementing.
```

### Validator Teammate

```text
You are the 'validator' teammate for the V1 sprint.

Your job:
1. When teammates message you, run validation:
   - npm run type-check
   - npm run lint
   - cargo check
2. Report results back to the teammate
3. If validation fails, provide specific error details
4. After each phase completes, do comprehensive check
5. Final validation: run full test suite, check app runs

Do NOT implement features. Only validate and report.

After final validation passes, message the lead that sprint is complete.
```

---

## Execution Flow

### Phase 1: Quick Wins (Parallel)

```
Lead: "frontend, backend, features - start your Phase 1 tasks"

frontend claims T047, T048
features claims T027
(backend waits - no Phase 1 tasks)

frontend completes T047 → messages validator → validator runs check → passes
frontend completes T048 → messages validator → validator runs check → passes
features completes T027 → messages validator → validator runs check → passes

validator completes VALIDATE-1 → messages lead "Phase 1 complete"
```

### Phase 2: Core Features

```
Lead: "All teammates proceed to Phase 2"

backend claims T035 (no dependencies)
frontend claims T049 (depends on T048 ✓)
backend completes T035 → messages frontend about new IPC
backend claims T051 (depends on T035 ✓)

frontend completes T049 → messages validator
backend completes T051 → messages validator

validator completes VALIDATE-2 → messages lead "Phase 2 complete"
```

### Phase 3: Complex Features

```
Lead: "All teammates proceed to Phase 3"

features claims T026 (depends on T027 ✓)
frontend claims T050 (depends on T047 ✓)

features completes T026
features claims T028 (depends on T026 ✓)

frontend completes T050
features completes T028

validator completes VALIDATE-3 → "All validations pass"
validator: "Sprint complete! All tasks done, all checks pass."
```

### Cleanup

```
Lead: "All teammates shut down"
Lead: "Clean up the team"
Lead: Commits all changes with conventional messages
```

---

## Detailed Task Specs

### T047: Terminal Voice Integration

**Ticket:** `.tickets/v1-sprint/T047-terminal-voice-integration.md`

**Implementation:**
```typescript
// terminal-input.tsx
import { useVoiceInput } from '@/hooks/use-voice-input'

const voice = useVoiceInput({
  onTranscript: (text) => setInput((prev) => prev + ' ' + text),
})

// Replace disabled mic button:
<button
  onClick={voice.state === 'recording' ? voice.stopRecording : voice.startRecording}
  className={`rounded p-1 transition-colors ${
    voice.state === 'recording'
      ? 'text-red-500 animate-pulse'
      : 'text-text-muted hover:text-text-primary'
  }`}
  title={voice.state === 'recording' ? 'Stop recording' : 'Voice input'}
>
  <MicIcon />
</button>
```

---

### T048: Thinking Level Selector

**Ticket:** `.tickets/v1-sprint/T048-thinking-level-selector.md`

**Implementation:**
```typescript
// thinking-selector.tsx
const LEVELS = [
  { id: 'none', label: 'None', description: 'No extended thinking' },
  { id: 'low', label: 'Low', description: 'Brief reasoning' },
  { id: 'medium', label: 'Medium', description: 'Moderate depth' },
  { id: 'high', label: 'High', description: 'Deep analysis' },
] as const

export function ThinkingSelector({ value = 'medium', onChange }: Props) {
  const [open, setOpen] = useState(false)
  const selected = LEVELS.find(l => l.id === value)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary"
      >
        <BrainIcon className="h-3 w-3" />
        {selected?.label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 rounded border border-border-default bg-bg-secondary py-1 shadow-lg min-w-[140px]">
          {LEVELS.map((level) => (
            <button
              key={level.id}
              onClick={() => { onChange?.(level.id); setOpen(false) }}
              className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-bg-tertiary ${
                level.id === value ? 'text-accent' : 'text-text-secondary'
              }`}
            >
              <div>{level.label}</div>
              <div className="text-text-muted text-[10px]">{level.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

---

### T035: History Replay Restore

**Ticket:** `.tickets/v1-sprint/T035-history-replay.md`

**Backend:**
```rust
// src-tauri/src/commands/history.rs

#[derive(Serialize)]
pub struct RestoreResult {
    pub backup_id: String,
    pub restored_at: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn restore_snapshot(
    snapshot_id: String,
    state: State<'_, AppState>,
) -> Result<RestoreResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;

    // Get snapshot
    let snapshot = db::get_snapshot(&conn, &snapshot_id)
        .map_err(|e| format!("Failed to get snapshot: {}", e))?;

    // Create backup before restore
    let backup_id = db::create_snapshot(
        &conn,
        &snapshot.workspace_id,
        "pre-restore-backup",
        &snapshot.data  // Current state
    ).map_err(|e| format!("Failed to create backup: {}", e))?;

    // Parse and restore
    let data: serde_json::Value = serde_json::from_str(&snapshot.data)
        .map_err(|e| format!("Invalid snapshot data: {}", e))?;

    // Restore columns and tasks
    db::restore_workspace_state(&conn, &snapshot.workspace_id, &data)
        .map_err(|e| format!("Failed to restore: {}", e))?;

    Ok(RestoreResult {
        backup_id,
        restored_at: chrono::Utc::now().to_rfc3339(),
    })
}
```

**Frontend:**
```typescript
// Where HistoryPanel is rendered
<HistoryPanel
  workspaceId={activeWorkspaceId}
  onClose={() => setShowHistory(false)}
  onReplay={async (snapshot) => {
    const confirmed = await confirm(
      `Restore workspace to "${snapshot.name}"?\n\nA backup will be created automatically.`
    )
    if (confirmed) {
      try {
        const result = await restoreSnapshot(snapshot.id)
        await refreshWorkspace()
        toast.success(`Restored! Backup created: ${result.backupId}`)
        setShowHistory(false)
      } catch (e) {
        toast.error(`Restore failed: ${e}`)
      }
    }
  }}
/>
```

---

### T051: Siege Loop UI

**Ticket:** `.tickets/v1-sprint/T051-siege-ui-integration.md`

**Task Card Badge:**
```typescript
// task-card.tsx - add to badges section
{task.siegeActive && (
  <span className="inline-flex items-center gap-1 rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] text-orange-400">
    <SwordsIcon className="h-3 w-3" />
    {task.siegeIteration}/{task.siegeMaxIterations}
  </span>
)}
```

**Context Menu Actions:**
```typescript
// task-card.tsx - add to context menu
{task.prNumber && !task.siegeActive && (
  <ContextMenuItem onClick={() => startSiege(task.id)}>
    <SwordsIcon className="h-4 w-4" />
    Start Siege Loop
  </ContextMenuItem>
)}
{task.siegeActive && (
  <ContextMenuItem onClick={() => stopSiege(task.id)} variant="destructive">
    <StopIcon className="h-4 w-4" />
    Stop Siege
  </ContextMenuItem>
)}
```

**Event Listener Hook:**
```typescript
// hooks/use-siege-events.ts
export function useSiegeEvents() {
  useEffect(() => {
    const listeners = [
      listen('siege:started', (e) => {
        toast.info(`Siege started for ${e.payload.taskId}`)
      }),
      listen('siege:iteration', (e) => {
        toast.info(`Siege iteration ${e.payload.iteration}/${e.payload.maxIterations}`)
      }),
      listen('siege:complete', (e) => {
        toast.success(`Siege complete: ${e.payload.message}`)
      }),
      listen('siege:stopped', (e) => {
        toast.warn('Siege stopped')
      }),
    ]

    return () => {
      listeners.forEach(p => p.then(f => f()))
    }
  }, [])
}
```

---

## Validation Commands

The validator teammate runs these:

```bash
# TypeScript
npm run type-check

# Lint
npm run lint

# Rust
cargo check
cargo clippy

# Full test (final validation only)
cargo test
npm run test

# Smoke test
pnpm tauri dev  # Manual verify app launches
```

---

## Recovery Protocol

**If teammate gets stuck:**
```text
Lead → Teammate: "What's blocking you? Share the error."
Teammate → Lead: <error details>
Lead: Reviews and provides guidance or reassigns task
```

**If validation fails:**
```text
Validator → Teammate: "Type-check failed: <specific errors>"
Teammate: Fixes issues
Teammate → Validator: "Fixed, please re-validate"
```

**If teammate crashes:**
```text
Lead: Spawns replacement teammate with same prompt
Lead: "New frontend teammate, claim uncompleted tasks from the list"
```

---

## Success Criteria

- [ ] All 10 tasks marked complete in shared list
- [ ] All 3 validation tasks pass
- [ ] `npm run type-check` clean
- [ ] `npm run lint` clean
- [ ] `cargo check` clean
- [ ] App launches without errors
- [ ] No "coming in vX.X" tooltips remain
- [ ] Commits have conventional messages

---

## Estimated Timeline

| Time | Activity |
|------|----------|
| 0:00 | Lead spawns 4 teammates |
| 0:15 | Phase 1 starts (parallel) |
| 1:30 | Phase 1 complete, validation |
| 1:45 | Phase 2 starts |
| 4:00 | Phase 2 complete, validation |
| 4:15 | Phase 3 starts |
| 6:30 | Phase 3 complete, final validation |
| 7:00 | Cleanup, commits |
| **~7hr** | **Complete** |

Start at 11pm → Complete by 6am
