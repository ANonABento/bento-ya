# Testing and Runtime Modes

KaitenCode is a Tauri desktop app. There is a browser frontend for fast development, but the browser is not the product runtime.

## Short Answer

`pnpm dev` starts Vite and serves the React UI in a regular browser. It works for visual and interaction checks because the app falls back to browser mocks when Tauri is not available.

It does not run the real Rust backend. Anything that depends on Tauri IPC, tmux, PTYs, the filesystem, shell commands, native dialogs, SQLite persistence, update installation, or real agent processes must be tested in the Tauri app.

## Modes

| Mode | Command | Runtime | What is real | What is mocked |
|------|---------|---------|--------------|----------------|
| Browser dev | `pnpm dev` | Chrome/Firefox/Safari + Vite | React, CSS, routing, browser layout, most UI state | Tauri IPC, data, filesystem, shell, tmux, agents |
| Playwright browser E2E | `pnpm test:e2e` | Browser + Vite | Browser interactions and layout assertions | Tauri IPC and native features |
| Tauri dev app | `pnpm tauri dev` | Native app WebView + Rust | Rust commands, SQLite, tmux/PTY, filesystem, shell, native WebView behavior | Nothing intentionally mocked |
| Native WebDriver | `pnpm build:webdriver` + `pnpm dev` + `tauri-driver` + `pnpm test:webdriver` | Native app driven by WebDriver | Native app and Rust backend | Test data is isolated via env vars |
| Production build | `pnpm tauri build` | Packaged app/binary | Release frontend assets embedded in the native app | Nothing intentionally mocked |

## Browser/Vite: What Works

Use the browser dev server for:

- Board layout, columns, cards, scrolling, hover states, and responsive checks
- Settings screens and dialogs where the behavior is pure React or mockable IPC
- Visual regressions and fast screenshots
- Keyboard shortcuts and basic interaction flows
- Playwright tests that only need deterministic mocked data

The browser mode exists because it is much faster than rebuilding or relaunching the native app for every CSS or component change.

## Browser/Vite: What Does Not Prove Anything

Do not treat `http://localhost:1420` as proof for:

- Agent runs, resumed conversations, model/effort propagation, or live steering
- Embedded terminal behavior, tmux sessions, PTY resize/input, shell commands
- Git/worktree operations that depend on the real filesystem
- MCP server configuration or CLI discovery
- Native file picker/dialog behavior
- Real SQLite persistence and migrations
- Updater behavior
- WebView-only styling differences, including native form controls and scrollbars

Those need a Tauri runtime.

## Tauri Dev App

Use `pnpm tauri dev` when the question is “does the app work?”

This starts Vite and launches the Tauri shell around it. The frontend is still hot-reloaded from Vite, but `window.__TAURI_INTERNALS__` exists and IPC calls go to the Rust backend.

Use this for manual testing of:

- Agent chat and resume behavior
- Terminal panel and tmux-backed sessions
- Worktree/git/file tracking
- Native app/WebView visual differences
- Settings that touch real config or local resources

## Native WebDriver

Use WebDriverIO when you need automated coverage against the real app. The app is still backed by Vite during these tests, so step 2 starts the dev server, but the browser is not opened directly. `tauri-driver` launches and drives the native Tauri binary.

```bash
pnpm build:webdriver
pnpm dev
KAITENCODE_DATA_DIR=/tmp/kaitencode-wdio tauri-driver --port 4444
pnpm test:webdriver
```

Use this for screenshots and IPC regressions where Playwright browser mocks are not enough.

## Production Build

Use `pnpm tauri build` for full release verification. Do not use `cargo build --release` for a full app rebuild after frontend changes because it can skip the Vite build and asset embedding path.

```bash
pnpm tauri build
```

After building, launch the generated app/binary and verify startup, asset loading, and native WebView behavior.

## Practical Decision Tree

- “Does the UI look right?” Use `pnpm dev`, then confirm important native visual differences with `pnpm tauri dev`.
- “Does the agent/terminal/filesystem work?” Use `pnpm tauri dev`.
- “Can CI catch this layout regression?” Add or update Playwright browser tests.
- “Can CI catch this real IPC/native regression?” Add or update WebDriverIO tests.
- “Can users install and launch this?” Use `pnpm tauri build`.
