# Model Comparison View In Settings

## Task Description

Add a model comparison view inside Settings, focused on the existing Agent settings tab. The view should help users compare enabled AI models side by side by provider, cost, context/output limits, capabilities, and current workspace usage, without changing model selection behavior, provider configuration behavior, or the existing Tauri IPC boundary.

This plan is based on the current `bentoya/model-comparison-view-in-settings` worktree, `CLAUDE.md`, and the existing Rust backend + React frontend + Tauri IPC architecture. It is a plan only; it does not implement the feature.

Current codebase observations:

- `Settings > Agent` already uses the dynamic model registry through `useModels()` and `src/lib/ipc/models.ts`.
- Rust already exposes model metadata via `src-tauri/src/models/*` and Tauri commands `get_available_models` / `refresh_models`.
- Workspace usage already exists through `src/lib/ipc/usage.ts`, `src-tauri/src/commands/usage.rs`, and `src-tauri/src/db/usage.rs`.
- There is a partial comparison implementation in `src/components/settings/tabs/model-comparison-section.tsx`, `src/lib/model-usage.ts`, `src/lib/usage-format.ts`, and related tests.
- The current `AgentTab` comparison row derivation is stale: it reads `PROVIDER_INFO.models`, but `PROVIDER_INFO` only contains provider label/description/CLI metadata. Comparison rows should come from `allModels`, filtered by enabled providers and `model.disabledModels`.
- `npm run type-check` currently reports several unrelated errors elsewhere, plus one comparison-related error in `src/components/settings/tabs/agent-tab.tsx`.

## 1. Approach

Use the existing dynamic model registry as the model metadata source, and make the comparison view a frontend-led settings enhancement.

Methodology:

1. Keep the feature in `AgentTab`.
   The request is specifically for a model comparison view in Settings, focused on Agent settings. A new route, modal, or settings tab would add navigation surface without improving the core workflow.

2. Derive comparable models from `useModels()`.
   The Rust backend already merges API/CLI discovery with local metadata and returns `ModelEntry[]` through `get_available_models`. Reusing that avoids a second hardcoded frontend registry and prevents drift between the selector, provider model toggles, and comparison table.

3. Filter exactly like the orchestrator model selector.
   Rows should include models whose provider is enabled and whose model ID is not in `model.disabledModels`. This keeps the comparison definition aligned with the models users can actually select.

4. Fetch usage lazily.
   The comparison section should stay collapsed by default and should not call `getWorkspaceUsage()` until expanded. When expanded, it should fetch only if an active workspace exists and at least one comparable model is visible.

5. Aggregate usage client-side for this task.
   `getWorkspaceUsage(workspaceId, 500)` is already used by `MetricsDashboard`; a first comparison view only needs recent per-model totals. A backend aggregate command is unnecessary unless the product later needs exact all-time rollups over large histories.

6. Resolve usage aliases against the dynamic model list.
   Usage records may store short aliases such as `sonnet`, `opus`, `haiku`, or `codex`, while model rows use full IDs. Build a provider-scoped alias map from `ModelEntry.alias` and aggregate with provider-qualified canonical keys.

7. Preserve IPC conventions.
   Use existing wrappers in `src/lib/ipc/usage.ts` and `src/lib/ipc/models.ts`; do not call `invoke()` directly from components. No Rust event changes are needed.

8. Keep UI compact and settings-native.
   Use one collapsible settings section with a horizontally scrollable comparison table. Do not add nested cards inside settings cards. Clickable collapse affordances need inline `style={{ cursor: 'pointer' }}` and children should inherit the cursor for macOS Tauri WKWebView.

Why this approach:

- It fits the existing Rust/React/Tauri ownership split: Rust discovers and enriches model data; React presents and aggregates it for the settings UI.
- It avoids duplicate pricing/context metadata in the frontend.
- It minimizes regression risk around provider enablement, CLI detection, API key settings, and orchestrator model selection.
- It keeps the path open for future exact backend usage aggregation without blocking this UI-focused task.

## 2. Files To Modify/Create

### `src/components/settings/tabs/agent-tab.tsx`

Changes needed:

