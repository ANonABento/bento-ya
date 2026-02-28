# T006: Tauri IPC Event System

## Summary

Wire up the Tauri event system for real-time communication between the Rust backend and React frontend. This covers PTY output streaming, agent status changes, and git operation results — all the events that make the UI feel live.

## Acceptance Criteria

### Event Channels
- [ ] `pty:{task_id}:output` — streams PTY output bytes to frontend
- [ ] `pty:{task_id}:exit` — notifies when PTY process exits (with exit code)
- [ ] `agent:{task_id}:status` — agent status changes (running, completed, failed, needs_attention)
- [ ] `task:{task_id}:updated` — task data changed (column move, field update)
- [ ] `git:{task_id}:changes` — file change list updated
- [ ] `workspace:{id}:updated` — workspace-level changes

### Frontend Listener Wrappers
- [ ] `ipc.ts` provides typed `listen()` and `invoke()` wrappers
- [ ] `listen()` returns an unlisten function for cleanup
- [ ] `invoke()` wraps Tauri's invoke with proper error handling and typing
- [ ] All event payloads have TypeScript interfaces matching Rust structs
- [ ] Error responses deserialized into typed error objects

### Backend Event Emission
- [ ] Events emitted from PTY manager on output/exit
- [ ] Events emitted from agent runner on status change
- [ ] Events emitted from git manager on change detection
- [ ] Events emitted from CRUD commands on data mutation

## Dependencies

- T003 (backend CRUD commands — need command signatures to type)

## Can Parallelize With

- T009, T010 (they'll consume these events)

## Key Files

```
src/
  lib/
    ipc.ts              # Typed invoke() and listen() wrappers
  types/
    events.ts           # Event payload TypeScript interfaces

src-tauri/src/
  events.rs             # Event type definitions, emit helpers
```

## Complexity

**M** — Typing discipline needed to keep Rust and TypeScript event types in sync.

## Notes

- Tauri v2 uses `app.emit()` for global events and `window.emit()` for window-scoped
- For PTY output, use the global event emitter (output should reach the frontend regardless of window focus)
- PTY output events should batch bytes (don't emit per-byte — batch on ~16ms intervals)
- Event payload types in Rust: `#[derive(Serialize, Clone)]` structs
- TypeScript side: use discriminated unions for event types
- Example invoke wrapper:
  ```typescript
  async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    return tauriInvoke<T>(cmd, args)
  }
  ```
- Example listen wrapper:
  ```typescript
  function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    return tauriListen<T>(event, (e) => handler(e.payload))
  }
  ```
- Keep a single `events.ts` as the source of truth for all event channel names (avoid string typos)
