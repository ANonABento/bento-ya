# T010: Terminal View (xterm.js + WebGL)

## Summary

Build the terminal component that renders real PTY output from agents using xterm.js with the WebGL addon. This is the right panel in split view — a full-featured terminal that connects to the agent's PTY session.

## Acceptance Criteria

### xterm.js Setup
- [ ] xterm.js Terminal instance created and attached to a container div
- [ ] WebGL addon loaded for GPU-accelerated rendering
- [ ] Fit addon loaded for auto-resize to container dimensions
- [ ] Search addon loaded for Cmd+F search in scrollback
- [ ] Unicode11 addon loaded for proper unicode rendering
- [ ] Terminal themed to match dark palette (custom ITheme object)
- [ ] JetBrains Mono font used in terminal
- [ ] Scrollback buffer: 5000 lines (configurable)

### PTY Connection
- [ ] Terminal subscribes to `pty:{task_id}:output` Tauri events
- [ ] Incoming data written to terminal via `terminal.write(data)`
- [ ] User keyboard input captured via `terminal.onData()` callback
- [ ] Keyboard input sent to backend via `write_to_pty(task_id, data)` IPC command
- [ ] Terminal resize events sent to backend via `resize_pty(task_id, cols, rows)` IPC command
- [ ] Fit addon triggers resize on container dimension changes

### Lifecycle
- [ ] Terminal instance created when task is selected for focus view
- [ ] On connect: replay scrollback buffer from backend (catch up on missed output)
- [ ] On disconnect (leave split view): terminal instance kept in memory (up to 3 recent)
- [ ] Terminal instances beyond the 3 most recent are destroyed and recreated on demand
- [ ] PTY exit event updates terminal state (show "Agent exited" indicator)

### Terminal Theme
- [ ] Dark theme colors matching bento palette:
  ```
  background: #0D0D0D
  foreground: #E5E5E5
  cursor: #E8A87C (accent)
  selection: rgba(232, 168, 124, 0.3)
  ANSI colors mapped to bento palette
  ```

## Dependencies

- T007 (frontend types & stores — needs terminal-store)

## Can Parallelize With

- T002, T003, T005, T009

## Key Files

```
src/
  components/
    terminal/
      terminal-view.tsx         # xterm.js container + PTY connection logic
  lib/
    xterm-theme.ts              # Terminal color scheme definition
  hooks/
    use-agent.ts                # Agent lifecycle (subscribe to status events)
```

## Complexity

**L** — xterm.js setup is well-documented but PTY streaming + lifecycle management has nuance.

## Notes

- xterm.js imports:
  ```typescript
  import { Terminal } from 'xterm'
  import { WebglAddon } from 'xterm-addon-webgl'
  import { FitAddon } from 'xterm-addon-fit'
  import { SearchAddon } from 'xterm-addon-search'
  import { Unicode11Addon } from 'xterm-addon-unicode11'
  import 'xterm/css/xterm.css'
  ```
- Terminal creation:
  ```typescript
  const term = new Terminal({
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 14,
    theme: xtermDarkTheme,
    scrollback: 5000,
    cursorBlink: true,
    cursorStyle: 'bar',
  })
  term.loadAddon(new WebglAddon())
  term.loadAddon(fitAddon)
  term.open(containerRef.current)
  fitAddon.fit()
  ```
- **Critical**: xterm.js Terminal instance must be opened on a mounted DOM element. Use `useEffect` with a ref.
- Terminal pooling: `terminal-store` maps `task_id → Terminal instance`. Keep up to 3 instances alive, destroy oldest on overflow.
- The WebGL addon can fail on systems without WebGL — fallback to canvas renderer (default xterm.js)
- ResizeObserver on the container div → trigger `fitAddon.fit()` on size change
- Don't animate the terminal container itself — xterm.js uses its own GPU rendering pipeline. Only animate the wrapper div.
- PTY output is raw bytes (may include ANSI escape sequences, colors, cursor movement) — xterm.js handles all of this natively
