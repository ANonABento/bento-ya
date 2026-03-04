# Overnight V1 Sprint - Multi-Agent Orchestration

> **Mode**: Claude Orchestrator + Parallel Agents
> **Goal**: Complete all P0/P1 tickets in single overnight session
> **Process**: Orchestrator assigns → Agents implement → Validator checks → Commit
> **Est. Duration**: 6-8 hours autonomous

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR (Opus)                         │
│  - Reads ticket specs                                           │
│  - Assigns to worker agents                                     │
│  - Monitors progress                                            │
│  - Handles blockers                                             │
│  - Commits validated work                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         v                 v                 v
   ┌──────────┐      ┌──────────┐      ┌──────────┐
   │ WORKER 1 │      │ WORKER 2 │      │ WORKER 3 │
   │ (Sonnet) │      │ (Sonnet) │      │ (Sonnet) │
   │          │      │          │      │          │
   │ Frontend │      │ Backend  │      │ Wiring   │
   └────┬─────┘      └────┬─────┘      └────┬─────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          v
                   ┌──────────┐
                   │ VALIDATOR│
                   │ (Haiku)  │
                   │          │
                   │ Type/Lint│
                   │ Test     │
                   └──────────┘
```

---

## Execution Phases

### Phase 1: Quick Wins (Parallel - 1.5 hrs)

These have no dependencies, run all 3 simultaneously.

| Agent | Ticket | Task | Effort |
|-------|--------|------|--------|
| Worker 1 | T047 | Terminal voice integration | S |
| Worker 2 | T048 | Thinking level selector | S |
| Worker 3 | T027 | Notification column template | S |

**Orchestrator Actions:**
```
1. Spawn 3 parallel Task agents
2. Each reads their ticket spec
3. Implements changes
4. Returns completion signal
5. Validator runs type-check + lint
6. If pass → commit all 3
7. If fail → fix and retry
```

### Phase 2: Core Features (Sequential - 3 hrs)

Dependencies require sequential execution.

| Order | Ticket | Task | Depends On | Effort |
|-------|--------|------|------------|--------|
| 1 | T035 | History replay restore | - | M |
| 2 | T049 | Model selector functional | - | M |
| 3 | T051 | Siege loop UI | T035 patterns | M |

**Orchestrator Actions:**
```
1. T035: Implement restore_snapshot backend
   - Add Tauri command
   - Wire HistoryPanel callback
   - Validate with manual test
   - Commit

2. T049: Implement model selector
   - Dropdown component
   - Settings integration
   - Agent spawn wiring
   - Commit

3. T051: Siege UI integration
   - Start/stop buttons
   - Event listeners
   - Task card badge
   - Commit
```

### Phase 3: Complex Features (Sequential - 2.5 hrs)

Require careful implementation.

| Order | Ticket | Task | Effort |
|-------|--------|------|--------|
| 1 | T026 | Test checklist generation | M |
| 2 | T050 | File attachment | M |

**Orchestrator Actions:**
```
1. T026: Test checklist from PR diff
   - Agent prompt engineering
   - Checklist UI wiring
   - Auto-advance logic
   - Commit

2. T050: File attachment
   - Tauri file dialog
   - Base64 encoding
   - UI components
   - Commit
```

### Phase 4: Polish (Parallel - 1 hr)

Independent polish tasks.

| Agent | Ticket | Task | Effort |
|-------|--------|------|--------|
| Worker 1 | T028 | Checklist auto-detect | M |
| Worker 2 | - | Remove stale tooltips | S |
| Worker 3 | - | Update STATUS.md | S |

---

## Detailed Task Specs

### T047: Terminal Voice Integration (S - 30min)

**Current State:**
- `terminal-input.tsx:105-116` has disabled mic button
- `use-voice-input.ts` hook exists and works in panel

**Implementation:**
```typescript
// terminal-input.tsx
import { useVoiceInput } from '@/hooks/use-voice-input'

// Inside component:
const voice = useVoiceInput({
  onTranscript: (text) => setInput((prev) => prev + text),
})

// Replace disabled button with:
<button
  onClick={voice.state === 'recording' ? voice.stopRecording : voice.startRecording}
  className={`rounded p-1 ${voice.state === 'recording' ? 'text-red-500 animate-pulse' : 'text-text-muted hover:text-text-primary'}`}
