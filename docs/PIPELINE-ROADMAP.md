# Bento-ya Pipeline Roadmap

> Autonomous coding pipeline — what's done, what's next.

## Done ✅

### Pipeline v3 (current)
- 9-column pipeline: Backlog → Plan → Working → Review-Logic → Review-Quality → Verify → E2E → PR → Done
- Smart Verify agent (runs checks + fixes failures)
- Auto-advance between all columns
- Force-push fallback on PR creation (bentoya/* branches only)
- Per-column model routing (sonnet for plan/review, opus for working)
- External Python batch monitor for sequential task processing

### Reliability
- Trigger JSON validation on save (rejects invalid configs with clear errors)
- Better pipeline error messages ("Agent exited with code N" instead of "Execution failed")
- WAL checkpoint after MCP writes (Tauri app sees MCP changes)
- Worktree isolation per task (separate branches, no conflicts)
- Max retries per column with auto-advance on exhaustion

### UX (bento-ya app)
- Column default icons + colors (Backlog=gray, Working=blue, Review=amber, Done=green)
- Auto-icon suggestion when naming columns (keyword matching)
- Done column dims task cards (60% opacity)
- Panel mutual exclusion (Settings/Checklist)
- Add Column auto-opens config dialog
- WebDriver input compatibility (useNativeInput hook)
- Onboarding template/agent UI consolidation
- Named color constants (no magic hex strings)

## Built, Pending Merge (PRs on feat/readme-v2-features)

### PR #48 — PR Body Generation
- `build_pr_body()` function in triggers.rs
- Generates markdown from git diff --stat + git log + task description
- Template-based, zero LLM cost

### PR #49 — Retry From Start
- `retry_from_start` command (Tauri + API + MCP + frontend IPC)
- Resets pipeline state, moves to Plan, fires trigger
- Reuses existing worktree

### PR #50 — Auto-Batch Queue
- `queue_backlog(workspace_id, count)` command
- Marks N tasks as queued, starts first
- Auto-fires next on completion/failure
- Eliminates need for external Python batch script

## Not Started — Prioritized

### P0: Critical Pipeline
1. **Merge PRs #48-50** — unblock native batch queue
2. **Siege loop on Verify** — unbounded retry with 30-min time cap instead of fixed count. Agent keeps fixing until all checks pass or timeout.
3. **Discord webhook notifications** — create Script entities for webhook curl. Fire on PR creation + permanent failure.

### P1: Observability
4. **Cost/token tracking** — parse Claude CLI usage from agent output. Store in `usage` table (exists). Show per-task and per-run costs in UI.
5. **Pipeline timing stats** — track time-in-column per task. Store in `task_timing` table. Show bottleneck analysis.
6. **Pipeline dashboard** — real-time view: tasks in flight, current column, time elapsed, progress bars.

### P2: Intelligence
7. **Task spec interview (Chef)** — structured questions to generate rich task specs. Works from Discord via Choomfie.
8. **Complexity auto-routing** — Plan column estimates task complexity, sets `task.model` accordingly. Simple → sonnet, complex → opus. Saves 3-5x on token costs.

### P3: UX Polish
9. **Terminal UI upgrade** — Claude Code-style renderer: tool call badges, inline code highlighting, structured output. Replace raw xterm dump. (~8hrs)
10. **Worktree diff preview** — show git diff in expanded task card before PR creation.
11. **Batch queue UI** — "Run All" button in the app to queue backlog tasks.
12. **Agent-to-Choomfie feedback loop** — webhook/notification system so Choomfie can actively manage pipeline failures.

## Architecture Notes

### How the Pipeline Works
```
Task enters column with trigger
  → Bento-ya creates git worktree (isolated branch)
  → Spawns Claude CLI in tmux session with task prompt
  → CLI runs, makes changes, exits
  → Bento-ya checks exit criteria
  → Pass → auto-advance to next column → repeat
  → Fail → retry N times → stop with error
```

### Concurrency
- Hard cap: 5 concurrent agents (configurable)
- Each task: own worktree + own tmux session
- Queue system: excess tasks wait for a slot
- Recommended: sequential for dependent tasks, parallel for independent

### Connections
```
User ↔ Discord ↔ Choomfie (MCP)
                      ↓
                Bento-ya MCP server ↔ SQLite DB
                      ↓
                Bento-ya Tauri app
                      ↓
                Pipeline agents (Claude CLI in tmux)
                      ↓
                Anthropic API
```
Agents are independent — they don't know about each other or Choomfie.
