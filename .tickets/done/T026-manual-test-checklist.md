# T026: Manual Test Checklist Generation

## Summary

After a PR is merged, auto-generate a test checklist from the changes. User manually verifies each item. All items checked → task advances.

## Acceptance Criteria

- [ ] Checklist auto-generated from diff (agent analyzes changes and produces test items)
- [ ] Interactive checklist UI in the task detail panel
- [ ] Items checkable individually
- [ ] All items checked → exit criteria met → task advances
- [ ] Checklist persisted in task's `checklist` JSON field
- [ ] Manual item add/edit/remove

## Dependencies

- T025 (siege loop — task arrives here after PR is approved)

## Complexity

**M**
