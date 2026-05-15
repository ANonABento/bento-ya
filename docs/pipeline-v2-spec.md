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
   - If the task depends on same-batch predecessors and one has a local branch,
     use the most-progressed predecessor's branch as the base.
   - Otherwise use the workspace default base branch, normally `main`.
2. Create branch: `kaitencode/<task-slug>` from the resolved base
3. Create worktree: `.worktrees/kaitencode-<task-id>`
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

## Chains

Tasks in the same `batch_id` can depend on each other. When a task enters
Setup, `auto_setup` checks its same-batch dependencies. If any predecessor has
already created a branch, the new task branch is cut from the predecessor that
has progressed furthest through the board. This keeps serial work from all
branching off the same old `main` commit and reduces avoidable cascade
conflicts in shared files.

If no same-batch predecessor has a local branch yet, setup falls back to the
workspace default base branch.

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
