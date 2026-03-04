# T013: E2E Integration & Smoke Test

## Summary

Wire everything together end-to-end: frontend connects to backend, board loads real data, clicking a card opens a real terminal with a real agent. This is the final v0.1 ticket — merging all worktrees and making the full flow work.

## Acceptance Criteria

### Full Flow (Happy Path)
- [ ] App launches → creates `~/.bentoya/` directory and SQLite DB
- [ ] First run: prompt to create workspace (select repo directory)
- [ ] Workspace created → default columns appear (Backlog, Working, Review, Done)
- [ ] "Create task" button → new task card appears in Backlog
- [ ] Drag task card from Backlog to Working → triggers agent spawn:
  - Git branch created (`bentoya/<task-slug>`)
  - PTY spawned with `claude` CLI
  - Agent session recorded in DB
- [ ] Task card shows "Running" status with green dot
- [ ] Click task card → split view opens:
  - Left: collapsed kanban with task details (title, branch, status)
  - Right: terminal showing agent output in real-time
- [ ] Type in terminal input → agent receives the input
- [ ] Agent works → file changes tracked via git
- [ ] Changes section updates with modified files
- [ ] Esc → back to full board view, agent keeps running
- [ ] Agent completes → task card status updates, duration shown
- [ ] Diff viewer shows changes agent made

### Error Handling
- [ ] Agent PTY exits unexpectedly → card shows "Failed" status
- [ ] Invalid repo path → error message on workspace creation
- [ ] No `claude` CLI installed → meaningful error (not crash)
- [ ] Git operations fail (dirty tree, conflicts) → error surfaced to user

### Worktree Merge Checklist
- [ ] Backend CRUD commands work with real SQLite DB (not mocked)
- [ ] Frontend stores hydrate from backend data on mount
- [ ] IPC types match between Rust and TypeScript (no serialization errors)
- [ ] PTY events stream correctly to xterm.js (no garbled output, no dropped data)
- [ ] Git branch creation works for the workspace's repo
- [ ] Split view transitions work smoothly (no flicker, no layout jumps)
- [ ] Multiple tasks can run simultaneously (at least 2 agents)

### Manual Test Checklist
- [ ] Create workspace pointing to a real git repo
- [ ] Create 2 tasks
- [ ] Drag both to Working → 2 agents spawn on separate branches
- [ ] Click task 1 → see terminal, type a message, verify agent receives it
- [ ] Esc → back to board → click task 2 → see different terminal session
- [ ] Wait for an agent to complete → verify status updates
- [ ] Check diff viewer shows real changes
- [ ] Close app → reopen → verify board state persisted

## Dependencies

- ALL other v0.1 tickets (T001-T012)

## Can Parallelize With

- Nothing — this is the integration point

## Key Files

```
(No new files — this ticket is about wiring existing code together)

Files likely to be modified:
  src/app.tsx                   # Root wiring, store initialization
  src-tauri/src/main.rs         # Final command registration
  src-tauri/src/lib.rs          # Module wiring
  src/stores/*.ts               # Hook up IPC calls
  src/components/layout/board.tsx  # Connect to real data
```

## Complexity

**L** — Integration is always harder than it looks. Type mismatches, timing issues, event ordering.

## Notes

- Common integration issues to watch for:
  1. **Serde naming**: Rust struct fields are `snake_case`, JS expects `camelCase`. Use `#[serde(rename_all = "camelCase")]` on all Rust response structs.
  2. **Event timing**: PTY output events might arrive before the frontend terminal is mounted. Buffer them.
  3. **Async ordering**: Creating a branch and spawning an agent must be sequential. Don't race them.
  4. **Window focus**: Tauri events might behave differently when the window is focused vs not.
  5. **PTY encoding**: Output is bytes, not strings. Use `Uint8Array` on the JS side and `terminal.write(data)`.

- Test approach: manual testing with a real repo. Automated E2E tests can come later — for v0.1, just verify the flow works.

- If `claude` CLI isn't installed on the test machine, fall back to `bash` for testing the terminal flow.

- This ticket is also where you clean up:
  - Remove placeholder content from T008
  - Fix any styling inconsistencies between components built in different worktrees
  - Ensure consistent spacing, typography, and colors across all views
