# bento-ya

Tauri desktop app for orchestrating AI coding agents — an automated kanban board where columns are pipeline stages with trigger-driven automation.

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
rm -rf ~/Library/WebKit/com.bento-ya.app ~/Library/Caches/com.bento-ya.app
```

**Cheat sheet:**
- Backend-only Rust change → `cargo build --release` is fine
- Any frontend change OR full rebuild → `pnpm tauri build` (mandatory)
- Webview still blank → nuke WebKit cache, restart binary

#### .app bundle crashes on Finder launch (SIGABRT)

The bundled `.app` (`target/release/bundle/macos/Bento-ya.app`) crashes with `SIGABRT` when launched via Finder/Spotlight on macOS. Workaround: run the bare binary from terminal:

```bash
./target/release/bento-ya &
```

Root cause: `setup()` closure in `lib.rs` is too heavy for macOS app delegate watchdog. Fix in progress (see backlog).

