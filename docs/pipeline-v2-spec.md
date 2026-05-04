# Pipeline v2 — Streamlined Column Flow

## New Column Layout

```
Backlog → Setup → Plan → Implement → Review → Verify → PR → Staging → Merge → Done
```

| Column | Trigger | Agent? | What Happens |
|--------|---------|--------|-------------|
| **Backlog** | none | no | Tasks wait here. Manual or dependency-driven entry. |
| **Setup** | `auto_setup` | no | Pipeline creates worktree + branch. Sets working_dir. No agent spawn. Auto-advances immediately. |
| **Plan** | `spawn_cli` | yes | Agent reads task description + codebase, writes `.task.md` plan. Does NOT implement. |
| **Implement** | `spawn_cli` | yes | Agent reads `.task.md`, implements changes, runs tests, commits. |
| **Review** | `spawn_cli` | yes | Single review pass: logic correctness + code quality + requirements coverage. Fixes and commits. |
| **Verify** | `spawn_cli` | yes | Runs type-check + unit tests. Conditional E2E (only if task touched route files). Fixes failures. No new features. |
| **PR** | `create_pr` | no | Runs type-check first. If passes, pushes branch + creates PR against `staging/<batch>` branch. If type-check fails, marks task as failed. |
| **Staging** | `batch_wait` | no | Holds until all tasks in the batch have PRs. Then creates combined staging → main PR. CI runs on combined code. |
| **Merge** | `auto_merge` | no | When CI passes on staging PR, squash merges to main. Unblocks all dependents. Cleans up worktree + branch. |
| **Done** | none | no | Terminal state. |

## New Trigger Types

### `auto_setup`
No agent. Pipeline logic only:
1. Resolve base branch:
   - If the task has dependencies on other tasks in the same `batch_id`
     and any of them already have a branch on disk, branch off the
     most-progressed predecessor's HEAD (chain-aware base — see "Chains"
     below).
   - Otherwise, branch off the workspace default (`main`/`master`).
2. Create branch: `bentoya/<task-slug>` from the resolved base
3. Create worktree: `.worktrees/bentoya-<task-id>`
4. Update task: `branch_name`, `worktree_path`
5. Auto-advance to next column

### `batch_wait`
No agent. Waits for conditions:
1. Check if all tasks in the same batch have reached PR/Staging
2. If yes: create a `staging/<batch-id>` branch from main
3. Merge all task branches into staging (resolve conflicts)
4. Run type-check on staging. If fails, mark batch as needs-review.
5. Push staging + create PR: staging → main
6. Auto-advance all batch tasks to Merge (waiting for CI)

### `auto_merge`
No agent. Watches the staging PR:
1. Poll PR status (or webhook)
2. When CI passes: `gh pr merge --squash --delete-branch`
3. For each task in the batch:
   - Move to Done
   - Clean up worktree + branch
   - Check dependents → unblock if conditions met
   - Fire dependent tasks' triggers
4. If CI fails: mark batch as needs-fix, notify

## Batch Concept

Tasks queued together (or in the same dependency chain) form a **batch**:
- `batch_id` field on task (auto-assigned when moved to Plan)
- All tasks in a batch share one staging branch
- Staging column waits for the full batch before combining
- Batch size: configurable per workspace (default: queue everything until user says "go")

## Chains (sequential dependencies inside a batch)

A **chain** is a sequence of batch members where each task depends on its
predecessor (typically via `in_review`/`at_or_past_column` feeding `batch_wait`).
When tasks in the chain touch shared modules (db migrations, model structs,
top-level UI files), branching every chain member off the same `main` SHA
produces PRs that cascade-conflict at merge time, defeating automation.

`auto_setup` is **chain-aware**:
1. Detects chain membership: a task has `dependencies` referencing other
   tasks that share its `batch_id`.
2. Picks the predecessor with the highest column position whose branch
   already exists on disk (closest ancestor — contains all earlier
   predecessors' work too).
3. Cuts the new branch from that predecessor's HEAD instead of `main`.
4. Falls back to the workspace default base if no eligible predecessor
   has a branch yet (e.g. predecessor still in Backlog).

The selection is implemented by
`pipeline::dependencies::predecessor_branch_for_chain` — see its tests for
edge cases (different batch, no branch yet, multi-predecessor preference).

## Conditional E2E

Verify column checks which files the task modified:
- If any file in `src/app/` (routes): run E2E
- If only `src/lib/`, `src/components/`, config files: skip E2E
- Check via: `git diff --name-only main..HEAD | grep "^src/app/"`

## Stale Session Cleanup

Add to the idle sweep (registry.rs):
- Every 60s, check all `running` agent sessions
- For each: `kill(pid, 0)` to check if process alive
- If dead: mark session as `completed` (exit_code = -1)
- This prevents stale sessions from blocking promote_queued_tasks

## Dependency Auto-Unblock

When a task moves to Done (via Merge column):
1. `check_dependents()` already exists in dependencies.rs
2. Currently only fires on `mark_complete` from agent path
3. Add: also fire when task moves to Done column via any path (API, merge, manual)
4. Unblocked tasks auto-move to Setup (not Backlog)

## App Restart Recovery

On startup, instead of resetting all running/triggered tasks to idle:
1. Check each task's column
2. If in Setup/PR/Staging/Merge (no-agent columns): re-trigger immediately
3. If in Plan/Implement/Review/Verify (agent columns): check if worktree has new commits since last trigger
   - If yes: assume work done, advance to next column
   - If no: re-trigger in current column
4. Never lose completed work

## Migration from Current Columns

1. Rename existing columns:
   - Working → Implement
   - Review-Logic → (delete)
   - Review-Quality → Review (rename)
   - E2E → (delete, merged into Verify)
2. Add new columns: Setup, Staging, Merge
3. Update all trigger configs
4. Existing tasks in Done stay in Done
5. Any in-flight tasks reset to Backlog for fresh run through new pipeline
