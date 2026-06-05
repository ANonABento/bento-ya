# KaitenCode — Demo Runbook

A tight script for showing KaitenCode live to a recruiter, on a **real project**
(more convincing than the seeded sample workspace). Pair it with
[`docs/ARCHITECTURE_SHOWCASE.md`](docs/ARCHITECTURE_SHOWCASE.md) for the
"how it's built" story.

---

## 1. Pre-flight (do ~15 min before)

**Environment**
- [ ] Launch from a shell so the CLIs resolve: `npm run dev` (Vite :1420) + `npm run tauri dev`. (Launching from a GUI icon can give the app a minimal `PATH` and break `claude`/`codex` detection.)
- [ ] `which claude && claude --version` and `which codex && codex --version` both work in that shell.
- [ ] `tmux -V` works (agents run in tmux sessions).
- [ ] For maximum stability consider a release build instead of dev: `npm run tauri build` and run the bundled app — no hot-reload hiccups mid-demo.

**Pick the project**
- [ ] Open a real workspace you know well (e.g. **slothing**). The dev app uses your real `~/.kaitencode/data.db`, so your actual boards are already there.
- [ ] Make sure its `repo_path` exists and is a clean-ish git repo (so worktrees + Browse look tidy).
- [ ] Have 1–2 tasks pre-staged in interesting states: one in Backlog to create live, one already mid-pipeline if you want instant action.

**Clear the noise**
- [ ] No red error banners showing (the chef CLI-path + `apiStreamRegistry` issues are fixed; if a banner lingers, reopen the panel — it self-heals on re-detect).
- [ ] Settings → Models & Limits: confirm your model + (optionally) toggle **interactive mode** on if you want to show the live TUI.
- [ ] Close other apps squatting port 1420; close unrelated terminals.

**Have a fallback ready**
- [ ] Open `docs/ARCHITECTURE_SHOWCASE.md` on GitHub in a tab (the diagrams render there) in case anything is slow live.

---

## 2. The 5–7 minute live flow

1. **Frame it (15s).** "It's a desktop app where a kanban board *runs* — each column is a pipeline stage that fires real AI coding agents, and a chef orchestrator coordinates the whole board."

2. **The board (30s).** Show your real columns/tasks. Point out the per-task badges: model, priority, worktree dot, dependency lines.

3. **Chef chat (1 min).** Bottom panel → **Chat**. Ask it something real: *"triage the backlog"* or *"create a task to add X."* Watch it stream + create/move tasks on the board live. (This is the `stream_orchestrator_chat` path you just fixed.)

4. **Trigger-driven agent (1–2 min).** Drag a task into a column with a `spawn_cli` trigger → flip to the task's **Terminal** tab and show the **live agent in a real tmux session** working. Mention: same tmux session whether it's pipeline-spawned or you attach interactively — one transport.

5. **Files / code viewer (1 min).** Chef panel → **Files** → **Plans** (your `.tickets`/`.context` markdown) and **Browse** (lazy repo tree → open a real source file, syntax-highlighted). Mention the path-traversal guard.

6. **The header / polish (15s).** The chef header: main view tabs first, `⋯` reveals more, dockable. Small thing, but signals product polish.

7. **Close with the architecture (1 min).** Switch to `ARCHITECTURE_SHOWCASE.md`: the system diagram, the agent-spawn sequence, the MCP recursion guard. "Here's the engineering behind what you just saw."

---

## 3. What to emphasize (technical signal)

- **One transport for everything** — pipeline agents and interactive terminals share a per-task tmux session; click a card mid-run and you're in the live pane.
- **Source-of-truth design** — a single pure `ResolvedAgentSpawn` resolver + `*_service` funnels mean the UI, HTTP API, and MCP server all create/move/update through identical code.
- **Safety** — DAG dependency engine with cycle detection; MCP recursion guard so an agent that spawns tasks can't fork-bomb the board.
- **Real systems work** — SQLite/WAL, per-task git worktrees, an embedded axum HTTP API for the MCP server, event-driven UI sync.

---

## 4. If something breaks live

- **Chef chat errors** → reopen the panel; if persistent, fall back to dragging a task to trigger an agent instead.
- **CLI "not valid"** → it self-heals on re-detect; worst case set the path explicitly in Settings → Models & Limits.
- **Agent won't spawn** → confirm `tmux` + the CLI in the launching shell; show the Files/code viewer + architecture doc instead.
- **Anything slow** → narrate over the architecture diagrams; they carry the story on their own.