- Fix comparison model derivation to use `allModels`, not `PROVIDER_INFO.models`.
- Build `comparisonModels` from:
  - `allModels`;
  - `enabledProviderIds`;
  - `model.disabledModels`;
  - provider display names from `PROVIDER_INFO` / `ProviderConfig.name`.
- Pass complete model metadata to `ModelComparisonSection`, not only model IDs. The comparison section should receive the fields it needs from `ModelEntry`: `id`, `displayName`, `provider`, `alias`, `tier`, `contextWindow`, `maxOutputTokens`, `inputCostPerM`, `outputCostPerM`, `capabilities`, and `isNew`.
- Preserve existing behavior:
  - provider toggles still update `model.providers`;
  - CLI mode still calls `detectSingleCli`;
  - refresh still calls `refreshModels()`;
  - orchestrator model options still come from enabled, non-disabled models.
- Use inline cursor style for provider headers that are clickable, matching the AGENTS/CLAUDE macOS Tauri cursor rule.

Existing patterns to follow:

- `availableModels` already shows how to filter by enabled providers and disabled model IDs.
- `comingSoonCollapsed` shows the localStorage collapse persistence pattern.
- Provider rows already show model toggles from `providerModels = allModels.filter((m) => m.provider === provider.id)`.

### `src/components/settings/tabs/model-comparison-section.tsx`

Changes needed:

- Keep the component focused on:
  - collapsed/expanded state;
  - lazy usage fetch;
  - usage state messaging;
  - table rendering.
- Update `ComparableModel` to include dynamic model metadata rather than requiring a separate frontend metadata lookup. Suggested shape:

```ts
export type ComparableModel = {
  providerId: string
  providerName: string
  id: string
  displayName: string
  alias: string | null
  tier: ModelTier
  contextWindow: number
  maxOutputTokens: number
  inputCostPerM: number | null
  outputCostPerM: number | null
  capabilities: string[]
  isNew: boolean
}
```

- Render a compact table with columns:
  - Provider
  - Model
  - Tier
  - Input / 1M
  - Output / 1M
  - Context
  - Max output
  - Capabilities
  - Calls
  - Tokens
  - Spend
- Preserve explicit states:
  - collapsed by default;
  - no enabled models;
  - no active workspace;
  - loading usage;
  - usage unavailable;
  - no usage records yet.
- Avoid stale async updates with a cancellation flag in the usage-loading effect.
- Keep table horizontal overflow so long model IDs cannot break the settings panel.
- Use inline cursor styles on the collapse button and `cursor: inherit` on child elements.

Existing patterns to follow:

- Current partial `ModelComparisonSection` already has the right lazy-fetch shape.
- `MetricsDashboard` shows recent usage aggregation expectations and labels usage as bounded by the latest records.
- `SettingSection` is used by `AgentTab`, but the comparison component can remain a plain section if it is visually aligned with nearby settings sections.

### `src/lib/model-usage.ts`

Changes needed:

- Keep usage aggregation isolated from React.
- Replace hardcoded metadata-dependent canonicalization with a dynamic model index built from comparable models.
- Add or adjust helpers:

```ts
export type ModelUsageStats = {
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
}

export function buildModelUsageIndex(models: ComparableUsageModel[]): ModelUsageIndex

export function aggregateUsageByModel(
  records: UsageRecord[],
  index: ModelUsageIndex,
): Record<string, ModelUsageStats>
```

- Key aggregation by `${provider}:${canonicalModelId}`.
- Match records by provider + exact ID first, then provider + alias.
- Keep unknown models provider-scoped so the same unknown ID from two providers does not merge.
- Export `EMPTY_USAGE_STATS`.

Existing patterns to follow:

- Current `aggregateUsageByModel()` is a good starting point, but it should not depend on frontend static metadata once the dynamic registry is the source of truth.

### `src/lib/usage-format.ts`

Changes needed:

- Keep or extend existing formatters:
  - `formatUsageCost(usd: number): string`
  - `formatUsageTokens(count: number): string`
  - `formatPricePerMillion(value: number | null): string`
  - `formatTokenLimit(value: number | null): string`
