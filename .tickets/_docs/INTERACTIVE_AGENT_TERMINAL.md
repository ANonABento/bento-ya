# Interactive Agent Terminal — Design Spec

> Decided: 2026-04-10. Based on terminal bridge rewrite (2026-04-09) + tmux integration.

## Vision

The terminal panel is the universal agent interface. Every task gets a tmux session (shell in its worktree). Agent CLIs (codex, claude, etc.) run **interactively** inside that session — users see tool calls, thinking, output, and can intervene. Triggers inject messages like a human would type. Same PTY, dual control.

No more headless `codex exec`. The agent experience is the same as running the CLI locally.

## Current State (What We Have)

- tmux session per task (`bentoya_{task_id}`)
- `tmux send-keys` for command injection
- `tmux wait-for` for completion detection
- ManagedBridge forwards output to xterm.js
- Resize via `tmux resize-window` (SIGWINCH propagation)
- Session persistence across app restarts
- Recovery on startup (discover existing tmux sessions)
- 168 backend tests + 17 e2e tests passing

## What Changes

### 1. Interactive Agent Mode (replaces headless)

**Before:** `codex exec 'prompt'` — headless, no TUI, no interaction
**After:** `codex` (interactive) started in tmux, prompt sent as first message

The trigger:
1. Ensures tmux session exists (shell in worktree)
2. Starts the agent CLI in interactive mode: `codex` or `claude`
3. Waits for agent to be ready (prompt indicator)
4. Sends the task prompt via `tmux send-keys`
5. User sees full agent TUI in terminal panel
6. User can type, approve tools, redirect — same as local CLI

### 2. Agent CLI Configuration

**Per-task model selection:**
- Chef can set `task.model` when creating tasks
- Trigger resolves: `task.model` > column trigger config model > workspace default
- Supported: `codex`, `claude`, any CLI that accepts a prompt

**Trigger config gains `agent_mode` field:**
```json
{
  "on_entry": {
    "type": "spawn_cli",
    "cli": "codex",
    "agent_mode": "interactive",  // "interactive" | "headless"
    "model": "gpt-5.4",           // optional, falls back to task.model > workspace default
    "session_strategy": "reuse",   // "reuse" | "fresh" — see section 3
    "prompt": "{task.title}\n\n{task.description}"
  },
  "exit_criteria": {
    "type": "agent_complete",
    "auto_advance": true,
    "manual_check": false          // new: if true, flag task for user review before advancing
  }
}
```

### 3. Session Strategy: Reuse vs Fresh

**`reuse`** — Keep the same agent session across column transitions.
- When task moves Working → Review, DON'T kill the agent.
- Instead, send a new message to the existing agent: "Now review your changes..."
- Agent keeps full context from the implementation phase.
- Use when: review needs implementation context, iterative refinement.
- Uses `--resume` / session continuity if agent supports it.

**`fresh`** — Kill current agent, start new one in same tmux session.
- Shell stays alive. Agent process is killed.
- New agent CLI started with new prompt and potentially different model.
- Use when: clean review by a different model, independent analysis.
- The tmux session (shell) survives — only the agent process changes.

**Implementation:**
- On column transition, check target column's `session_strategy`
- If `reuse`: skip agent spawn, just `tmux send-keys` the new prompt
- If `fresh`: send Ctrl+C to kill current agent, wait for shell prompt, start new agent

### 4. Advance Modes: Auto vs Manual Check

**Auto advance** (current behavior):
- Agent exits → `tmux wait-for` detects → `mark_complete` → advance to next column
- No human in the loop

**Manual check** (new):
- Agent exits → `tmux wait-for` detects → mark task as "ready for review"
- Show indicator on kanban card: "Agent done — needs your review"
- User reviews in terminal panel, then manually advances (drag or button)
- Use when: user wants to verify before moving to next stage

**Edge case: user chatting with agent when auto-advance triggers:**
- If agent exits while user is actively interacting (typed in last 30s?), switch to manual mode
- Show notification: "Agent completed. Advance when ready."
- Don't yank the terminal out from under them

### 5. Token Optimization: Context Pointers

**Problem:** Chef creates a task with full description → trigger sends full description as prompt → agent reads it. That's 2x the tokens for the same information.

**Solution: Pointer pattern**
- Trigger prompt uses compact reference: `Work on task {task.id}. Read .task.md in the worktree for full spec.`
- On task creation, write `{worktree}/.task.md` with:
  ```
  # {task.title}
  {task.description}

  ## Checklist
  {task.checklist}

  ## Context
  - Workspace: {workspace.name}
  - Branch: {task.branch_name}
  - Previous PR comments: {if any}
  ```
