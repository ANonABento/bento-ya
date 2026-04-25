# Model Comparison View In Settings

## Task Description

Add a model comparison view inside Settings, focused on the existing Agent settings tab. The view should help users compare enabled AI models side by side by provider, cost, context/output limits, capabilities, and current workspace usage, without changing how model selection, provider configuration, or Tauri IPC currently work.

This plan is based on the active branch name (`bentoya/model-comparison-view-in-settings`), the current codebase state, and existing patterns in `CLAUDE.md`. No implementation is included here.

## 1. Approach

Build the feature as a frontend-led enhancement to `Settings > Agent` because the data needed for a useful first version already exists in the frontend settings store and usage IPC:

- Provider enablement and default model configuration live in `src/types/settings.ts` and `src/stores/settings-store.ts`.
- The Agent settings UI already owns provider expansion, CLI/API controls, and orchestrator model selection in `src/components/settings/tabs/agent-tab.tsx`.
- Workspace usage records are already available through `getWorkspaceUsage()` in `src/lib/ipc/usage.ts`, backed by typed camelCase Rust models and commands.
- Existing model capability data exists through `get_cli_capabilities`, but only for Claude aliases. A local frontend metadata registry can provide stable model comparison fields without introducing new network calls or backend migrations.

Methodology:

1. Extract model metadata and formatting into small reusable modules instead of increasing `agent-tab.tsx` substantially. `AgentTab` is already a dense component; comparison-specific calculations should be isolated.
2. Render the comparison as a collapsible section in the Agent tab, near provider/model controls. Default it collapsed and persist collapsed state in `localStorage`, matching the existing `comingSoonCollapsed` pattern.
3. Fetch usage lazily only when the comparison section is expanded and an active workspace exists. This avoids running workspace usage IPC every time Settings opens.
4. Aggregate usage client-side for now. `getWorkspaceUsage(workspaceId, 500)` is already used by `MetricsDashboard`, and a comparison table only needs per-model rollups.
5. Keep all event/IPC usage typed through existing frontend wrappers. No raw backend event emission is needed for this feature.
6. Add focused React tests for rendering, lazy usage loading, aggregation, and empty states. This matches the codebase’s Vitest + Testing Library pattern.

Why this approach:

- It respects the current Rust backend + React frontend boundary: the backend stores and returns usage records; the frontend decides how to present comparisons.
- It avoids adding a premature model discovery/cache backend when the existing task only requires a settings comparison view.
- It preserves existing model/provider behavior and reduces regression risk around CLI detection, workspace settings sync, and orchestrator model selection.
- It leaves a clean path to later replace the local metadata registry with dynamic model discovery if `.tickets/dynamic-model-discovery.md` is implemented.

## 2. Files To Modify/Create

### `src/components/settings/tabs/agent-tab.tsx`

Changes:

- Import the new comparison component.
- Compute the list of configured/enabled models using existing `model.providers` and provider metadata.
- Render the comparison section in the Agent tab, likely after `Providers` and before `Coming Soon` or before `Orchestrator`.
- Keep provider setup behavior unchanged:
  - provider toggle still updates `model.providers`.
  - CLI mode still calls `detectSingleCli`.
  - `availableModels` for orchestrator selection still uses enabled provider models.

Existing patterns to follow:

- `comingSoonCollapsed` localStorage state is the pattern for persisted collapse state.
- `SettingSection` is the existing settings layout wrapper.
- Tailwind utility styling should match the compact, work-focused settings UI.

### `src/components/settings/tabs/model-comparison-section.tsx` (new)

Purpose:

- Own the comparison UI and lazy usage fetch.

Responsibilities:

- Render a collapsible header with a concise count of comparable models.
- When expanded:
  - read the active workspace ID from `useWorkspaceStore`;
  - fetch usage with `getWorkspaceUsage(activeWorkspaceId, 500)`;
  - aggregate usage by model ID and known aliases;
  - render a compact comparison table.