>
  <MicIcon />
</button>
```

**Validation:**
- [ ] Type-check passes
- [ ] Mic button clickable
- [ ] Recording state visible
- [ ] Transcription appears in input

---

### T048: Thinking Level Selector (S - 30min)

**Current State:**
- `thinking-selector.tsx` is display-only stub

**Implementation:**
```typescript
// thinking-selector.tsx
const LEVELS = ['None', 'Low', 'Medium', 'High'] as const

export function ThinkingSelector({ value = 'Medium', onChange }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}>
        <BrainIcon /> {value}
      </button>
      {open && (
        <div className="dropdown">
          {LEVELS.map(level => (
            <button key={level} onClick={() => onChange?.(level)}>
              {level}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Wire to agent:**
- Store in task store or session config
- Pass to `start_agent` command
- Map to Claude CLI `--thinking` flag

**Validation:**
- [ ] Dropdown opens/closes
- [ ] Selection changes display
- [ ] Value persists

---

### T035: History Replay Restore (M - 60min)

**Current State:**
- `history-panel.tsx` has Replay button
- `onReplay` callback never provided
- No `restore_snapshot` backend command

**Backend Implementation:**
```rust
// src-tauri/src/commands/history.rs

#[tauri::command]
pub async fn restore_snapshot(
    snapshot_id: String,
    mode: String, // "overwrite" | "new_workspace"
    state: State<'_, AppState>,
) -> Result<RestoreResult, String> {
    let conn = state.db.lock().unwrap();

    // 1. Get snapshot
    let snapshot = db::get_snapshot(&conn, &snapshot_id)?;

    // 2. Create backup of current state
    let backup_id = db::create_snapshot(&conn, &snapshot.workspace_id, "pre-restore-backup")?;

    // 3. Parse snapshot data
    let data: SnapshotData = serde_json::from_str(&snapshot.data)?;

    // 4. Restore based on mode
    match mode.as_str() {
        "overwrite" => {
            // Delete current columns/tasks
            db::clear_workspace(&conn, &snapshot.workspace_id)?;
            // Recreate from snapshot
            for col in data.columns {
                db::create_column(&conn, &col)?;
            }
            for task in data.tasks {
                db::create_task(&conn, &task)?;
            }
        }
        "new_workspace" => {
            // Create new workspace with snapshot data
            let new_ws = db::create_workspace(&conn, &format!("{} (restored)", snapshot.name))?;
            // ... copy data to new workspace
        }
    }

    Ok(RestoreResult { backup_id, restored_at: now() })
}
```

**Frontend Implementation:**
```typescript
// Provide onReplay to HistoryPanel
<HistoryPanel
  workspaceId={activeWorkspaceId}
  onClose={() => setShowHistory(false)}
  onReplay={async (snapshot) => {
    const confirmed = await confirm(`Restore to "${snapshot.name}"?`)
    if (confirmed) {
      await restoreSnapshot(snapshot.id, 'overwrite')
      await refreshWorkspace()
      toast.success('Restored successfully')
    }
  }}
/>
```

**Validation:**
- [ ] Replay button works
- [ ] Confirmation dialog shows
- [ ] Workspace state actually restores
- [ ] Backup created before restore

---

### T049: Model Selector Functional (M - 45min)

**Current State:**
- `model-selector.tsx` is display-only

**Implementation:**
```typescript
// model-selector.tsx
export function ModelSelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const providers = useSettingsStore(s => s.global.model.providers)
  const enabledProviders = providers.filter(p => p.enabled)

  const models = enabledProviders.flatMap(p => ({
    id: `${p.id}/${p.defaultModel}`,
    name: p.defaultModel,
    provider: p.name,
  }))

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}>
        <ModelIcon /> {value || 'Auto'}
      </button>
      {open && (
        <div className="dropdown">
          <button onClick={() => onChange?.('auto')}>Auto (Orchestrator)</button>
          {models.map(m => (
            <button key={m.id} onClick={() => onChange?.(m.id)}>
              {m.name} <span className="text-muted">({m.provider})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Wire to agent spawn:**
- Pass selected model to `start_agent`
- Backend maps model ID to CLI/API config

**Validation:**
- [ ] Dropdown shows configured models
- [ ] Selection changes agent behavior
- [ ] "Auto" option works

---

### T051: Siege Loop UI Integration (M - 60min)

**Current State:**
- Backend fully implemented in `siege.rs`
- Events: `siege:started`, `siege:iteration`, `siege:stopped`, `siege:complete`
- No UI controls

**Implementation:**

1. **Task Card Badge:**
```typescript
// task-card.tsx
{task.siegeActive && (
  <div className="badge bg-orange-500">
    Siege {task.siegeIteration}/{task.siegeMaxIterations}
  </div>
)}
```

2. **Control Buttons:**
```typescript
// task-detail.tsx or task-card context menu
{task.prNumber && !task.siegeActive && (
  <button onClick={() => startSiege(task.id)}>
    Start Siege Loop
  </button>
)}
{task.siegeActive && (
  <button onClick={() => stopSiege(task.id)}>
    Stop Siege
  </button>
)}
```

3. **Event Listeners:**
```typescript
// app.tsx or siege-listener hook
useEffect(() => {
  const unlisten = listen('siege:iteration', (event) => {
    toast.info(`Siege iteration ${event.payload.iteration}`)
    refreshTask(event.payload.taskId)
  })
  return () => { unlisten.then(f => f()) }
}, [])
```

**Validation:**
- [ ] Start siege button appears for PR tasks
- [ ] Badge shows iteration count
- [ ] Stop button works
- [ ] Events update UI in real-time

---

### T026: Test Checklist Generation (M - 60min)

**Implementation:**

1. **Agent Prompt:**
```typescript
const generateChecklistPrompt = (diff: string, prTitle: string) => `
Analyze this PR and generate a test checklist.

PR: ${prTitle}
Diff:
${diff}

Generate 5-10 specific test items that a human should verify.
Format as JSON array: [{"text": "...", "category": "..."}]
Categories: UI, API, Logic, Edge Cases, Performance
`
```

2. **Backend Command:**
```rust
#[tauri::command]
pub async fn generate_test_checklist(task_id: String) -> Result<Vec<ChecklistItem>, String> {
    // Get PR diff
    let diff = get_pr_diff(&task_id)?;
    // Call LLM
    let items = call_llm(generate_checklist_prompt(&diff))?;
    // Store on task
    update_task_checklist(&task_id, &items)?;
    Ok(items)
}
```

3. **UI Trigger:**
```typescript
// When task enters "Test" column or on demand
<button onClick={() => generateTestChecklist(task.id)}>
  Generate Test Checklist
</button>
```

**Validation:**
- [ ] Generates relevant test items
- [ ] Items appear in checklist UI
- [ ] All checked → task can advance

---

### T050: File Attachment (M - 60min)

**Implementation:**

1. **Tauri File Dialog:**
```rust
// commands/files.rs
#[tauri::command]
pub async fn pick_file() -> Result<FileSelection, String> {
    let file = tauri::api::dialog::blocking::FileDialogBuilder::new()
        .add_filter("Images", &["png", "jpg", "gif"])
        .add_filter("Text", &["txt", "md", "json"])
        .pick_file();

    match file {
        Some(path) => {
            let content = std::fs::read(&path)?;
            let base64 = base64::encode(&content);
            Ok(FileSelection { path, base64, mime_type: detect_mime(&path) })
        }
        None => Err("No file selected".into())
    }
}
```

2. **UI Components:**
```typescript
// terminal-input.tsx
const [attachments, setAttachments] = useState<Attachment[]>([])

const handleAttach = async () => {
  const file = await pickFile()
  setAttachments(prev => [...prev, file])
}

// Show attachment chips
{attachments.map(a => (
  <div className="attachment-chip">
    {a.name}
    <button onClick={() => removeAttachment(a)}>×</button>
  </div>
))}
```

3. **Send with Message:**
```typescript
const send = async () => {
  await invoke('send_message', {
    taskId,
    message: input,
    attachments: attachments.map(a => ({
      type: a.mimeType,
      data: a.base64,
    }))
  })
}
```

**Validation:**
- [ ] File picker opens
- [ ] Selected file shows as chip
- [ ] Image preview works
- [ ] Attachment sent to agent

---

## Orchestration Script

```typescript
// overnight-v1-sprint.ts - Run with: npx ts-node overnight-v1-sprint.ts

const TICKETS = {
  phase1: ['T047', 'T048', 'T027'],  // Parallel
  phase2: ['T035', 'T049', 'T051'],  // Sequential
  phase3: ['T026', 'T050'],          // Sequential
  phase4: ['T028'],                   // Parallel
}

async function runPhase(name: string, tickets: string[], parallel: boolean) {
  console.log(`\n=== Phase: ${name} ===\n`)

  if (parallel) {
    await Promise.all(tickets.map(t => runTicket(t)))
  } else {
    for (const t of tickets) {
      await runTicket(t)
    }
  }

  // Validate phase
  await runCommand('npm run type-check')
  await runCommand('npm run lint')

  // Commit phase
  await runCommand(`git add -A && git commit -m "feat: complete ${name}"`)
}

async function runTicket(ticketId: string) {
  console.log(`\n--- ${ticketId} ---`)

  // Read ticket spec
  const spec = await readFile(`.tickets/v1-sprint/${ticketId}-*.md`)

  // Spawn worker agent
  const result = await spawnAgent({
    type: 'worker',
    model: 'sonnet',
    prompt: `
      Implement this ticket:
      ${spec}

      Requirements:
      1. Make minimal changes
      2. Follow existing patterns
      3. Add no extra features
      4. Test your changes work

      When done, output: COMPLETE
    `,
  })

  if (!result.includes('COMPLETE')) {
    throw new Error(`${ticketId} failed`)
  }
}

// Main execution
async function main() {
  await runPhase('Quick Wins', TICKETS.phase1, true)
  await runPhase('Core Features', TICKETS.phase2, false)
  await runPhase('Complex Features', TICKETS.phase3, false)
  await runPhase('Polish', TICKETS.phase4, true)

  // Final validation
  await runCommand('npm run type-check')
  await runCommand('npm run lint')
  await runCommand('cargo test')

  console.log('\n✅ V1 Sprint Complete!\n')
}

main().catch(console.error)
```

---

## Invoke Command

### Option 1: Ralph Loop (Single Agent)
```bash
/ralph-loop .tickets/OVERNIGHT-V1-SPRINT.md
```

### Option 2: Multi-Agent (Claude Code)
```bash
# Start orchestrator
claude --model opus "Execute .tickets/OVERNIGHT-V1-SPRINT.md using parallel Task agents for each phase. Validate after each phase. Commit incrementally."
```

### Option 3: Manual Phase Execution
```bash
# Phase 1 (parallel)
claude "Implement T047, T048, T027 in parallel" &
wait

# Phase 2 (sequential)
claude "Implement T035" && claude "Implement T049" && claude "Implement T051"

# etc.
```

---

## Recovery Protocol

**If agent stuck >30min:**
1. Log blocker in ticket file
2. Skip to next ticket
3. Return with fresh context

**If validation fails:**
1. Read error output
2. Fix specific issue
3. Re-run validation
4. Do NOT proceed until green

**If phase fails:**
1. `git stash` partial work
2. Document state
3. Restart phase from scratch

---

## Success Criteria

- [ ] All P0 tickets complete (T035, T047, T051)
- [ ] All P1 tickets complete (T048, T049, T026, T050)
- [ ] P2 polish complete (T027, T028)
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `cargo check` passes
- [ ] App runs without console errors
- [ ] No "coming in vX.X" tooltips remain
- [ ] STATUS.md updated
- [ ] All commits have conventional messages

---

## Estimated Timeline

| Phase | Duration | Tickets |
|-------|----------|---------|
| Setup | 15min | Read specs, verify env |
| Phase 1 | 1.5hr | T047, T048, T027 (parallel) |
| Phase 2 | 3hr | T035, T049, T051 (sequential) |
| Phase 3 | 2.5hr | T026, T050 (sequential) |
| Phase 4 | 1hr | T028, polish (parallel) |
| Validation | 30min | Final checks, STATUS update |
| **Total** | **~8hr** | |

Start at 10pm → Complete by 6am