- Agent reads the file (it has file read tools) — same output, much smaller prompt
- Chef → Agent communication cost: ~50 tokens instead of ~500

**For multi-stage (reuse strategy):**
- Review prompt: `Review changes since last commit. See .task.md for original spec.`
- Agent already has context from implementation AND can reference the spec file
- Minimal token overhead for stage transitions

### 6. Cleanup & Resource Management

#### Session Lifecycle States

```
STATES:
  created    → tmux session exists, shell running, no agent
  active     → agent CLI running inside session
  idle       → agent exited, shell at prompt, session alive
  sleeping   → tmux session detached (not attached to any PTY bridge)
  dead       → tmux session killed, resources freed

TRANSITIONS:
  Task created         → created (worktree + tmux session)
  Trigger fires        → active (agent started)
  Agent exits          → idle (wait-for detects, mark complete)
  Idle > 30 min        → sleeping (detach, free bridge resources)
  Panel opens          → sleeping → idle (reattach)
  Task deleted         → dead (kill tmux + worktree)
  Task to Done + PR    → idle → sleeping (keep for reference, clean later)
  Idle > 4 hours       → dead (garbage collected)
  App restart          → recover active/idle sessions, kill orphans
```

#### Garbage Collector

Runs every 5 minutes:
1. List all `bentoya_*` tmux sessions
2. For each, check if task exists in DB
3. If task doesn't exist → kill session + clean worktree (orphan)
4. If task in Done and session idle > 4 hours → kill session
5. If session idle > 30 min and no panel open → detach (sleep)
6. Log all actions for debugging

#### Cleanup on task operations:
- **Task deleted:** kill tmux session, remove worktree, delete agent_sessions
- **Task moved OUT of trigger column while agent running:** kill agent process (Ctrl+C + wait), reset agent_status, keep session alive (user might want the shell)
- **Worktree removal:** `git worktree remove --force` + delete branch if not pushed

### 7. Data Flow

```
USER INTERACTION:
  Terminal panel ← xterm.js ← ManagedBridge ← tmux attach (PTY)
  User types → PTY stdin → tmux session → agent CLI stdin

TRIGGER INJECTION:
  Chef/trigger → tmux send-keys -t bentoya_{task_id} -l "message" + Enter
  → Agent CLI receives as if user typed it

COMPLETION:
  Agent exits → shell prompt returns
  → tmux wait-for channel signaled
  → Read exit code → mark_complete(success)
  → If auto_advance: move to next column → fire next trigger
  → If manual_check: set task flag, show indicator

TOKEN-OPTIMIZED FLOW:
  Chef creates task → writes .task.md to worktree
  Trigger sends: "codex" → Enter → "Work on task per .task.md" → Enter
  Agent reads .task.md (~0 extra tokens in prompt)
  Stage transition (reuse): "Review changes per .task.md" → Enter
```

### 8. Files to Change

| File | Change |
|------|--------|
| `chat/bridge.rs` | `spawn_cli_trigger_task`: support interactive mode, session_strategy |
| `chat/tmux_transport.rs` | Add `detach()` for sleeping, garbage collector |
| `chat/registry.rs` | Track session state (active/idle/sleeping) |
| `pipeline/triggers.rs` | `execute_spawn_cli`: write .task.md, respect session_strategy |
| `commands/agent.rs` | `ensure_pty_session`: handle sleeping → idle transition |
| `lib.rs` | Start garbage collector periodic task |
| `db/mod.rs` | New migration: add `session_state` to tasks or agent_sessions |
| `api.rs` | `move_task`: cancel agent when moving out of trigger column |

### 9. Migration Plan

**Phase 1: Interactive mode + cleanup + settings**
1. Switch triggers to interactive agent CLI (codex, not codex exec)
2. Agent cancellation when task leaves trigger column
3. Garbage collector: tmux sessions, archive stage 1
4. Write `.task.md` to worktree on trigger fire
5. Settings system (`~/.bentoya/settings.json` + workspace config)
6. `max_agent_sessions` configurable

**Phase 2: Session strategy + manual check**
1. Implement `reuse` vs `fresh` session strategy in triggers
2. `--resume` detection + handoff file fallback
3. Manual check mode with kanban indicators
4. Edge case: user-is-chatting detection → auto-switch to manual
5. Auto-wake sleeping sessions on events

**Phase 3: Token optimization + multi-model + archive purge**
1. Handoff stripping (remove tool/bash noise, keep decisions)
2. Per-task model selection with fallback chain (task > trigger > workspace > global)
3. Chef-to-agent optimized handoff via `.task.md` pointer
4. Stage 2 cleanup: permanent purge after 30 days (worktree, branch, DB rows)
5. Settings UI panel

