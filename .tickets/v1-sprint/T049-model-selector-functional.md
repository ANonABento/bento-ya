# T049: Functional Model Selector

## Summary

Model selector in terminal currently just displays "Claude" but doesn't let user change models. Make it functional.

## Current State

- `src/components/terminal/model-selector.tsx` is display-only
- No dropdown, no selection
- Doesn't affect which model agent uses

## Acceptance Criteria

- [ ] Dropdown showing available models from settings
- [ ] Selection persists per task or globally
- [ ] Model passed to agent on spawn
- [ ] Show model capabilities (context size, cost tier)
- [ ] Quick switch between configured providers

## Dependencies

- Settings providers configuration (done)

## Complexity

**M**
