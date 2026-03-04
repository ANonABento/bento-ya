# T033: Chef Settings API - Real-time Configuration Management

## Summary

Expose a surface-level JSON/API that Chef (the orchestrator agent) can read and modify settings in real-time, allowing users to change app configuration through natural language instead of navigating settings UI.

## User Story

As a user, I want to tell Chef things like:
- "Make the terminal input taller"
- "Turn off swipe gestures"
- "Speed up PR polling to every 30 seconds"
- "Use a darker accent color"

And have Chef automatically adjust my settings without me opening the settings panel.

## Acceptance Criteria

- [ ] Settings manifest JSON exported and accessible to Chef
- [ ] Tauri IPC commands for reading/writing settings
- [ ] Chef can modify settings via MCP tools or IPC bridge
- [ ] Settings changes reflect immediately in UI (reactive via Zustand)
- [ ] Validation prevents invalid setting values
- [ ] Chef provides confirmation after changing settings

## Technical Implementation

### 1. Settings Schema Export
```typescript
type SettingsManifest = {
  [key: string]: {
    type: 'number' | 'boolean' | 'string' | 'select' | 'color'
    label: string
    description: string
    min?: number
    max?: number
    options?: string[]
    category: string
  }
}
```

### 2. Tauri IPC Commands
```rust
#[tauri::command]
fn get_settings() -> Settings

#[tauri::command]
fn update_setting(key: &str, value: serde_json::Value) -> Result<(), String>

#[tauri::command]
fn get_settings_manifest() -> SettingsManifest
```

### 3. Chef Tool Integration
- `get_user_settings()` - Read current config
- `set_user_setting(key, value)` - Modify config
- `list_configurable_settings()` - Get manifest for context

### 4. Natural Language Mapping
Chef should understand setting intents:
- "bigger text" → `appearance.fontSize: 'large'`
- "dark mode" → `appearance.theme: 'dark'`
- "hide branch on cards" → `cards.showBranch: false`

## Current Settings Available

**Terminal**: maxInputRows, lineHeight, scrollbackLines
**Panel**: defaultHeight, minHeight, maxHeight, collapsedHeight
**Gestures**: swipeEnabled, swipeThreshold, swipeVelocityThreshold
**Performance**: settingsSyncDebounceMs, messageTimeoutSeconds, maxConcurrentTerminals
**Cards**: showDescription, showBranch, showPrBadge, prPollingIntervalSeconds, etc.
**Appearance**: theme, accentColor, fontSize, cardDensity, animationSpeed
**Git**: branchPrefix, autoPr, mergeStrategy, baseBranch
**Voice**: enabled, model, language, hotkey, sensitivity
**Workspace**: defaultColumns, branchPrefix

## Dependencies

- Comprehensive settings system (done in commit 6cabb8a)

## Complexity

**M**
