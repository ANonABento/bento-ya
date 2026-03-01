# T038: Settings Backend Sync (Per-Workspace Config)

## Summary

Settings save to localStorage only. Wire up backend persistence so settings can be workspace-specific and survive browser clear.

## Current State

- Settings UI complete (`src/components/settings/`)
- Zustand persist middleware saves to localStorage
- Backend has `config` JSON field on `workspaces` table — **never used**
- All settings are global, not per-workspace
- Clear browser data = lose all settings

## Acceptance Criteria

- [ ] Settings sync to backend `workspaces.config` field
- [ ] Per-workspace settings: different LLM, templates, triggers per workspace
- [ ] Global settings (appearance, shortcuts) stay in localStorage
- [ ] Workspace settings (agent config, git, templates) go to backend
- [ ] Load settings from backend on workspace switch
- [ ] Merge strategy: workspace settings override global defaults
- [ ] Settings export/import (JSON file)
- [ ] Settings reset to defaults option

## Technical Notes

```typescript
// Split settings into:
// 1. Global (localStorage): theme, font size, shortcuts
// 2. Workspace (backend): agent provider, git config, column templates

// On workspace switch:
// 1. Fetch workspace.config from backend
// 2. Merge with global settings
// 3. Update stores
```

## Dependencies

- None

## Complexity

**M** — Settings architecture refactor, sync logic
