# T022: Pipeline & Column Templates

## Summary

Save and reuse column configurations as pipeline templates. Built-in templates for common workflows. Import/export as JSON.

## Acceptance Criteria

- [ ] Save current pipeline as template (name + description)
- [ ] Built-in templates: "Full CI Pipeline", "Quick Fix", "Spike/Research", "Standard" (default)
- [ ] Apply template to workspace (replaces or merges columns)
- [ ] Template picker shown when creating new workspace
- [ ] Export template as JSON file
- [ ] Import template from JSON file
- [ ] Templates stored in `~/.bentoya/templates/`
- [ ] Default pipeline for new workspaces configurable in settings

## Dependencies

- T015 (custom column config), T020 (settings panel)

## Complexity

**M**
