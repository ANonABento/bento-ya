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

### Testing modes

Bento-ya has two useful local test surfaces:

| Surface | Command | Backend | Use it for |
|---------|---------|---------|------------|
| Browser/Vite | `npm run dev`, then `npm run test:e2e` | Mocked Tauri IPC | Fast React UI/layout/interaction checks |
| Native Tauri | `pnpm tauri dev` | Real Rust backend, tmux, filesystem, WebView | Manual end-to-end agent and terminal testing |
| Native WebDriver | `npm run build:webdriver`, `tauri-driver --port 4444`, then `npm run test:webdriver` | Real Tauri app under automation | Native IPC/WebView regression tests when `tauri-driver` is supported locally |

Opening `http://localhost:1420` by itself only shows the Vite frontend. It is useful for frontend work, but it is not the full app runtime: native Tauri APIs are mocked outside the desktop shell. Agent execution, tmux sessions, shell behavior, filesystem access, and other Rust-backed features need `pnpm tauri dev` or a WebDriver-backed Tauri run.

If `tauri-driver` is unavailable or reports that the platform is unsupported, use Playwright for browser-only checks and `pnpm tauri dev` for manual native verification.

### Database setup and migrations

Bento-ya stores its local SQLite database at `~/.bentoya/data.db`. The app runs pending migrations automatically on startup, but you can apply them explicitly after pulling schema changes:

```bash
pnpm db:migrate
```

The command uses the same Rust database initializer as the app, creates `~/.bentoya/` if needed, enables WAL mode, and records applied migrations in the `_migrations` table.

### Linux setup notes

On Linux, the app uses the same local data path as other platforms: `~/.bentoya/data.db`. If the app starts with database errors after a branch switch or update, run:

```bash
pnpm db:migrate
```

If migration still fails, close all Bento-ya windows and any `bento-mcp` process before retrying. SQLite lock errors usually mean another process still has `~/.bentoya/data.db`, `~/.bentoya/data.db-wal`, or `~/.bentoya/data.db-shm` open. Permission errors usually mean `~/.bentoya/` or the database files are owned by another user; fix ownership rather than deleting the database.

### Troubleshooting

#### Database migration errors

**Symptom:** The app launches but database-backed features fail, or startup logs mention missing columns, missing tables, `_migrations`, `database is locked`, or `readonly database`.

**Fix:**
```bash
pnpm db:migrate
```

If the command reports `database is locked`, quit Bento-ya and stop `bento-mcp`, then rerun it. If it reports a readonly or permission error, check ownership and permissions on `~/.bentoya/` and `~/.bentoya/data.db`.

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