## Research: How Other Tools Handle This

Based on research into Cursor, Windsurf, Devin, Superset, and Claude Code internals.

### Token Optimization Patterns (from production tools)

| Tool | Pattern | Result |
|------|---------|--------|
| **Claude Code** | Proactive compaction at 60% context, not 90% | 5x reduction |
| **Windsurf** | SWE-grep: parallel grep + RL instead of embeddings | 20x faster retrieval, 61% fewer tokens |
| **Devin 2.0** | Filesystem-based memory across context boundaries | Survives context resets |
| **Cursor** | Isolated VMs per agent, summarized context handoff | No cross-agent bleed |
| **Superset** | Worktree-per-agent, independent operation | 10+ parallel agents on single machine |

### Key Insights for Our Design

1. **File-based context > prompt-based context.** Devin and Claude Code both use filesystem persistence (`CLAUDE.md`, `.task.md`) to survive context resets. Our pointer pattern (`.task.md` in worktree) aligns with this.

2. **MCP servers cost 18K tokens/message each.** Keep tool surface minimal per session. Don't load all MCP servers for every agent — scope to what the task needs.

3. **Proactive compaction > reactive.** Claude Code recommends compacting at 60% context usage. For long-running tasks, inject `/compact` hints or use `--resume` to start fresh sessions with saved state.

4. **Session handoff protocol.** Before killing/cycling an agent session, persist state to a handoff file:
   - Current commit hash
   - Decision log (why choices were made)
   - Next steps
   - Critical constraints
   New session loads this on startup.

5. **Idle agents are expensive.** Agent teams use 7x more tokens than solo sessions. Kill idle agents aggressively. Our sleeping → dead GC at 30min/4h is aligned with industry patterns.

6. **Parallel grep beats embeddings.** For codebase search within agent context, deterministic grep-based tools are faster and cheaper than semantic search. Don't over-engineer context retrieval.

### Handoff File Format (`.task-handoff.md`)

Written automatically when an agent session ends or is cycled:
```markdown
# Handoff: {task.title}
## State
- Commit: {last_commit_hash}
- Branch: {branch_name}
- Files modified: {list}

## What Was Done
{agent's summary of work completed}

## What's Left
{remaining work or review notes}

## Constraints
{any discovered constraints or decisions}
```

Used by `fresh` session strategy — new agent reads handoff + `.task.md` instead of getting full history in prompt.

## Resolved Questions

### 1. Auto-wake sleeping sessions — YES
Events that wake a sleeping session:
- User opens terminal panel for that task
- Task receives a trigger (moved to trigger column)
- Chef/MCP sends a message targeting that task
- PR webhook fires for that task's branch (CI, review, comments)
- Dependency completes (blocked task unblocks)

### 2. Max concurrent sessions — 20 default, configurable
`max_agent_sessions` in settings. Global default 20, per-workspace override possible.

### 3. Cleanup — Two-stage: archive then permanent delete
**Stage 1 (archive):** Task deleted → tmux session killed, agent cancelled, task moved to archive state. Worktree and branch preserved. Agent sessions preserved for reference.

**Stage 2 (permanent delete):** After 30 days in archive (or user explicitly purges):
- `git worktree remove --force {path}`
- Delete local branch if not pushed to remote (leave pushed branches — PR may reference)
- Delete agent_sessions rows
- Clear all task metadata

### 4. CLI resume support — detect first, handoff file as fallback
**Primary:** Check if CLI supports `--resume` (e.g., `codex --help | grep resume`). If yes, use native session continuity.

**Fallback:** Inject message to current agent: "Summarize what you've done to .task-handoff.md then exit". New agent reads handoff on start. Universal, works with any CLI.

**Handoff stripping:** When writing handoff, strip tool call details and bash output — keep just decisions, file changes, and remaining work. Research handoff optimization patterns from other tools.

## Settings Architecture

### Global Settings (`~/.bentoya/settings.json`)
```json
{
  "max_agent_sessions": 20,
  "gc_interval_minutes": 5,
  "idle_sleep_minutes": 30,
  "idle_kill_hours": 4,
  "archive_purge_days": 30,
  "default_agent_cli": "codex",
  "default_model": "gpt-5.4",
  "default_session_strategy": "fresh",
  "default_advance_mode": "auto"
}
```

### Per-Workspace Config (workspace.config JSON column)
Overrides global settings. Same keys, workspace-scoped.

### Mutability
- Readable/writable via HTTP API (`GET/POST /api/settings`)
- MCP server can read/write settings
- Chef can adjust per-task/per-workspace settings
- Changes take effect immediately (no restart needed)
- UI settings panel planned for later
