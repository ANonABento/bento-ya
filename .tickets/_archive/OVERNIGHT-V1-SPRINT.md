# Overnight V1 Sprint - Per-Ticket Agent Teams

> **Mode**: Claude Code Agent Teams - One team per ticket
> **Goal**: Deep implementation with built-in review for each feature
> **Est. Duration**: 8-10 hours autonomous

---

## Philosophy

Instead of spreading teammates across tickets, each ticket gets its own dedicated team:

```
Traditional:                    Per-Ticket Teams:

frontend → T047, T048...       T047 Team:
backend  → T035, T051...         ├── implementer
features → T026, T027...         ├── reviewer
validator → all                  ├── tester
                                 └── lead validates

Shallow but parallel           Deep and thorough
```

**Benefits:**
- Implementer + Reviewer catch issues immediately
- Tester writes tests as code is written
- No context switching between unrelated features
- Each ticket gets full attention

---

## Prerequisites

```json
// ~/.claude/settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "teammateMode": "tmux"
}
```

---

## Execution Order

Run tickets sequentially. Each gets a full team, completes, validates, commits, then next.

| # | Ticket | Team Size | Est. Time |
|---|--------|-----------|-----------|
| 1 | T047 - Terminal Voice | 3 agents | 45min |
| 2 | T048 - Thinking Selector | 3 agents | 45min |
| 3 | T049 - Model Selector | 3 agents | 60min |
| 4 | T035 - History Replay | 4 agents | 90min |
| 5 | T051 - Siege UI | 4 agents | 90min |
| 6 | T026 - Test Checklist | 4 agents | 90min |
| 7 | T050 - File Attachment | 4 agents | 90min |
| 8 | T027 - Notification Column | 3 agents | 45min |
| 9 | T028 - Checklist Auto-detect | 3 agents | 60min |
| | **Total** | | **~10hr** |

---

## Team Templates

### Small Team (3 agents) - Simple Features

```
┌─────────────────────────────────────────┐
│              LEAD (You)                 │
│  - Approves plans                       │
│  - Commits when complete                │
└────────────────┬────────────────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    v            v            v
┌────────┐  ┌────────┐  ┌────────┐
│implement│  │ review │  │  test  │
│         │  │        │  │        │
│ writes  │─►│challenges│─►│validates│
│ code    │  │ approach│  │ & types │
└────────┘  └────────┘  └────────┘
```

### Large Team (4 agents) - Complex Features

```
┌─────────────────────────────────────────┐
│              LEAD (You)                 │
└────────────────┬────────────────────────┘
                 │
    ┌────────────┼────────────┬────────────┐
    │            │            │            │
    v            v            v            v
┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
│implement│  │ review │  │  test  │  │research│
│         │  │        │  │        │  │        │
│ writes  │  │devils  │  │writes  │  │finds   │
│ code    │  │advocate│  │tests   │  │patterns│
└────────┘  └────────┘  └────────┘  └────────┘
     │            │            │            │
     └────────────┴─────┬──────┴────────────┘
                        │
                  debate & iterate
```

---

## Per-Ticket Invoke Commands

### T047: Terminal Voice Integration

```bash
claude "Create an agent team for T047 - Terminal Voice Integration.

Read the ticket: .tickets/v1-sprint/T047-terminal-voice-integration.md

Spawn 3 teammates:
1. 'implementer' - Wire useVoiceInput hook to terminal-input.tsx
2. 'reviewer' - Review the implementation, suggest improvements, check edge cases
3. 'tester' - Run type-check, verify the button works, check recording states

Workflow:
- implementer writes the code, messages reviewer when ready
- reviewer challenges the approach, suggests fixes
- implementer addresses feedback
- tester validates everything works
- When all agree it's good, message lead to commit

Require plan approval from implementer before coding."
```

---

### T048: Thinking Level Selector

```bash
claude "Create an agent team for T048 - Thinking Level Selector.

Read the ticket: .tickets/v1-sprint/T048-thinking-level-selector.md

Spawn 3 teammates:
1. 'implementer' - Build dropdown component with None/Low/Medium/High levels
2. 'reviewer' - Verify UX matches other selectors, check accessibility
3. 'tester' - Type-check, test dropdown behavior, verify state persistence

The component should follow the same pattern as mode-selector.tsx.
Wire the selection to agent spawn config.

Require plan approval before implementation."
```

---

### T049: Model Selector Functional

```bash
claude "Create an agent team for T049 - Model Selector.

Read the ticket: .tickets/v1-sprint/T049-model-selector-functional.md

Spawn 3 teammates:
1. 'implementer' - Convert display-only component to functional dropdown
2. 'reviewer' - Check settings integration, verify model list from providers
3. 'tester' - Type-check, test selection persists, verify agent uses selected model

Current code in model-selector.tsx is just a display stub.
Need to read providers from settings store and wire to agent spawn.

Require plan approval before implementation."
```

---

### T035: History Replay Restore

