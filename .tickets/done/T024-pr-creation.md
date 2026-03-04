# T024: PR Creation from Review Column

## Summary

When a task reaches the Review column and is approved, automatically create a GitHub PR from the task's branch. PR title/body auto-generated from task data and diff summary.

## Acceptance Criteria

- [ ] "Create PR" action available in Review column
- [ ] PR created via `gh` CLI or GitHub API (octocrab crate)
- [ ] PR title from task title, body from task description + change summary
- [ ] PR template configurable in settings
- [ ] Task card updates with PR number and link
- [ ] PR URL clickable (opens in browser)
- [ ] Auto-PR toggle: create PR automatically when task enters Review column

## Dependencies

- v0.3 complete

## Complexity

**M**
