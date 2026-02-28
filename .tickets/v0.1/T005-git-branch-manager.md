# T005: Git Branch Manager & Change Tracker

## Summary

Implement smart git management: branch-per-task creation, file-level change tracking across branches, and basic conflict detection. No worktrees — everything works on a single checkout with branch switching managed by the backend.

## Acceptance Criteria

### Branch Manager
- [ ] `create_task_branch(repo_path, task_slug, base_branch?)` → creates `bentoya/<task-slug>` from base (default: main)
- [ ] `switch_branch(repo_path, branch)` → checkout with auto-stash/restore of uncommitted changes
- [ ] `get_current_branch(repo_path)` → returns current branch name
- [ ] `list_task_branches(repo_path)` → returns all `bentoya/*` branches
- [ ] `delete_task_branch(repo_path, branch)` → deletes branch (with confirmation if unmerged)
- [ ] Branch naming convention: `bentoya/<task-slug>` (slugified from task title)
- [ ] Stash management: auto-stash before switching, auto-restore after switching back

### Change Tracker
- [ ] `get_changes(repo_path, branch)` → returns list of changed files vs base branch with +/- line counts
- [ ] `get_diff(repo_path, branch, file_path?)` → returns diff (full branch diff or per-file)
- [ ] Track which files each task/branch has touched (stored in `tasks.files_touched`)
- [ ] `get_conflict_matrix(repo_path)` → compare all active task branches, return overlapping files
- [ ] Conflict detection: warn when two active branches modify the same file

### Tauri Integration
- [ ] All operations exposed as Tauri commands
- [ ] Git operations run on a background thread (not blocking the UI)
- [ ] Error handling for: not a git repo, dirty working tree, merge conflicts

## Dependencies

- T001 (project scaffolding)

## Can Parallelize With

- T002, T003, T004, T007, T008, T009, T010

## Key Files

```
src-tauri/src/
  git/
    branch_manager.rs       # Branch CRUD, stash, switch
    change_tracker.rs       # Diff generation, file tracking
    conflict_detector.rs    # Cross-branch overlap detection
  commands/
    git.rs                  # Tauri IPC commands for git operations
```

## Complexity

**M** — git2 API is well-documented but branch switching + stash management has edge cases.

## Notes

- Use `git2` crate (Rust libgit2 bindings) for all git operations
- **Do NOT shell out to `git` CLI** — use libgit2 for reliability and speed
- The stash flow for branch switching:
  1. Check if working tree is dirty
  2. If dirty: `git stash push -m "bentoya-auto-stash-{branch}"`
  3. Checkout target branch
  4. Check for matching auto-stash and pop if found
- `files_touched` tracking: after agent finishes, run `git diff --name-only base_branch..task_branch`
- Conflict matrix: for each pair of active branches, check if `files_touched` sets overlap
- Slug generation: lowercase, replace spaces with hyphens, strip special chars, truncate to 50 chars
- Default base branch detection: try `main`, fall back to `master`, fall back to current HEAD
- Test with a real git repo — mock git2 for unit tests
- Consider: agents run on their own branch, but the PTY CWD is always the repo root. The branch checkout happens before the agent spawns.