- Ensure no formatter can display `undefined`, `NaN`, or `Infinity`.
- Keep behavior aligned with `src/lib/usage.ts` / `MetricsDashboard` where possible.

### `src/lib/model-metadata.ts`

Preferred change:

- Delete this frontend static metadata registry and move any remaining alias/canonicalization logic into `src/lib/model-usage.ts`.

Reason:

- The backend dynamic model registry already owns local metadata in `src-tauri/src/models/metadata.rs` and returns enriched `ModelEntry` values to the frontend.
- Keeping a second frontend registry duplicates pricing/context/capability data and has already drifted from backend values, for example the Claude Haiku date and output-token limits.

Fallback if deletion is too disruptive:

- Restrict this file to provider-scoped alias helpers only and remove pricing/context/capability metadata from it.
- Do not use it as the source for comparison-table model rows.

### `src/lib/model-metadata.test.ts`

Preferred change:

- Delete this test if `src/lib/model-metadata.ts` is deleted.

Fallback:

- Rewrite it to cover only alias/canonicalization helpers if the file remains.

### `src/lib/model-usage.test.ts` (new or expanded)

Test coverage:

- Exact model IDs aggregate to `${provider}:${id}`.
- Provider-scoped aliases aggregate to their canonical model row.
- Aliases do not resolve across provider boundaries.
- Unknown models stay provider-scoped.
- Multiple records sum calls, input tokens, output tokens, total tokens, and cost.
- Empty input returns an empty aggregation.

### `src/components/settings/tabs/model-comparison-section.test.tsx`

Changes needed:

- Update fixtures to use dynamic model-shaped `ComparableModel` objects instead of static metadata IDs.
- Cover:
  - collapsed by default;
  - localStorage persistence;
  - no usage IPC while collapsed;
  - usage IPC on expansion with active workspace;
  - no usage IPC without active workspace;
  - no usage IPC with zero comparable models;
  - exact ID and alias aggregation visible in the table;
  - empty usage still renders static model metadata;
  - usage error state.
- Reset `useWorkspaceStore` in `beforeEach`.
- Continue mocking `getWorkspaceUsage` directly or through the existing Tauri invoke mock. Direct module mocking is acceptable here because the component imports the wrapper, not raw Tauri `invoke()`.

Existing patterns to follow:

- `src/test/setup.ts` provides jsdom and localStorage mocks.
- Store tests reset Zustand state directly in `beforeEach`.
- Testing Library queries should prefer visible text/roles over implementation details.

### `src/lib/browser-mock.ts`

Changes needed:

- Add mock handlers for dynamic model registry IPC:
  - `get_available_models`
  - `refresh_models`
- Return representative `ModelsCache` data matching `src/lib/ipc/models.ts`, including Anthropic and OpenAI models with aliases, pricing, limits, capabilities, and `source`.
- Keep existing `get_workspace_usage` mock records with a mix of full model IDs and aliases so browser/Vite-only Settings can exercise the comparison view.
- If this file is touched, also fix existing `Workspace` mock objects to include required `activeTaskCount`, because strict TypeScript currently reports this file as invalid.
- Keep command names snake_case because this mock mirrors Tauri command names.

### `src/lib/ipc/models.ts`

Likely no functional change needed.

Possible type-only change:

- Export `ModelTier` and `ModelEntry` if not already exported from the barrel in a way that `AgentTab` and `ModelComparisonSection` can import cleanly.

### `src/lib/ipc/index.ts`

Likely no change if model IPC exports are already re-exported.

Verify:

- `AgentTab` imports `useModels()` and model IPC types cleanly.
- No component imports `invoke()` directly.

### `src/components/settings/settings-panel.tsx`

No expected change.

Rationale:

- The comparison belongs inside the existing Agent tab. Adding a new tab would not match the requested focus and would duplicate settings navigation.

### `src/types/settings.ts`

No expected schema change.

Rationale:

- `ModelConfig.disabledModels` already represents per-model visibility.
- Provider enablement already lives in `ModelConfig.providers`.
- No new persisted setting is required beyond localStorage UI collapse state.

### Rust backend files

No expected functional changes.

Files reviewed:

- `src-tauri/src/models/types.rs`
- `src-tauri/src/models/metadata.rs`
- `src-tauri/src/models/mod.rs`
- `src-tauri/src/commands/usage.rs`
- `src-tauri/src/db/usage.rs`
- `src-tauri/src/db/models.rs`
- `src-tauri/src/commands/mod.rs`

Rationale:

- `get_available_models` already returns enriched camelCase `ModelEntry` values.
- `get_workspace_usage` already returns camelCase `UsageRecord[]` through the frontend wrapper.
- No database migration or new Tauri command is needed for a recent-usage comparison.

## 3. Acceptance Criteria

- [ ] Settings > Agent contains a model comparison section.
- [ ] The comparison section is collapsed by default.
- [ ] Expanded/collapsed state persists in `localStorage`.
- [ ] Collapsed comparison does not fetch workspace usage.
- [ ] Expanding the comparison fetches usage only when there is an active workspace and at least one comparable model.
- [ ] Comparable rows are derived from the dynamic model registry returned by `useModels()`.
- [ ] Enabled providers determine which provider models are eligible for comparison.
- [ ] Models in `model.disabledModels` do not appear in the comparison.
- [ ] Provider toggles, model toggles, CLI/API switching, CLI path editing, API key editing, model refresh, and orchestrator model selection keep their current behavior.
- [ ] Each visible model row shows provider, display name/model ID, tier, input cost per 1M, output cost per 1M, context window, max output, capabilities, workspace calls, workspace tokens, and workspace spend.
- [ ] Unknown/new dynamic models render with available fallback metadata from the backend `ModelEntry` and do not crash the UI.
- [ ] Workspace usage is aggregated per provider-scoped model with calls, input tokens, output tokens, total tokens, and cost.
- [ ] Usage records using provider-scoped aliases such as `sonnet`, `opus`, `haiku`, or `codex` map to the corresponding model row when the dynamic model list exposes that alias.
- [ ] Aliases do not resolve across providers.
- [ ] Unknown usage model IDs remain provider-scoped and do not merge incorrectly.
- [ ] Empty usage state is explicit and does not hide static model metadata.
- [ ] No active workspace state is explicit and does not trigger usage IPC.
- [ ] Usage fetch failures show a non-fatal inline state.
- [ ] Long model IDs and capability chips do not overflow the settings panel; the table scrolls horizontally when needed.
- [ ] Clickable collapse/provider controls use inline cursor styles where needed for macOS Tauri WKWebView.
- [ ] Added or modified TypeScript uses strict types and does not introduce `any`.
- [ ] Comparison-specific tests cover collapsed state, lazy loading, no-workspace behavior, alias aggregation, unknown models, empty state, and error state.

Requirement mapping:

- "Model comparison view" -> `model-comparison-section.tsx` renders a side-by-side comparison table.
- "Inside Settings" -> section is integrated into `AgentTab`, not a new route/modal/tab.
- "Focused on existing Agent settings tab" -> data and layout are colocated with provider/model controls.
- "Compare enabled AI models" -> rows use enabled provider IDs and exclude `model.disabledModels`.
- "By provider, cost, context/output limits, capabilities" -> fields come from dynamic `ModelEntry` metadata.
- "And current workspace usage" -> lazy `getWorkspaceUsage(activeWorkspaceId, 500)` aggregation.
- "Without changing model selection/provider configuration/Tauri IPC" -> use existing stores and IPC wrappers; no new backend command or settings schema.
- "Rust backend + React frontend + Tauri IPC conventions" -> backend metadata/usage stays typed and camelCase; frontend goes through `src/lib/ipc`.

## 4. Test Strategy

### Targeted unit and component tests

Run:

```bash
npm run test:run -- src/lib/model-usage.test.ts src/components/settings/tabs/model-comparison-section.test.tsx
```

Coverage:

- `src/lib/model-usage.test.ts`
  - exact ID aggregation;
  - alias aggregation;
  - provider boundary protection;
  - unknown model handling;
  - totals for calls, input, output, total tokens, and cost.