- Show clear states:
  - no enabled providers/models;
  - no active workspace;
  - loading usage;
  - no usage records yet.

Suggested rows/columns:

- Provider
- Model
- Tier or role
- Input cost per 1M tokens
- Output cost per 1M tokens
- Context window
- Max output
- Capabilities
- Workspace calls
- Workspace tokens
- Workspace spend

Design notes:

- Use a table or table-like grid with horizontal overflow inside the section so long model IDs do not break the settings panel.
- Use small badges for capabilities, but keep the visual density consistent with `AgentTab`.
- Avoid nested cards; this should be one settings section with rows/table, not a card inside a card.
- Any clickable row/header areas that should display pointer cursors should use inline `style={{ cursor: 'pointer' }}` because macOS Tauri WKWebView does not reliably honor cursor classes.

### `src/components/settings/tabs/model-comparison-section.test.tsx` (new)

Test coverage:

- Renders collapsed by default.
- Persists expanded/collapsed state through `localStorage`.
- Does not call `get_workspace_usage` while collapsed.
- Calls `get_workspace_usage` when expanded and an active workspace exists.
- Aggregates usage by model ID and aliases.
- Shows empty/no-workspace states without throwing.

Existing patterns to follow:

- Use Vitest + Testing Library.
- Use the Tauri invoke mock from `src/test/setup.ts` / `src/test/mocks/tauri.ts`.
- Reset Zustand stores in `beforeEach`, as in `settings-store.test.ts`.

### `src/lib/model-metadata.ts` (new)

Purpose:

- Centralize frontend model metadata used by the comparison view and, later, other selectors.

Suggested types:

```ts
export type ModelMetadata = {
  id: string
  provider: 'anthropic' | 'openai' | string
  displayName: string
  alias?: string
  tier: 'fast' | 'balanced' | 'powerful' | 'reasoning'
  contextWindow: number | null
  maxOutputTokens: number | null
  inputCostPerMillion: number | null
  outputCostPerMillion: number | null
  capabilities: string[]
}
```

Initial metadata should cover the currently configured defaults and provider lists:

- Anthropic:
  - `claude-haiku-4-5-20251115`
  - `claude-sonnet-4-6-20260217`
  - `claude-opus-4-6-20260217`
  - existing backend aliases where applicable: `haiku`, `sonnet`, `opus`
- OpenAI:
  - `codex-5.2`
  - `codex-5.3`
  - `codex-5.3-spark`

Notes:

- Pricing/context metadata must be treated as local static metadata, not authoritative billing logic. The backend cost calculation remains the source for recorded usage cost.
- Unknown model IDs should still render with fallback labels and `null` metadata fields displayed as `--`, not disappear.

### `src/lib/model-metadata.test.ts` (new)

Test coverage:

- Looks up exact model IDs.
- Resolves alias usage records to canonical model rows.
- Returns stable fallback metadata for unknown model IDs.
- Formats price/token fields without `NaN` or `undefined`.

### `src/lib/usage-format.ts` (new) or local helpers in `model-comparison-section.tsx`

Preferred if formatting is reused across tests:

- `formatUsageCost(usd: number): string`
- `formatUsageTokens(count: number): string`
- `formatPricePerMillion(value: number | null): string`

Existing reference:

- `src/components/usage/metrics-dashboard.tsx` already has local `formatCost()` and `formatTokens()`. The new helper can mirror that behavior, but do not refactor `MetricsDashboard` unless needed for this task.

### `src/lib/ipc/usage.ts`

Likely no functional change needed.

Possible type-only change:

- Export any additional shared usage aggregation type only if the comparison component needs it. Prefer keeping aggregation types local unless reused.

### `src/lib/browser-mock.ts`

Changes:

- Ensure the existing `get_workspace_usage` mock returns enough representative records for browser/mock E2E if the settings UI is opened in Vite-only mode.
- Keep mock command names snake_case because this file mirrors Tauri command names.

