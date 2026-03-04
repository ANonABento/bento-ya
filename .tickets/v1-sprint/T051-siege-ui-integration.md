# T051: Siege Loop UI Integration

## Summary

Siege loop backend is fully implemented but frontend integration is incomplete. Wire up UI to control and monitor siege loops.

## Current State

Backend done:
- `src-tauri/src/commands/siege.rs` - full implementation
- Events: `siege:started`, `siege:iteration`, `siege:stopped`, `siege:complete`
- DB fields: siege_iteration, siege_active, siege_max_iterations, siege_last_checked

Frontend missing:
- No UI to start/stop siege
- No iteration counter display
- No event listeners for siege events
- Task card doesn't show siege status

## Acceptance Criteria

- [ ] "Start Siege" button on task card when PR exists
- [ ] Show current iteration / max iterations
- [ ] "Stop Siege" button when active
- [ ] Real-time status updates via events
- [ ] Toast notifications for siege events
- [ ] Task card badge when siege is active
- [ ] Column config option: "Auto-start siege when task enters"

## Complexity

**M**