```bash
claude "Create an agent team for T035 - History Replay Restore.

Read the ticket: .tickets/v1-sprint/T035-history-replay.md

Spawn 4 teammates:
1. 'implementer' - Add restore_snapshot Tauri command, wire to HistoryPanel
2. 'reviewer' - Review Rust code safety, check error handling, verify backup creation
3. 'tester' - cargo check, test restore actually works, verify backup created
4. 'researcher' - Check existing snapshot format, find best restore approach

This is complex - involves:
- New Rust command in history.rs
- Database operations to restore state
- Frontend callback wiring
- Confirmation dialog

Have researcher share findings with implementer first.
Reviewer should be skeptical - this touches production data.

Require plan approval before any database changes."
```

---

### T051: Siege Loop UI Integration

```bash
claude "Create an agent team for T051 - Siege Loop UI.

Read the ticket: .tickets/v1-sprint/T051-siege-ui-integration.md

Spawn 4 teammates:
1. 'implementer' - Add siege badge to task card, context menu actions, event listeners
2. 'reviewer' - Check event handling, verify UI updates correctly, review state management
3. 'tester' - Type-check, verify events fire correctly, test start/stop buttons
4. 'researcher' - Read existing siege.rs backend, understand event payloads

Backend is DONE in src-tauri/src/commands/siege.rs.
Events: siege:started, siege:iteration, siege:stopped, siege:complete

Focus on:
- Task card badge showing iteration count
- Context menu Start/Stop actions
- Event listener hook for toasts
- Task store updates on events

Have researcher explain the backend to implementer first.

Require plan approval before implementation."
```

---

### T026: Test Checklist Generation

```bash
claude "Create an agent team for T026 - Test Checklist Generation.

Read the ticket: .tickets/v1-sprint/T026-manual-test-checklist.md

Spawn 4 teammates:
1. 'implementer' - Build prompt engineering + backend command + UI trigger
2. 'reviewer' - Review LLM prompt quality, check checklist format
3. 'tester' - Test with real PR diffs, verify items are sensible
4. 'researcher' - Find best prompt patterns for test generation

This generates test items from PR diff using LLM:
- New Tauri command: generate_test_checklist
- Prompt that analyzes diff and produces test items
- UI button to trigger generation
- Items appear in existing checklist component

Have reviewer challenge the prompt - it needs to produce USEFUL test items.

Require plan approval for prompt design."
```

---

### T050: File Attachment

```bash
claude "Create an agent team for T050 - File Attachment.

Read the ticket: .tickets/v1-sprint/T050-file-attachment.md

Spawn 4 teammates:
1. 'implementer' - Tauri file dialog, base64 encoding, UI components
2. 'reviewer' - Check file size limits, verify MIME handling, review security
3. 'tester' - Test with images, text files, verify attachment sent to agent
4. 'researcher' - Check Tauri file dialog API, find existing patterns

Need:
- Pick file via Tauri dialog
- Base64 encode for images
- Show attachment chip in input
- Send with message to agent
- Support drag-drop and paste

Reviewer should focus on security - we're handling user files.

Require plan approval before implementation."
```

---

### T027: Notification Column Template

```bash
claude "Create an agent team for T027 - Notification Column.

Read the ticket: .tickets/v1-sprint/T027-notification-column.md

Spawn 3 teammates:
1. 'implementer' - Add notification column template to templates store
2. 'reviewer' - Check template format matches existing ones
3. 'tester' - Type-check, verify template appears in gallery

Simple feature - add a new column template:
- Name: 'Notify'
- Shows task summary and who to notify
- Manual exit criteria (user confirms notification sent)

Follow pattern in src/stores/templates-store.ts

Require plan approval."
```

---

### T028: Checklist Auto-detect

```bash
claude "Create an agent team for T028 - Checklist Auto-detect.

Read the ticket: .tickets/v1-sprint/T028-checklist-auto-detect.md

Spawn 3 teammates:
1. 'implementer' - Parse commit messages/PR body for checkboxes, populate checklist
2. 'reviewer' - Review regex patterns, check edge cases
3. 'tester' - Test with various checkbox formats, verify items created

Detect patterns like:
- [ ] Todo item
- [x] Done item
- * Todo item
- - Todo item

Parse from PR description or commit messages.
Auto-populate task checklist with found items.

Require plan approval for parsing logic."
```

---

## Master Orchestration Script

Run all tickets sequentially with teams:

```bash
#!/bin/bash
# overnight-v1.sh

cd /Users/bentomac/bento-ya

TICKETS=(
  "T047:3:Terminal Voice Integration"
  "T048:3:Thinking Level Selector"
  "T049:3:Model Selector Functional"
  "T035:4:History Replay Restore"
  "T051:4:Siege Loop UI"
  "T026:4:Test Checklist Generation"
  "T050:4:File Attachment"
  "T027:3:Notification Column"
  "T028:3:Checklist Auto-detect"
)

for ticket in "${TICKETS[@]}"; do
  IFS=':' read -r id size name <<< "$ticket"

  echo "=========================================="
  echo "Starting team for $id: $name ($size agents)"
  echo "=========================================="

  claude "Create an agent team for $id - $name.

Read .tickets/v1-sprint/$id-*.md for the full spec.
Read .tickets/OVERNIGHT-V1-SPRINT.md for team patterns.

Spawn $size teammates following the template for this ticket size.
Require plan approval before implementation.

When complete:
1. All teammates validate the work
2. Run: npm run type-check && npm run lint && cargo check
3. If pass, commit: git add -A && git commit -m 'feat: $id $name'
4. Clean up the team
5. Exit"

  echo "Completed $id"
  echo ""
done

echo "V1 Sprint Complete!"
```