Existing pattern:

- Usage command stubs already exist around `record_usage`, `get_workspace_usage`, and summaries.

### `src/components/settings/settings-panel.tsx`

No expected change.

Rationale:

- The comparison belongs inside the existing `AgentTab`; adding a new settings tab would increase navigation surface and conflict with the requested "in settings" model comparison scope.

### `src/types/settings.ts`

No required change for the first version.

Possible future change:

- If users need to hide individual models from the comparison or selector, add a `disabledModels?: string[]` field to `ModelConfig`. That is out of scope unless the task explicitly requires per-model toggles.

### Rust backend files

No expected backend changes.

Files reviewed:

- `src-tauri/src/commands/usage.rs`
- `src-tauri/src/db/usage.rs`
- `src-tauri/src/db/models.rs`
- `src-tauri/src/llm/types.rs`
- `src-tauri/src/commands/cli_detect.rs`

Rationale:

- Existing usage IPC already returns typed `UsageRecord[]` with `provider`, `model`, token counts, cost, and created timestamp.
- The comparison view does not need a DB schema migration, new command, or new Tauri event.

## 3. Acceptance Criteria

- [ ] Settings > Agent contains a model comparison section.
- [ ] The comparison section is collapsed by default.
- [ ] Expanded/collapsed state persists in `localStorage`.
- [ ] Collapsed comparison does not fetch workspace usage.
- [ ] Expanding the comparison fetches usage only when there is an active workspace.
- [ ] Enabled providers determine which models appear in the comparison.
- [ ] Disabled providers do not contribute models to the comparison.
- [ ] Each visible model row shows provider, display name/model ID, tier, pricing, context window, max output, and capabilities.
- [ ] Unknown models still render with fallback metadata instead of crashing.
- [ ] Workspace usage is aggregated per model with calls, input tokens, output tokens, total tokens, and cost.
- [ ] Usage records using aliases such as `sonnet`, `opus`, or `haiku` map to the corresponding Anthropic model row when possible.
- [ ] Empty usage state is explicit and does not hide static model metadata.
- [ ] No active workspace state is explicit and does not trigger usage IPC.
- [ ] Existing provider toggles, CLI/API switching, CLI path editing, API key editing, and orchestrator model selection continue to work.
- [ ] Text fits in the settings panel at desktop width and long model IDs do not overflow the panel.
- [ ] Cursor affordances for clickable collapse controls work in macOS Tauri by using inline cursor styles where needed.
- [ ] All added TypeScript passes strict mode without `any`.
- [ ] Tests cover collapsed, expanded, usage aggregation, alias matching, and empty-state behavior.

Requirement mapping:

- "Model comparison view" -> `model-comparison-section.tsx` renders side-by-side/row comparison.
- "In settings" -> section is integrated into `AgentTab`, not a separate route or modal.
- "Existing architecture" -> data flows through Zustand settings and Tauri usage IPC wrappers.
- "Rust backend + React frontend + Tauri IPC conventions" -> no raw IPC calls outside `src/lib/ipc`, no backend event changes, camelCase frontend types remain aligned with Rust serde rename rules.
- "Do not implement" -> this file is a plan only; no feature code is changed.

## 4. Test Strategy

### Unit and component tests

Run:

```bash
npm run test:run
```

Add focused tests:

- `src/lib/model-metadata.test.ts`
  - exact lookup;
  - alias lookup;
  - fallback metadata;
  - price/token formatting.
- `src/components/settings/tabs/model-comparison-section.test.tsx`
  - renders collapsed by default;
  - persists collapse state;
  - lazy loads usage on expand;
  - does not load usage without an active workspace;
  - aggregates multiple records for the same model;
  - maps alias records to canonical model rows;
  - handles empty model lists.

Testing patterns:

