# Phase 4 — Settings Surfaces, DB Migration, Telemetry

## Context

Phases 1-3 shipped interactive mode for Claude and Codex with a per-task override and a per-column default — but task overrides are stored in a JSON metadata blob, workspace/global defaults aren't implemented at all, and there's no telemetry on how well sentinel-based completion is working. Phase 4 lands the durable storage, the full resolution hierarchy, and the observability that lets us know if Phase 6's fallback is needed.

**Read first:**
1. [`README.md`](README.md) in this folder.
2. Phase 1-3 status sections in [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) § Phasing.
3. `CLAUDE.md` § "Database" and § "Settings".
4. `src-tauri/src/db/` to find the migrations file and existing settings storage.
5. `src/components/settings/tabs/` to see how the existing settings tabs are structured.
6. Phase 2's `resolve_runtime_mode` helper — you'll be filling in the storage tiers it currently stubs.

## Goal

The full resolution hierarchy works end-to-end with durable storage:

```
trigger > task > column > workspace > global > default
```

Users can set defaults at any tier through the settings panel. The agent panel's "Effective: X (from Y)" hint becomes meaningful because each tier has real storage. And every completed interactive-mode task logs how it completed (sentinel / manual / timeout) so we can measure detection reliability.

## Scope (do this)

### Database

1. **Migration 030**:
   ```sql
   ALTER TABLE tasks ADD COLUMN runtime_mode_override TEXT;
   ALTER TABLE tasks ADD COLUMN agent_paused_at INTEGER;
   ```
   Backfill: NULL (means "inherit"). Existing tasks unchanged.

2. **Migration 031** — completion telemetry:
   ```sql
   CREATE TABLE agent_completion_events (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       task_id TEXT NOT NULL,
       workspace_id TEXT NOT NULL,
       cli TEXT NOT NULL,
       mode TEXT NOT NULL,                    -- 'headless' | 'interactive'
       completion_source TEXT NOT NULL,        -- 'sentinel' | 'exit_code' | 'manual' | 'timeout' | 'kill'
       duration_ms INTEGER NOT NULL,
       sentinel_seen_at INTEGER,
       created_at INTEGER NOT NULL
   );
   CREATE INDEX idx_agent_completion_events_workspace ON agent_completion_events(workspace_id, created_at DESC);
   ```

3. **Migrate the task JSON-blob storage from Phase 2** — if Phase 2 stored `runtime_mode_override` in `tasks.metadata`, the migration should also extract it into the new dedicated column. Drop the JSON field after. Verify the migration is idempotent.

### Resolver completion

4. **Wire the storage tiers** in `resolve_runtime_mode` (Phase 2 stubbed task/workspace/global):
   - **Task tier:** read `tasks.runtime_mode_override` directly.
   - **Workspace tier:** read `workspace_config` JSON → `default_runtime_mode`.
   - **Global tier:** read `~/.bentoya/settings.json` → `default_runtime_mode` via existing settings cache.
   - Both `default_runtime_mode` and `default_headless_render` are resolved with the same hierarchy.

5. **Update the `source` return** to reflect the real tier the value came from, not "default" as a fallback when stubbed tiers had values.

### Settings UI

6. **Column config dialog** (`src/components/kanban/column-config-dialog.tsx`):
   - New "Default runtime mode" picker in the trigger config section.
   - Saves to `column.triggers.default_runtime_mode`.
   - Per-trigger `runtime_mode` (existing) lives under "Advanced" — explain in the UI that the trigger value overrides the column default.

7. **Settings panel** — extend an existing tab (likely Agents tab) or add a new "Agent Modes" section:
   - Workspace-level "Default runtime mode" picker (saves to `workspace_config`).
   - Global "Default runtime mode" picker (saves to `~/.bentoya/settings.json`).
   - Both pickers also have a "Default headless render" sub-picker (bubbles vs terminal) shown when mode = headless.
   - Compact effective-mode preview: "New tasks will use: X (from Y)" for the current selection cascade.

8. **Telemetry view** in settings panel (debug section):
   - "Last 50 completions" table: task, mode, cli, source, duration. Read-only.
   - Aggregate stats: % of interactive completions by source over last 7 days.
   - This is the data Phase 6 reads to decide whether to ship the idle-prompt-detector fallback.

### Telemetry write path

9. **Emit completion events** from both completion paths:
   - Headless: `bridge::spawn_cli_trigger_task` already detects completion via exit code → write event with `completion_source: 'exit_code'`.
   - Interactive: Phase 1's sentinel watcher detects completion → write event with `completion_source: 'sentinel'` or `'timeout'`.
   - Manual: `mark_complete` Tauri command → write event with `completion_source: 'manual'`.
   - Kill: `agent_kill` → write event with `completion_source: 'kill'`.
   - All paths must write — don't ship partial coverage.

### Onboarding hook (lightweight)

10. **On first launch after upgrade**, do NOT auto-prompt for runtime mode (existing behavior preserved). On first launch of a *fresh install*, the onboarding wizard adds one new step: "Default agent mode" with radios for Interactive (recommended for paid Claude plan supervised use) / Headless (recommended for API key or unattended pipelines). Stored as the global default.

## Scope (do NOT do)

- **No idle-prompt-detector.** Phase 6 evaluates whether to add it based on Phase 4 telemetry.
- **No pause/resume.** Phase 5.
- **No mode rename / collapse.** Phase 6 decides.
- **No removal of the dev flag.** `BENTOYA_INTERACTIVE_MODE_ENABLED` stays gating the runtime path until Phase 6.

## Definition of done

1. All migrations apply cleanly on a fresh DB and on a DB that has Phase 2's JSON-blob field.
2. `cargo check && cargo test && npm run lint && npx tsc --noEmit && npm test` all pass.
3. New tests:
   - Resolver test matrix: every tier with a value, narrowest wins, fall-through to default.
   - Completion event emission test for each `completion_source` value.
   - Settings panel renders and saves correctly (Vitest).
4. Manual verification:
   - Set workspace default to interactive; create a task; confirm "Effective: interactive (from workspace)" in the picker.
   - Override on task; confirm "Effective: ... (from task)".
   - Override on trigger; confirm "Effective: ... (from trigger)".
   - Run a few interactive tasks; check the telemetry view shows real entries with correct sources.
5. Plan doc § Phasing updated with Phase 4 status, including any settings-storage decisions that diverged.

## Known gotchas

- **Migration order with Phase 2's JSON blob.** If you migrate the blob into the new column, also delete the blob field — otherwise resolver might read stale data. Test on a real DB with Phase 2 data.
- **Settings cache invalidation.** Global settings are cached in `OnceLock`. After saving, either invalidate the cache or accept that the change takes effect on next app restart. Pick one and document.
- **Workspace config is JSON.** Adding a typed field to JSON storage is brittle — make sure the parser tolerates missing/unknown fields. Don't fail-open into "headless" silently if the field is malformed; log a warning.
- **Telemetry insert performance.** Don't block trigger completion on the insert. Use a fire-and-forget tokio task or batch. The completion path is hot.
- **Privacy.** Completion events live in the local DB only. If you add any export or telemetry sync, get explicit user buy-in first — out of scope for Phase 4 but worth keeping clean.

## After you're done

Append Phase 4 status to plan doc:
- Migrations applied, schema diff
- Telemetry coverage % (which completion paths emit events — should be 100%)
- First-week numbers from your own dogfooding: sentinel hit rate, manual rate, timeout rate
- Recommendation for Phase 6: ship the idle-prompt-detector fallback yes/no based on the numbers

Then stop. The Phase 6 decision tree depends on this. Surface to the user.
