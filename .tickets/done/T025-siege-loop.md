# T025: Siege Loop (Comment-Watch)

## Summary

The Siege column monitors an open PR for review comments and automatically spawns an agent to fix them. Loops until the PR is approved or the user intervenes. Like clanker-spanker / fix-pr-comments.

## Acceptance Criteria

- [ ] Poll PR for new review comments (configurable interval, default 60s)
- [ ] New comments detected → spawn agent to address them
- [ ] Agent reads comment context, makes fixes, pushes to the PR branch
- [ ] Loop: check for new comments → fix → push → repeat until clean
- [ ] PR approved → task auto-advances to next column
- [ ] Max iteration limit (configurable, default 5) to prevent infinite loops
- [ ] Manual intervention: user can stop the loop, take over, or skip
- [ ] Task card shows loop iteration count and current status

## Dependencies

- T024 (PR creation)

## Complexity

**L**