---

## Per-Ticket Team Workflow

Each team follows this flow:

```
1. LEAD spawns teammates with specific prompts
   │
2. RESEARCHER (if present) explores codebase
   │ shares findings with team
   │
3. IMPLEMENTER creates plan
   │ sends to LEAD for approval
   │
4. LEAD approves plan
   │
5. IMPLEMENTER writes code
   │ messages REVIEWER when ready
   │
6. REVIEWER challenges implementation
   │ suggests improvements
   │ debates with IMPLEMENTER
   │
7. IMPLEMENTER addresses feedback
   │ iterates until REVIEWER approves
   │
8. TESTER runs validation
   │ - npm run type-check
   │ - npm run lint
   │ - cargo check (if Rust)
   │ - manual verification
   │
9. TESTER reports results
   │
10. If PASS:
    │ LEAD commits with conventional message
    │ LEAD cleans up team
    │
11. If FAIL:
    │ IMPLEMENTER fixes
    │ Return to step 6
```

---

## Teammate Role Prompts

### Implementer

```text
You are 'implementer' for this ticket.

Your job:
1. Read the ticket spec carefully
2. Create a plan (share with lead for approval)
3. Write clean, minimal code
4. Follow existing patterns in the codebase
5. Message 'reviewer' when ready for review
6. Address all reviewer feedback
7. Do NOT over-engineer

When reviewer approves, message 'tester' to validate.
```

### Reviewer

```text
You are 'reviewer' for this ticket.

Your job:
1. Wait for implementer to message you
2. Review their code critically:
   - Does it follow existing patterns?
   - Are there edge cases missed?
   - Is error handling sufficient?
   - Could it be simpler?
3. Challenge assumptions - be the devil's advocate
4. Message back with specific feedback
5. Approve only when code is solid

Do NOT be a rubber stamp. Find real issues.
```

### Tester

```text
You are 'tester' for this ticket.

Your job:
1. Wait for implementer + reviewer to finish
2. Run validation commands:
   - npm run type-check
   - npm run lint
   - cargo check (if Rust changes)
3. Manually verify the feature works
4. Report results to the team
5. If issues found, message implementer with specifics

Be thorough. Don't just run commands - verify behavior.
```

### Researcher

```text
You are 'researcher' for this ticket.

Your job:
1. Explore the codebase for relevant patterns
2. Read existing similar implementations
3. Find potential issues or conflicts
4. Share findings with implementer BEFORE they start
5. Stay available to answer questions

Focus on: existing patterns, potential conflicts, best approaches.
Do NOT write implementation code.
```

---

## Validation Checklist (Per Ticket)

Before committing each ticket:

- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `cargo check` passes (if Rust)
- [ ] Feature manually verified working
- [ ] No console errors
- [ ] Reviewer approved implementation
- [ ] Follows existing code patterns
- [ ] No unnecessary changes

---

## Recovery Protocols

### If implementer gets stuck

```text
Lead: "implementer, what's blocking you?"
Implementer: <describes issue>
Lead: "reviewer, researcher - help debug this"
Team collaborates to unblock
```

### If reviewer and implementer disagree

```text
Lead: "Both share your reasoning"
Implementer: <explains approach>
Reviewer: <explains concern>
Lead: Makes final decision based on ticket requirements
```

### If validation fails

```text
Tester: "Type-check failed: <specific errors>"
Implementer: Fixes the issues
Implementer → Reviewer: "Fixed, please re-review"
Reviewer: Quick re-review
Tester: Re-runs validation
```

### If team gets stuck >30min

```text
Lead: "Team, we're stuck. Let's document the blocker and move on."
Lead: Adds blocker note to ticket
Lead: "Clean up this team, we'll return with fresh context"
Lead: Moves to next ticket
```

---

## Success Criteria

- [ ] All 9 tickets completed
- [ ] Each ticket has passing validation
- [ ] Each commit follows conventional format
- [ ] No "coming in vX.X" tooltips remain
- [ ] App launches without errors
- [ ] All new features manually verified

---

## Timeline

| Time | Ticket | Team |
|------|--------|------|
| 0:00 | T047 Terminal Voice | 3 |
| 0:45 | T048 Thinking Selector | 3 |
| 1:30 | T049 Model Selector | 3 |
| 2:30 | T035 History Replay | 4 |
| 4:00 | T051 Siege UI | 4 |
| 5:30 | T026 Test Checklist | 4 |
| 7:00 | T050 File Attachment | 4 |
| 8:30 | T027 Notification Column | 3 |
| 9:15 | T028 Checklist Auto-detect | 3 |
| **10:00** | **Complete** | |

Start at 9pm → Complete by 7am
