# T020: Settings Panel

## Summary

Build the full settings panel — a slide-over from the right covering all configuration: agent config, modes, model & thinking, MCP servers, skills, voice, git, appearance, columns/pipeline, and keyboard shortcuts.

## Acceptance Criteria

- [ ] Gear icon in top bar opens settings panel (slides in from right, dims board)
- [ ] Tabbed layout inside settings panel (vertical tabs on left)
- [ ] Agent Configuration tab: default CLI, binary paths, max concurrent, env vars, instructions file
- [ ] Agent Modes tab: default mode, per-column overrides, custom mode creator (name, icon, prompt, tools)
- [ ] Model & Thinking tab: default model per agent, default effort, provider registry, cost display toggle
- [ ] MCP Servers tab: add/remove servers, connection status, auto-start toggle
- [ ] Skills tab: register custom skills, assign to triggers, import/export
- [ ] Voice tab: whisper model selection, language, hotkey, sensitivity
- [ ] Git tab: branch prefix, auto-PR, PR template, merge strategy, base branch
- [ ] Appearance tab: theme toggle (dark/light), accent color, font sizes, card density, animation speed
- [ ] Columns tab: visual pipeline editor with DnD, column templates, import/export
- [ ] Shortcuts tab: customizable hotkeys with conflict detection
- [ ] All settings persisted to `~/.bentoya/settings.json` and DB
- [ ] Per-workspace overrides supported (workspace settings override global)

## Dependencies

- v0.2 complete

## Complexity

**XL** — Many tabs, many form fields, validation, persistence.