- Use `vi.mocked(invoke)` / `setupInvokeMock()` for Tauri commands.
- Reset `useSettingsStore` and `useWorkspaceStore` directly in `beforeEach`.
- Prefer querying visible text and roles over implementation details.

### Type and lint checks

Run:

```bash
npm run type-check
npm run lint
```

Expected focus:

- no unused helper exports;
- no implicit `any`;
- no unsafe optional access causing `undefined` display;
- no React hook dependency omissions.

### Backend checks

No backend code should change. If backend files are touched unexpectedly, run:

```bash
cargo check --workspace
cargo test --workspace
```

### Manual UI check

Run:

```bash
npm run dev
```

Manual coverage:

- Open Settings > Agent.
- Confirm comparison is collapsed by default.
- Expand comparison.
- Toggle Anthropic/OpenAI providers and confirm rows update.
- Verify long model IDs remain contained.
- Confirm no visual overlap in the right-side settings panel.
- Confirm clickable collapse header cursor works in the Tauri app, not only the browser.

### Optional browser/E2E check

If the change touches `browser-mock.ts` or settings startup behavior, run:

```bash
npm run test:e2e
```

Real Tauri WebDriver is optional for this task unless cursor behavior or WKWebView layout issues are suspected.

## 5. Edge Cases & Risks

- Static model metadata can become stale. Mitigation: isolate it in `src/lib/model-metadata.ts` and clearly separate displayed estimates from recorded backend usage cost.
- Provider model lists currently live inside `AgentTab` as `PROVIDER_INFO.models`. Duplicating model lists in metadata would drift. Mitigation: move model list construction through metadata helpers or keep a single source for model IDs.
- Usage records may store aliases (`sonnet`) while settings use full IDs (`claude-sonnet-4-6-20260217`). Mitigation: metadata must include aliases and aggregation must try both exact ID and alias.
- Usage records may store legacy or unknown model IDs. Mitigation: render fallback rows or show usage under an "Unknown" model label without throwing.
- `getWorkspaceUsage(workspaceId, 500)` is a bounded sample, not all-time usage. Mitigation: label usage as recent workspace usage unless a backend aggregate-by-model command is later added.
- Opening Settings without an active workspace should not produce rejected IPC calls. Mitigation: gate usage fetch by `!!activeWorkspaceId`.
- React Strict Mode can double-run effects. Mitigation: use cancellation flags or request guards so stale async results do not overwrite current state.
- `localStorage` may be unavailable or mocked. Mitigation: wrap access in `try/catch`, following existing `comingSoonCollapsed` code.
- Long model IDs and capability chips can overflow the settings panel. Mitigation: use horizontal overflow for the table and `truncate`/`break-all` only where appropriate.
- macOS Tauri cursor styling is unreliable with CSS classes. Mitigation: use inline cursor styles on collapse headers/buttons that need pointer affordance.
- Increasing `agent-tab.tsx` further makes it harder to maintain. Mitigation: keep the comparison component and metadata helpers separate.

## 6. Dependencies

Existing dependencies:

- React 19 and TypeScript strict mode.
- Zustand settings and workspace stores:
  - `src/stores/settings-store.ts`
  - `src/stores/workspace-store.ts`
- Existing Tauri usage IPC:
  - frontend wrapper `src/lib/ipc/usage.ts`
  - Rust command `src-tauri/src/commands/usage.rs`
  - DB functions `src-tauri/src/db/usage.rs`
- Existing settings UI primitives:
  - `SettingSection`
  - `SettingRow`
  - `Dropdown`
- Existing test stack:
  - Vitest
  - Testing Library
  - jsdom
  - mocked `@tauri-apps/api/core.invoke`

No new npm, Cargo, database, or Tauri plugin dependency should be needed.

Future optional dependency:

- Dynamic model discovery from `.tickets/dynamic-model-discovery.md` could later replace or augment `src/lib/model-metadata.ts`, but it is not required for this task.
