# Safe self-task creation via KaitenCode MCP

Patterns for letting an agent create tasks on its own board without runaway recursion. Reflects state of the system as of 2026-05-12 — see `MCP_DOGFOOD_REPORT.md` for the underlying audit.

## The risk

`kaitencode-mcp`'s `create_task` tool, when used from inside a column that fires `spawn_cli`, gives any CLI agent (Claude Code, Cursor agent mode, choomfie) the ability to enqueue more tasks. If those tasks land in another `spawn_cli` column, a new agent spawns. Nothing in the system today caps the total tasks created across a chain — the only ceiling is `DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS = 5` per workspace, which just queues the overflow.

## The pattern: "outbox column, human-approved"

The safest workflow today keeps the agent on a tight leash via column structure, not via in-prompt promises.

```
Backlog          →  Working               →  Review (manual_approval)
[user-created]      [spawn_cli, agent]       [human gate]
                          │
                          │ create_task(column="Agent Outbox")
                          ▼
                    Agent Outbox          →  Review (manual_approval)
                    [no triggers]            [human gate]
```

Rules:

1. **Agent column is `spawn_cli`** with the trigger prompt explicitly telling the agent: "If you need to spin off follow-up work, call `create_task` with `column: 'Agent Outbox'`. Do not move tasks. Do not call `create_task` for any other column."
2. **`Agent Outbox` has no `on_entry` trigger.** Tasks land there and sit. Nothing spawns.
3. **`Review` has `exit_criteria.type = manual_approval`.** A human has to click Approve before anything advances past it. This is the runaway-stop.
4. **Optional: a parent task ID convention in the description** — e.g. `Parent: <task_id>` — so a reviewer can see the lineage even without first-class attribution. (See follow-up `.tickets/mcp-add-source-attribution.md` for the proper fix.)

Why this is safe today:
- The chain dead-ends at `Agent Outbox` (no trigger fires).
- A human is required to release tasks from `Review`.
- The concurrency cap (5) means even a buggy agent in a loop can't spawn more than 5 simultaneous agents.

## Worked example: agent files a follow-up bug

Scenario: the agent finishes its current task, notices a stale comment in the codebase, wants to log a follow-up without blocking its own completion.

The prompt for the `spawn_cli` trigger includes:

```text
You are working on task: {task.title}
Workspace: {workspace.name}

If during this work you find unrelated follow-ups (cleanup, typos, separate
bugs, doc updates), DO NOT fix them inline. Instead, when you finish your
current change, call the kaitencode MCP tool ONCE per follow-up:

  create_task(
    column = "Agent Outbox",
    title = "<short imperative title>",
    description = "Parent: {task.id}\n\n<repro / location / why>"
  )

Rules:
  - Only column = "Agent Outbox".
  - Do not call move_task on the new task.
  - Do not call create_task more than 5 times per session.
  - Do not chain follow-ups (the follow-up itself must not request more tasks).
```

Verify in the next session by opening `Agent Outbox` — if the right number of cards appeared, the workflow is healthy. If the column has unexpected churn, tighten the prompt or pull MCP from this column's agent CLI.

## Anti-patterns

| Anti-pattern | Why it's bad |
|---|---|
| Letting `Agent Outbox` have a `spawn_cli` trigger | Reintroduces the loop. The outbox must be inert. |
| Asking the agent to `move_task` something it created | If the destination has a trigger, you've broken the dead-end. |
| Skipping the `manual_approval` gate before Done | Removes the human stop. Even a well-behaved chain can drift over weeks of accumulated tasks. |
| Pointing two `spawn_cli` columns at the same agent CLI with MCP attached and `create_task` allowed in both prompts | The agent can ping-pong tasks between them. |
| Trusting in-prompt rate limits as a sole control | Prompts are advisory. A confused agent can ignore them. Use column structure for the hard stop. |

## What we can't enforce today (and should)

These are real gaps in the system. Until they're fixed, the column-structure pattern above is the only safety net:

1. **Server-side recursion guard.** No setting today caps "tasks created per minute by MCP." The `MCP_DOGFOOD_REPORT.md` recommends adding one as an env var on the binary.
2. **Source attribution.** Tasks have no field like `created_by_task_id` or `created_by_agent_session_id`. A reviewer can't tell programmatically which tasks an agent spawned. See `.tickets/mcp-add-source-attribution.md`.
3. **Cycle detection on column-driven task chains.** The DAG dependency system has cycle detection for `add_dependency`, but task creation is a separate code path with no equivalent.

## Quick test recipe

To dogfood this yourself once the app is running:

1. Open the app. Create or pick a test workspace. Add columns `Working`, `Agent Outbox`, `Review`, `Done`. Make `Review` `manual_approval`.
2. Configure `Working`'s `on_entry` to `spawn_cli` with the prompt above.
3. From a Claude Code session with kaitencode MCP attached:
   - `get_workspaces` — confirm the test workspace shows up.
   - `get_board(workspace: "<test>")` — confirm columns.
   - `create_task(column: "Working", title: "Add a typo fix and file a follow-up about Section A.", description: "Edit FOO.md to fix the typo on line 1. If you notice the unrelated stale TODO in BAR.md, file it to Agent Outbox per the rules.")` — triggers the agent.
4. Wait for the agent to finish (terminal tab on the card). Open `Agent Outbox` — there should be exactly one new card, with "Parent: <task_id>" in the description, and no trigger fired on it.
5. Manually approve the original task to advance past `Review`.

If at any point Agent Outbox grows by more than the prompt allowed, kill the running agent (Stop button on the task) and tighten the prompt. The concurrency cap (5) will catch a true infinite loop, but only after 5 agents have spawned and queued.

## Audit trail

Until source attribution lands, the only way to audit a chain is:
- `get_task(id)` to see the description (which by convention now starts with `Parent: <id>`).
- `git log` in `<workspace.repo_path>/.worktrees/kaitencode-<task_id>/` for what the spawned agent did.
- The terminal scrollback in the task's tmux session (`kaitencode_<task_id>`).
