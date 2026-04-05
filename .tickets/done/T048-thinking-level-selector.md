# T048: Thinking Level Selector

## Summary

The thinking selector in terminal input is a disabled stub. Implement actual thinking level control for Claude extended thinking.

## Current State

- `src/components/terminal/thinking-selector.tsx` is non-functional
- Shows static "Normal" text with disabled cursor
- No connection to agent configuration

## Acceptance Criteria

- [ ] Dropdown with thinking levels: None, Low, Medium, High
- [ ] Selection stored in task/agent session config
- [ ] Passed to agent when spawning
- [ ] For Claude CLI: maps to `--thinking` flag
- [ ] Visual indicator of current level
- [ ] Remove "coming in v0.2" tooltip

## Technical Notes

Claude CLI thinking levels:
- None: no extended thinking
- Low: brief reasoning
- Medium: moderate depth
- High: deep analysis

## Complexity

**S**
