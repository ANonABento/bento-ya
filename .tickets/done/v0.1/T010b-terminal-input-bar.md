# T010b: Terminal Input Bar

## Summary

Build the input bar at the bottom of the terminal in split view. For v0.1: text input field, send button (Cmd+Enter), stop button. Mode/model/thinking selectors are placeholders (functional dropdowns come in v0.2 with the full settings system).

## Acceptance Criteria

- [ ] Input bar fixed at bottom of terminal panel
- [ ] Text input field (auto-growing textarea, max 4 lines)
- [ ] Send button + Cmd+Enter keyboard shortcut
- [ ] Stop button (sends SIGINT to agent PTY)
- [ ] Mode selector dropdown: shows current mode (default "Code"), selectable but basic for v0.1
- [ ] Model selector dropdown: shows current model name (from agent config), read-only for v0.1
- [ ] Thinking level dropdown: placeholder for v0.1
- [ ] Mic button: placeholder (disabled, tooltip "Coming in v0.3")
- [ ] Attach button: placeholder (disabled for v0.1)
- [ ] Input clears after send
- [ ] Focus management: auto-focus input when split view opens
- [ ] Send disabled while input is empty

## Dependencies

- T010 (terminal view — input bar is part of the terminal panel)

## Can Parallelize With

- T011 (split view — they integrate but can be built separately)

## Key Files

```
src/
  components/
    terminal/
      terminal-input.tsx        # Full input bar with all controls
      mode-selector.tsx         # Mode dropdown (basic for v0.1)
      model-selector.tsx        # Model display (read-only for v0.1)
      thinking-selector.tsx     # Placeholder for v0.1
```

## Complexity

**M** — Straightforward UI, but keyboard shortcut handling and PTY integration need care.

## Notes

- The input bar sends text to the PTY via `write_to_pty(task_id, text + '\n')` — it's just stdin
- Cmd+Enter vs Enter: consider making Enter send (like a chat) with Shift+Enter for newline, or Cmd+Enter to send. Configurable later, pick one default.
- Stop button: calls `stop_agent(task_id)` which sends SIGINT. If agent doesn't stop in 3s, button changes to "Force Stop" (SIGKILL).
- The mode/model/thinking selectors will become fully dynamic in v0.2 when the provider registry is implemented. For v0.1, they're visual placeholders showing the current config.
