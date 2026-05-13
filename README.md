# bento-ya

Tauri desktop app for orchestrating AI coding agents — an automated kanban board where columns are pipeline stages with trigger-driven automation.

![Bento-ya kanban board](docs/screenshots/board.png)

### Column automation, in natural language

Each column can declare `on_entry` / `on_exit` triggers. Describe the automation you want and the app generates the trigger config — or drop into the advanced editor for spawn_cli / move_column / run_script / create_pr actions.

![Column trigger config dialog](docs/screenshots/column-triggers.png)

### Per-task agent panel with embedded tmux terminal

Click a task card to open its agent panel: semantic transcript on the right, live tmux-backed terminal one tab over, lifecycle controls (Hold / Stop / Kill), model + thinking-effort selectors, and a chat box for steering the agent mid-run.

![Task detail with agent panel](docs/screenshots/task-detail.png)

### Workspace + agent settings

Per-workspace and global settings: concurrency limits, default CLI, default model, base branch, pipeline behavior (auto-advance, archive on done), agent session persistence across restarts.

![Settings panel](docs/screenshots/settings.png)

> Regenerate these screenshots: `npm run test:webdriver -- --spec ./tests/webdriver/screenshots.spec.mjs` (see [Native WebDriver E2E](#native-webdriver-e2e) below for one-time setup).

## v2.0 Features

- **PR auto-create trigger** — columns can fire a `create_pr` action on exit to open a GitHub pull request when a task completes a stage (requires `gh` CLI installed and authenticated)
- **Per-task git worktree isolation** — each task can run in its own git worktree (`<repo>/.worktrees/bentoya-<taskId>/`), reducing local branch and worktree collisions between agents
- **DAG dependency UI with hover-reveal lines** — tasks define dependency relationships with cycle detection; bezier lines between cards appear on hover to visualize the dependency graph

## v2.1 — Embedded Terminal

- **Per-task embedded terminal** — each task gets a full xterm.js terminal (lazy PTY, bare shell in working dir). Click a task card to open its terminal.
- **xterm.js integration** — WebGL renderer, 10k line scrollback, fit-addon for responsive resizing, theme-reactive (dark/light), Unicode 11 support
- **Lazy PTY sessions** — shell spawned on first panel open via `ensure_pty_session`, killed on panel close. Triggers will inject CLI commands directly into the shell.
- **Unified chat session layer** — `UnifiedChatSession` manages lifecycle (idle/running/suspended), resume ID tracking, transport switching (pipe ↔ PTY)
- **Legacy process layer removed** — deleted `pty_manager.rs`, `agent_runner.rs`. All PTY/agent management through unified `SessionRegistry`

## Development

### Building

**Always use `pnpm tauri build` (or `bun tauri build`) for production rebuilds.** Don't run `cargo build --release` standalone unless you are 100% sure no frontend changes are involved.

```bash
# Full production build (frontend + binary + .app + .dmg)
pnpm tauri build

# Dev mode (vite dev server + hot reload)
pnpm tauri dev
```

### Testing modes

Bento-ya has three local test surfaces, each backed by a different runtime:

| Surface | Command | Backend | Use it for |
|---------|---------|---------|------------|
| Browser/Vite | `npm run dev`, then `npm run test:e2e` | Mocked Tauri IPC | Fast React UI/layout/interaction checks |
| Native Tauri | `pnpm tauri dev` | Real Rust backend, tmux, filesystem, WebView | Manual end-to-end agent and terminal testing |
| Native WebDriver | See below | Real Tauri app under automation | Automated UI/IPC regression + screenshots |

Opening `http://localhost:1420` by itself only shows the Vite frontend with mocked Tauri IPC — agent execution, tmux sessions, filesystem, and Rust-backed features need `pnpm tauri dev` or the WebDriver setup below.

### Native WebDriver E2E

Drives the real Tauri binary via [`tauri-driver`](https://crates.io/crates/tauri-driver). Tests run against a real SQLite DB and real Rust backend, isolated in `/tmp/bentoya-wdio/` via the `BENTOYA_DATA_DIR` env var (your real `~/.bentoya/data.db` is untouched).

**One-time setup**

Linux:
```bash
sudo apt install webkit2gtk-driver   # provides WebKitWebDriver
cargo install tauri-driver --locked
```

macOS:
```bash
# Safari's webdriver is built-in; just install tauri-driver
cargo install tauri-driver --locked
safaridriver --enable        # one-time, requires admin
```

**Each run** (four steps, three of them long-lived background processes):

```bash
# 1. Build the webdriver-enabled binary (one-time per Rust change)
npm run build:webdriver

# 2. Start Vite dev server on port 1420 (terminal A)
npm run dev

# 3. Start tauri-driver with an isolated data dir (terminal B)
rm -rf /tmp/bentoya-wdio && mkdir -p /tmp/bentoya-wdio
BENTOYA_DATA_DIR=/tmp/bentoya-wdio tauri-driver --port 4444

# 4. Run the test suite (terminal C)
npm run test:webdriver
```

Tests live in `tests/webdriver/*.spec.mjs`; screenshots land in `tests/webdriver/screenshots/`. The binary path defaults to `<repo>/target/debug/bento-ya`; override with `BENTOYA_BINARY=...` (e.g. for a release build).

**Troubleshooting:**
- `window.__TAURI_INTERNALS__ is undefined` in test output — usually means `tauri-driver` fell back to its default browser (MiniBrowser/Safari). Verify `wdio.conf.mjs` uses `tauri:options.application` (not `binary`) and that `BENTOYA_BINARY` resolves to a binary built with `--features webdriver`.
- "can not find WebKitWebDriver" — install `webkit2gtk-driver` (Linux) or enable `safaridriver` (macOS).
- Tests fail on the very first IPC call — check that `npm run dev` is actually serving on port 1420.

### Troubleshooting

#### White screen on launch

**Symptom:** App opens to a blank white window. Right-click only shows "Reload". Backend (pipeline, agents) works fine but the kanban UI never renders.

**Cause:** The Tauri binary embeds frontend assets from `dist/` at compile time via `tauri-build`. When the embedded snapshot drifts from the actual `dist/` files, the webview requests asset URLs (e.g. `assets/index-BTZ7ChRp.js`) that either don't exist or have different content hashes than the binary expects.

**How it happens:**
- `cargo build --release` only rebuilds Rust — doesn't re-run the frontend build OR re-embed assets if `dist/` was changed by another tool
- `bun run build` rebuilds frontend → produces new asset hashes in `dist/`
- If the steps run in the wrong order (or one is skipped), the binary's embedded snapshot drifts from the actual `dist/`

**Fix (canonical):**
```bash
pnpm tauri build
```

This runs `beforeBuildCommand` (frontend build via vite) → cargo build → properly invalidates asset embedding. Don't skip the `tauri` wrapper.

**Fix (if still white after `tauri build`):** clear WebKit cache (sometimes stores stale asset hashes):
```bash
rm -rf ~/Library/WebKit/com.bentoya.desktop ~/Library/Caches/com.bentoya.desktop
```

**Cheat sheet:**
- Backend-only Rust change → `cargo build --release` is fine
- Any frontend change OR full rebuild → `pnpm tauri build` (mandatory)
- Webview still blank → nuke WebKit cache, restart binary

#### .app bundle Finder launch

The bundled `.app` (`target/release/bundle/macos/Bento-ya.app`) should launch via Finder/Spotlight. The previous `SIGABRT` in `tao::did_finish_launching` was fixed by using the non-`.app` bundle identifier `com.bentoya.desktop` and keeping heavyweight startup recovery off the macOS launch delegate path. See `docs/macos-bundle.md` for verification steps.
