# Bento-ya Roadmap

## v1.0 - Foundation (Current)
**Status**: Ready to merge
**Focus**: Core kanban functionality, UI polish

### Included
- Workspace/Column/Task CRUD with drag-and-drop
- Git integration (branches, diffs, commits)
- Terminal/PTY management
- Agent runner infrastructure
- Pipeline system (triggers, exit criteria)
- Voice transcription (Whisper)
- Usage tracking & session history
- Theme system with accent colors
- Sharp, minimalistic UI (Linear-inspired)
- E2E + Unit test infrastructure

### Known Limitations (Deferred to v2)
- Orchestrator chat is UI-only (no LLM calls)
- Settings stored but not enforced
- Keyboard shortcuts not registered
- Checklist backend not implemented

---

## v2.0 - Core Completion
**Target**: Wire up all existing UI to working backends
**Theme**: "Make everything actually work"

### Milestone 2.0.1 - Orchestrator Integration
The chat input should actually create tasks via LLM.

- [ ] BEN-201: Implement LLM provider abstraction (OpenAI, Anthropic, local)
- [ ] BEN-202: Create orchestrator prompt engineering
- [ ] BEN-203: Wire chat input to LLM calls
- [ ] BEN-204: Parse LLM responses into task actions
- [ ] BEN-205: Add streaming response support

### Milestone 2.0.2 - Settings Enforcement
Make settings actually affect behavior.

- [ ] BEN-211: Enforce git settings (branch prefix, base branch, merge strategy)
- [ ] BEN-212: Enforce agent settings (CLI selection, max concurrent)
- [ ] BEN-213: Enforce voice settings (model, language, sensitivity)
- [ ] BEN-214: Register keyboard shortcuts from settings
- [ ] BEN-215: Add settings validation and error handling

### Milestone 2.0.3 - Checklist Backend
Wire up the production checklist UI.

- [ ] BEN-221: Implement checklist Rust commands (CRUD)
- [ ] BEN-222: Add checklist templates (deploy, launch, review)
- [ ] BEN-223: Wire frontend to backend
- [ ] BEN-224: Add checklist import/export

---

## v2.1 - Polish & Power Features
**Target**: Enhanced UX and advanced functionality
**Theme**: "Delight users"

### Milestone 2.1.1 - Deep E2E Testing
- [ ] BEN-301: Test task creation/editing workflows
- [ ] BEN-302: Test drag-and-drop operations
- [ ] BEN-303: Test settings persistence and application
- [ ] BEN-304: Test git operations (branch, commit, diff)
- [ ] BEN-305: Test split view interactions

### Milestone 2.1.2 - Template System
- [ ] BEN-311: Backend template storage
- [ ] BEN-312: Template import from community gallery
- [ ] BEN-313: Custom template creation
- [ ] BEN-314: Template versioning

### Milestone 2.1.3 - Advanced Git
- [ ] BEN-321: Auto-create PR from task
- [ ] BEN-322: PR status tracking in task card
- [ ] BEN-323: Conflict resolution UI
- [ ] BEN-324: Branch comparison view

### Milestone 2.1.4 - Multi-Agent Orchestration
- [ ] BEN-331: Agent handoff between columns
- [ ] BEN-332: Agent collaboration mode
- [ ] BEN-333: Cost estimation before execution
- [ ] BEN-334: Agent replay/rollback

---

## v3.0 - Scale & Collaborate (Future)
**Theme**: "Team features"

- Multi-user workspaces
- Real-time collaboration
- Cloud sync
- Team templates
- Audit logging
- SSO/OAuth

---

## Implementation Order

```
v1.0 ──► v2.0.1 ──► v2.0.2 ──► v2.0.3 ──► v2.1.x
 │         │         │         │
 │         │         │         └─ Checklist backend
 │         │         └─ Settings enforcement
 │         └─ Orchestrator (critical path)
 └─ MERGE NOW
```

**Critical Path**: Orchestrator is the core value prop - without it, the app is just a kanban board.

---

## How to Request UI Changes

Best format for communicating UI tweaks:

### Option 1: Screenshot + Annotation
```
[Screenshot with arrows/circles]
"Move this button here, change color to X"
```

### Option 2: Reference + Delta
```
"Make the task cards look like Linear's -
specifically: tighter padding, subtle hover shadow"
```

### Option 3: Specific Instructions
```
"In src/components/kanban/task-card.tsx:
- Change padding from p-3 to p-2
- Add hover:shadow-md
- Remove the border radius"
```

### Option 4: Behavior Description
```
"When I hover on a column header,
I want to see a subtle highlight and the
menu button should fade in"
```

All formats work - I'll ask clarifying questions if needed.

## Pipeline v3 (shipped 2026-05-03)

- `on_failure` routing in column exit_criteria (Verify-fail → Working, Rebase-fail → ConflictResolver)
- Dropped staging branch indirection — feature PRs target `main` directly
- Deterministic Verify column via `run_script` (build-check + test-check)
- New Rebase column runs `scripts/rebase-pr.sh` before Merge
- ConflictResolver column for on-demand conflict resolution