- `src/components/settings/tabs/model-comparison-section.test.tsx`
  - collapsed by default;
  - localStorage persistence;
  - no fetch while collapsed;
  - fetch on expand with active workspace;
  - no fetch with no active workspace;
  - no fetch with no comparable models;
  - visible usage totals;
  - empty usage state;
  - usage error state.

### Broader frontend checks

Run:

```bash
npm run test:run
npm run lint
npm run type-check
```

Notes:

- `npm run type-check` currently has pre-existing errors outside this feature area. The comparison implementation must at minimum remove the comparison-related `agent-tab.tsx` error and not introduce new errors. If the task owner expects a fully green type-check, the unrelated existing errors in `column.tsx`, `task-dependency-utils.ts`, `split-view.tsx`, `agent-panel.tsx`, and `browser-mock.ts` need separate resolution or explicit inclusion in scope.
- If `browser-mock.ts` is touched for model registry mocks, fix its existing `activeTaskCount` workspace mock errors in the same pass.

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
- Confirm provider rows still load dynamic model counts.
- Confirm comparison is collapsed by default.
- Expand comparison.
- Confirm usage loads only after expansion.
- Toggle Anthropic/OpenAI providers and confirm comparison rows update.
- Toggle individual model visibility and confirm comparison rows update.
- Confirm long model IDs remain contained and the table scrolls horizontally.
- Confirm no visual overlap in the settings panel.
- Confirm collapse/header cursor affordances work in the Tauri app, not only the browser.

### Optional browser/E2E check

If `browser-mock.ts` or Settings startup behavior changes, run:

```bash
npm run test:e2e
```

Real Tauri WebDriver is optional for this task unless WKWebView cursor/layout behavior needs direct verification.

## 5. Edge Cases & Risks

- Dynamic models may load after the Agent tab renders. The comparison should update when `useModels()` updates without losing collapse state.
- The model registry can return an empty list if IPC fails or no fallback loads. Show an explicit no-models state instead of throwing.
- Model metadata can be stale. Mitigation: use the backend registry as the single app-level metadata source and display recorded usage cost from usage records rather than recalculating billing.
- API/CLI discovered models may not have pricing. Display `--` for unknown price fields.
- Usage records may store aliases while model rows use full IDs. Mitigation: provider-scoped alias index from `ModelEntry.alias`.
- The same alias or model ID could appear under two providers. Mitigation: all canonical keys include provider.
- Usage records may reference models no longer returned by the registry. They should not crash aggregation; they may be omitted from visible rows unless a future "Other usage" row is added.
- `getWorkspaceUsage(workspaceId, 500)` is a bounded recent sample. Label it as latest/recent workspace records, not all-time totals.
- React Strict Mode can double-run effects. Use cancellation guards and ensure collapsed/no-workspace states do not issue duplicate meaningful requests.
- `localStorage` may throw in constrained environments. Wrap reads/writes in `try/catch`.
- Long model IDs and many capability chips can overflow the panel. Use table `min-width`, `overflow-x-auto`, truncation, and title attributes for full IDs.
- macOS Tauri WKWebView may ignore Tailwind cursor classes. Use inline cursor styles for collapse headers and inherited cursor styles for children.
- Existing unrelated type errors can obscure feature validation. Track comparison-specific errors separately if full type-check is not yet green.

## 6. Dependencies

Existing runtime dependencies:

- React 19
- TypeScript 5.7 strict mode
- Zustand stores:
  - `src/stores/settings-store.ts`
  - `src/stores/workspace-store.ts`
- Tauri IPC wrappers:
  - `src/lib/ipc/models.ts`
  - `src/lib/ipc/usage.ts`
- Rust model registry:
  - `src-tauri/src/models/types.rs`
  - `src-tauri/src/models/metadata.rs`
  - `src-tauri/src/models/mod.rs`
- Rust usage commands and DB:
  - `src-tauri/src/commands/usage.rs`
  - `src-tauri/src/db/usage.rs`

Existing test dependencies:

- Vitest
- Testing Library
- jsdom
- Existing Tauri API mocks in `src/test/setup.ts` and `src/test/mocks/tauri.ts`

No new npm, Cargo, database, or Tauri plugin dependency should be required.
